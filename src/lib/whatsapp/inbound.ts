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

  // 1) Cache de participantes do grupo (LID → phone).
  let cached = groupPartsCache.get(groupJid);
  if (!cached || Date.now() - cached.at > 300000) {
    const info = await getProvider(channel).getGroupInfo?.(groupJid).catch(() => null);
    cached = { at: Date.now(), parts: info?.participants ?? [] };
    groupPartsCache.set(groupJid, cached);
  }

  // Mapa: qualquer forma de ID (lid, phone, lid parcial) → phone real.
  const toPhone = new Map<string, string>();
  for (const p of cached.parts) {
    if (p.lid) toPhone.set(p.lid, p.phone);
    if (p.phone) toPhone.set(p.phone, p.phone);
    // LIDs podem ter sufixos/prefixos — registra os últimos 10-15 dígitos também.
    if (p.lid && p.lid.length > 10) toPhone.set(p.lid.slice(-12), p.phone);
  }

  // 2) Nomes dos contatos.
  const phones = [...new Set([...toPhone.values()])];
  const names = new Map<string, string>();
  if (phones.length) {
    const { data: contacts } = await db.from("contacts").select("phone, name").in("phone", phones);
    for (const c of contacts ?? []) if (c.name) names.set(c.phone, c.name);
  }

  // 3) Pré-carrega nomes por author_lid de mensagens recentes deste grupo.
  const lidNames = new Map<string, string>();
  const { data: recentMsgs } = await db
    .from("messages")
    .select("author_lid, author_name")
    .not("author_lid", "is", null)
    .not("author_name", "is", null)
    .limit(200);
  for (const m of (recentMsgs ?? []) as { author_lid: string; author_name: string }[]) {
    if (m.author_lid && m.author_name) {
      lidNames.set(m.author_lid, m.author_name);
      // Match parcial (últimos dígitos).
      if (m.author_lid.length > 8) lidNames.set(m.author_lid.slice(-12), m.author_name);
    }
  }

  // 4) Substitui @digits pelo nome.
  return body.replace(/@(\d{5,})/g, (full, digits: string) => {
    // Tenta via participantes do grupo.
    const phone = toPhone.get(digits);
    if (phone) {
      const name = names.get(phone);
      if (name) return `@${name}`;
    }
    // Tenta via author_lid de mensagens (match exato e parcial).
    const fromLid = lidNames.get(digits) ?? lidNames.get(digits.slice(-12));
    if (fromLid) return `@${fromLid}`;
    // Tenta como telefone direto nos contatos.
    const fromPhone = names.get(digits);
    if (fromPhone) return `@${fromPhone}`;
    // Último recurso: mantém o original.
    return full;
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

    // Contato/grupo (upsert por organização + telefone/id).
    // Para mensagens fromMe (eco do celular) em 1:1, NÃO passamos nome —
    // o chat.name do webhook vem com o nome do DONO, não do contato.
    const contactName = (fromMe && !isGroup) ? null : (msg.contactName ?? null);
    const { data: contact } = await db
      .from("contacts")
      .upsert(
        {
          organization_id: org,
          phone: msg.from,
          name: contactName,
          is_group: isGroup,
        },
        { onConflict: "organization_id,phone", ignoreDuplicates: false },
      )
      .select("id, name, avatar_url, avatar_src, is_group")
      .single();

    // Nome e foto vêm no objeto `chat` do webhook (contato e grupo). Preenche o que faltar.
    // Não usa chatName em fromMe 1:1 (viria o nome do dono, não do contato).
    if (contact) {
      const patch: Record<string, unknown> = {};
      if (!contact.name && msg.chatName && !(fromMe && !isGroup)) patch.name = msg.chatName;
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
    let convAiEnabled = true;
    let isNew = false;
    const { data: existing } = await db
      .from("conversations")
      .select("id, status, bot_node_id, ai_enabled")
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
      convAiEnabled = (existing as { ai_enabled?: boolean }).ai_enabled !== false;
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

    // ====== CSAT: captura nota se aguardando satisfação ======
    if (!fromMe && !isGroup && existing?.status === "closed") {
      const { data: awaitingConv } = await db
        .from("conversations")
        .select("awaiting_satisfaction, survey_id")
        .eq("id", conversationId)
        .maybeSingle();
      if (awaitingConv?.awaiting_satisfaction && body) {
        const note = parseInt(body.trim(), 10);
        if (note >= 1 && note <= 5) {
          await db.from("conversations").update({
            satisfaction: note,
            awaiting_satisfaction: false,
          }).eq("id", conversationId);
          // Mensagem de agradecimento
          const thanks = "Obrigado pela sua avaliação! Ficamos felizes em poder ajudar.";
          const to = isGroup ? `${msg.from}@g.us` : msg.from;
          await getProvider(channel as Channel).sendText({ to, text: thanks }).catch(() => {});
          await db.from("messages").insert({
            organization_id: org, conversation_id: conversationId,
            direction: "out", sender_type: "system", content_type: "text",
            body: thanks, status: "sent",
          });
          continue; // não precisa processar mais nada
        }
      }
    }

    // ====== Mensagens automáticas por evento ======
    if (!fromMe && !isGroup) {
      const autoSend = async (event: string) => {
        const { data: am } = await db.from("auto_messages")
          .select("body").eq("organization_id", org).eq("event", event).eq("active", true)
          .or(`channel_id.eq.${channel.id},channel_id.is.null`)
          .limit(1).maybeSingle();
        if (am?.body) {
          await getProvider(channel as Channel).sendText({ to: msg.from, text: am.body }).catch(() => {});
          await db.from("messages").insert({
            organization_id: org, conversation_id: conversationId,
            direction: "out", sender_type: "system", content_type: "text",
            body: am.body, status: "sent",
          });
        }
        return !!am?.body;
      };

      if (isNew) {
        // Horário de atendimento: checa se estamos fora do horário
        const { data: hours } = await db.from("business_hours")
          .select("day_of_week, start_time, end_time, active")
          .eq("organization_id", org)
          .eq("active", true);
        if (hours && hours.length > 0) {
          const { data: orgRow } = await db.from("organizations").select("settings").eq("id", org).maybeSingle();
          const tz = ((orgRow?.settings as Record<string, unknown>)?.timezone_offset as number) ?? -3;
          const now = new Date(Date.now() + tz * 3600000);
          const dow = now.getUTCDay();
          const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
          const todayHours = hours.filter((h: { day_of_week: number }) => h.day_of_week === dow);
          const inHours = todayHours.some((h: { start_time: string; end_time: string }) => hhmm >= h.start_time && hhmm <= h.end_time);
          if (!inHours) {
            await autoSend("out_of_hours");
          }
        }
        // Boas-vindas (welcome) — só na 1ª msg da conversa
        await autoSend("welcome");
      }

      // Ausência (away) — se o atendente atribuído está offline
      if (existing && convStatus === "open" && existing.status === "open") {
        const { data: assignedConv } = await db.from("conversations")
          .select("assigned_user_id").eq("id", conversationId).maybeSingle();
        if (assignedConv?.assigned_user_id) {
          const { data: agent } = await db.from("profiles")
            .select("status").eq("id", assignedConv.assigned_user_id).maybeSingle();
          if (agent?.status === "offline") {
            await autoSend("away");
          }
        }
      }

      // Fila de espera (queue_wait) — se conversa está em espera
      if (convStatus === "queued") {
        await autoSend("queue_wait");
      }
    }

    // ====== Comando para encerrar (cliente envia palavra-chave) ======
    if (!fromMe && !isGroup && body && (convStatus === "open" || convStatus === "queued")) {
      const { data: orgRow2 } = await db.from("organizations").select("settings").eq("id", org).maybeSingle();
      const orgSettings = (orgRow2?.settings ?? {}) as Record<string, unknown>;
      const closeCmd = String(orgSettings.close_command ?? "").trim();
      if (closeCmd) {
        const keywords = closeCmd.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
        if (keywords.some((k) => body!.toLowerCase().includes(k))) {
          const closeMsg = String(orgSettings.close_command_message ?? "").trim();
          if (closeMsg) {
            await getProvider(channel as Channel).sendText({ to: msg.from, text: closeMsg }).catch(() => {});
            await db.from("messages").insert({
              organization_id: org, conversation_id: conversationId,
              direction: "out", sender_type: "system", content_type: "text",
              body: closeMsg, status: "sent",
            });
          }
          await db.from("conversations").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", conversationId);
          continue;
        }
      }
    }

    // Chatbot: roda só em mensagens recebidas (não nos ecos do próprio número).
    if (automation && !isGroup && !fromMe && convAiEnabled && (convStatus === "bot" || isNew)) {
      const r = await runChatbot(
        db,
        channel as Channel,
        { id: conversationId, organization_id: org, channel_id: channel.id, contact_phone: msg.from, contact_name: contact?.name ?? null, is_group: isGroup, bot_node_id: convBotNode },
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
