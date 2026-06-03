import { createServiceClient } from "@/lib/supabase/server";
import type { InboundMessage } from "./types";
import type { Channel } from "@/lib/types";
import { syncContactAvatar } from "./avatar";
import { storeInboundMedia } from "./media";
import { runChatbot } from "./chatbot";
import { getProvider } from "./index";

const MEDIA_TYPES = new Set(["image", "audio", "video", "document", "sticker"]);

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
      .select("id, name, avatar_url, is_group")
      .single();

    // Enriquecimento (UAZAPI): nome do grupo e/ou foto, quando ainda faltam. Best-effort.
    if (contact) {
      const provider = getProvider(channel as Channel);
      const needName = isGroup && !contact.name;
      const needAvatar = !contact.avatar_url;
      if ((needName || needAvatar) && provider.getChatInfo) {
        const jid = isGroup ? `${msg.from}@g.us` : `${msg.from}@s.whatsapp.net`;
        const info = await provider.getChatInfo(jid).catch(() => ({}) as { name?: string; image?: string });
        const patch: Record<string, unknown> = {};
        if (needName && info.name) patch.name = info.name;
        if (Object.keys(patch).length) await db.from("contacts").update(patch).eq("id", contact.id);
      }
      if (needAvatar && !isGroup) {
        await syncContactAvatar(db, channel as Channel, contact.id, msg.from).catch((e) =>
          console.warn("avatar sync", (e as Error)?.message),
        );
      }
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
      convStatus = automation ? "bot" : "queued";
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

    await db.from("messages").insert({
      organization_id: org,
      conversation_id: conversationId,
      direction: "in",
      sender_type: "contact",
      content_type: msg.contentType,
      body,
      media_url: mediaUrl,
      external_id: msg.externalId ?? null,
      author_name: msg.authorName ?? null,
      reply_to_external: msg.replyTo?.externalId ?? null,
      reply_excerpt: msg.replyTo?.excerpt ?? null,
      reply_author: msg.replyTo?.author ?? null,
      status: "delivered",
    });

    await db
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversationId);

    // Chatbot: roda se a conversa está no bot (aguardando) ou acabou de nascer com automação ativa.
    if (automation && !isGroup && (convStatus === "bot" || isNew)) {
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
