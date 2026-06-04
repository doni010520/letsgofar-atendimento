import { createServiceClient } from "@/lib/supabase/server";
import type { InboundMessage } from "./types";
import type { Channel } from "@/lib/types";
import { storeInboundMedia } from "./media";
import { rehostImageUrl } from "./avatar";
import { runChatbot } from "./chatbot";
import { getProvider } from "./index";

// Cache de participantes por grupo (5 min) para resolver menções sem bater toda hora.
const groupPartsCache = new Map<string, { at: number; parts: { phone: string; lid: string }[] }>();

/** Troca "@<número/lid>" no texto pelo nome do participante (resolvido via grupo + contatos). */
async function resolveMentions(db: DB, channel: Channel, groupJid: string, body: string): Promise<string> {
  if (!/@\d{5,}/.test(body)) return body;
  let cached = groupPartsCache.get(groupJid);
  if (!cached || Date.now() - cached.at > 300000) {
    const info = await getProvider(channel).getGroupInfo?.(groupJid).catch(() => null);
    cached = { at: Date.now(), parts: info?.participants ?? [] };
    groupPartsCache.set(groupJid, cached);
  }
  // digits (lid OU phone) → phone real
  const toPhone = new Map<string, string>();
  for (const p of cached.parts) {
    if (p.lid) toPhone.set(p.lid, p.phone);
    if (p.phone) toPhone.set(p.phone, p.phone);
  }
  const phones = [...new Set([...toPhone.values()])];
  const names = new Map<string, string>();
  if (phones.length) {
    const { data: contacts } = await db.from("contacts").select("phone, name").in("phone", phones);
    for (const c of contacts ?? []) if (c.name) names.set(c.phone, c.name);
  }
  return body.replace(/@(\d{5,})/g, (full, digits) => {
    const phone = toPhone.get(digits) ?? digits;
    const name = names.get(phone);
    return name ? `@${name}` : full;
  });
}

const MEDIA_TYPES = new Set(["image", "audio", "video", "document", "sticker"]);

/** Hash curto e estável para cache-busting da foto re-hospedada. */
function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Persiste mensagens recebidas via webhook: localiza o canal pelo external_id,
 * faz upsert do contato e da conversa em aberto, e grava a mensagem.
 * Usa o service client (ignora RLS) — só deve ser chamado por rotas de webhook.
 */
export async function persistInbound(messages: InboundMessage[]) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const db = createServiceClient();

  for (const msg of messages) {
    if (!msg.channelExternalId || !msg.from) continue;

    const { data: channel } = await db
      .from("channels")
      .select("*")
      .eq("external_id", msg.channelExternalId)
      .maybeSingle();
    if (!channel) continue;

    // Reação: anexa o emoji à mensagem-alvo e segue (não cria mensagem nova).
    if (msg.reaction) {
      await applyReaction(db, msg.reaction.targetExternalId, msg.reaction.emoji, msg.authorName ?? "contato").catch(
        (e) => console.warn("reaction", (e as Error)?.message),
      );
      continue;
    }

    const org = channel.organization_id;
    const isGroup = !!msg.isGroup;
    const fromMe = !!msg.fromMe; // eco do próprio número (enviado pelo celular) → direção "out"

    // Dedup: ignora se já gravamos essa mensagem (mesmo external_id).
    if (msg.externalId) {
      const { data: dup } = await db.from("messages").select("id").eq("external_id", msg.externalId).limit(1).maybeSingle();
      if (dup) continue;
    }

    // Contato/grupo (upsert por organização + telefone/id). Não sobrescreve um
    // nome já existente com null.
    const { data: contact } = await db
      .from("contacts")
      .upsert(
        {
          organization_id: org,
          phone: msg.from,
          name: msg.contactName ?? null,
          is_group: isGroup,
        },
        { onConflict: "organization_id,phone", ignoreDuplicates: false },
      )
      .select("id, name, avatar_url, avatar_src, is_group")
      .single();

    // Nome e foto vêm no objeto `chat` do webhook (contato e grupo). Preenche o que faltar.
    if (contact) {
      const patch: Record<string, unknown> = {};
      if (!contact.name && msg.chatName) patch.name = msg.chatName;
      if (isGroup && msg.chatJid) patch.chat_jid = msg.chatJid; // JID completo do grupo
      // Foto: re-hospeda no nosso Storage. "src" = caminho da URL do WhatsApp (sem query
      // de expiração) — muda quando a pessoa troca a foto → re-hospeda a nova.
      const srcKey = msg.chatPhoto ? msg.chatPhoto.split("?")[0] : null;
      const changed = srcKey && srcKey !== contact.avatar_src;
      if (changed && msg.chatPhoto) {
        const durable = await rehostImageUrl(db, org, contact.id, msg.chatPhoto).catch(() => null);
        if (durable) {
          patch.avatar_url = `${durable}?v=${hashStr(srcKey)}`; // cache-busting ao trocar
          patch.avatar_src = srcKey;
        }
      }
      if (Object.keys(patch).length) await db.from("contacts").update(patch).eq("id", contact.id);
    }

    // Automação ativa do canal (chatbot). Grupos não entram no bot.
    const { data: automation } = isGroup
      ? { data: null }
      : await db
          .from("automations")
          .select("id, flow, active, channel_id")
          .eq("organization_id", org)
          .eq("active", true)
          .or(`channel_id.eq.${channel.id},channel_id.is.null`)
          .order("channel_id", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

    // Conversa em aberto (reaproveita ou cria)
    let conversationId: string;
    let convStatus = "queued";
    let convBotNode: string | null = null;
    let isNew = false;
    const { data: existing } = await db
      .from("conversations")
      .select("id, status, bot_node_id")
      .eq("channel_id", channel.id)
      .eq("contact_id", contact!.id)
      .in("status", ["bot", "queued", "open"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      conversationId = existing.id;
      convStatus = existing.status;
      convBotNode = existing.bot_node_id;
    } else {
      isNew = true;
      convStatus = fromMe ? "open" : automation ? "bot" : "queued";
      const { data: conv } = await db
        .from("conversations")
        .insert({
          organization_id: org,
          channel_id: channel.id,
          contact_id: contact!.id,
          status: convStatus,
          bot_automation_id: automation?.id ?? null,
          last_message_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      conversationId = conv!.id;
    }

    // Mídia: baixa/descriptografa e re-hospeda; áudio ganha transcrição como corpo.
    let mediaUrl = msg.mediaUrl ?? null;
    let body = msg.body ?? null;
    if (MEDIA_TYPES.has(msg.contentType)) {
      const stored = await storeInboundMedia(db, channel as Channel, msg.externalId).catch(() => ({}) as { url?: string; transcription?: string });
      if (stored.url) mediaUrl = stored.url;
      if (!body && stored.transcription) body = stored.transcription;
    }

    // Menções em grupo: troca "@<número>" pelo nome do participante.
    if (isGroup && body) {
      const gjid = msg.chatJid || `${msg.from}@g.us`;
      body = await resolveMentions(db, channel as Channel, gjid, body).catch(() => body);
    }

    // Citação: resolve trecho e AUTOR a partir da mensagem citada que já temos no banco
    // (o webhook só traz o LID do autor, sem nome).
    let replyExcerpt = msg.replyTo?.excerpt ?? null;
    let replyAuthor = msg.replyTo?.author ?? null;
    if (msg.replyTo?.externalId) {
      const t = msg.replyTo.externalId;
      const tail = t.includes(":") ? t.split(":").pop()! : t;
      const { data: q } = await db
        .from("messages")
        .select("author_name, direction, body, content_type")
        .or(`external_id.eq.${t},external_id.ilike.%${tail}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (q) {
        if (!replyExcerpt) replyExcerpt = q.body ?? (q.content_type !== "text" ? `[${q.content_type}]` : null);
        replyAuthor = q.author_name ?? (q.direction === "out" ? "Você" : contact?.name ?? null);
      }
    }

    await db.from("messages").insert({
      organization_id: org,
      conversation_id: conversationId,
      direction: fromMe ? "out" : "in",
      sender_type: fromMe ? "agent" : "contact",
      content_type: msg.contentType,
      body,
      media_url: mediaUrl,
      external_id: msg.externalId ?? null,
      author_name: fromMe ? null : msg.authorName ?? null,
      author_phone: fromMe ? null : msg.authorPhone ?? null,
      author_lid: fromMe ? null : msg.authorLid ?? null,
      reply_to_external: msg.replyTo?.externalId ?? null,
      reply_excerpt: replyExcerpt,
      reply_author: replyAuthor,
      status: fromMe ? "sent" : "delivered",
    });

    await db
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversationId);

    // Chatbot: roda só em mensagens recebidas (não nos ecos do próprio número).
    if (automation && !isGroup && !fromMe && (convStatus === "bot" || isNew)) {
      const r = await runChatbot(
        db,
        channel as Channel,
        { id: conversationId, organization_id: org, channel_id: channel.id, contact_phone: msg.from, is_group: isGroup, bot_node_id: convBotNode },
        automation as { id: string; flow: { nodes: never[]; edges: never[] } },
        body ?? "",
      ).catch((e) => {
        console.warn("chatbot", (e as Error)?.message);
        return null;
      });
      if (r === "queued") await db.from("conversations").update({ status: "queued" }).eq("id", conversationId);
    }
  }
}

const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 0 };

/** Aplica atualizações de status (entregue/lido) às mensagens enviadas, só "subindo" o nível. */
export async function persistStatusUpdates(updates: { externalId: string; status: "sent" | "delivered" | "read" }[]) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !updates.length) return;
  const db = createServiceClient();
  for (const u of updates) {
    const tail = u.externalId.includes(":") ? u.externalId.split(":").pop()! : u.externalId;
    const { data: msg } = await db
      .from("messages")
      .select("id, status")
      .eq("direction", "out")
      .or(`external_id.eq.${u.externalId},external_id.ilike.%${tail}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!msg) continue;
    if ((STATUS_RANK[u.status] ?? 0) > (STATUS_RANK[msg.status] ?? 0)) {
      await db.from("messages").update({ status: u.status }).eq("id", msg.id);
    }
  }
}

type Reaction = { emoji: string; by: string };

/** Anexa (ou remove, se emoji vazio) uma reação à mensagem-alvo, casando pelo id externo. */
async function applyReaction(db: DB, targetExternalId: string, emoji: string, by: string) {
  if (!targetExternalId) return;
  const tail = targetExternalId.includes(":") ? targetExternalId.split(":").pop()! : targetExternalId;
  const { data: msg } = await db
    .from("messages")
    .select("id, reactions")
    .or(`external_id.eq.${targetExternalId},external_id.ilike.%${tail}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!msg) return;
  const current: Reaction[] = Array.isArray(msg.reactions) ? (msg.reactions as Reaction[]) : [];
  const without = current.filter((r) => r.by !== by);
  const next = emoji ? [...without, { emoji, by }] : without;
  await db.from("messages").update({ reactions: next }).eq("id", msg.id);
}

type DB = ReturnType<typeof createServiceClient>;
