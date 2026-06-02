import { createServiceClient } from "@/lib/supabase/server";
import type { InboundMessage } from "./types";
import type { Channel } from "@/lib/types";
import { syncContactAvatar } from "./avatar";

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

    const org = channel.organization_id;

    // Contato (upsert por organização + telefone)
    const { data: contact } = await db
      .from("contacts")
      .upsert(
        { organization_id: org, phone: msg.from, name: msg.contactName ?? null },
        { onConflict: "organization_id,phone", ignoreDuplicates: false },
      )
      .select("id, avatar_url")
      .single();

    // Foto de perfil (UAZAPI) — só quando ainda não temos avatar. Best-effort.
    if (contact && !contact.avatar_url) {
      await syncContactAvatar(db, channel as Channel, contact.id, msg.from).catch((e) =>
        console.warn("avatar sync", (e as Error)?.message),
      );
    }

    // Conversa em aberto (reaproveita ou cria)
    let conversationId: string | undefined;
    const { data: existing } = await db
      .from("conversations")
      .select("id")
      .eq("channel_id", channel.id)
      .eq("contact_id", contact!.id)
      .in("status", ["bot", "queued", "open"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) conversationId = existing.id;
    else {
      const { data: conv } = await db
        .from("conversations")
        .insert({
          organization_id: org,
          channel_id: channel.id,
          contact_id: contact!.id,
          status: "queued",
          last_message_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      conversationId = conv!.id;
    }

    await db.from("messages").insert({
      organization_id: org,
      conversation_id: conversationId,
      direction: "in",
      sender_type: "contact",
      content_type: msg.contentType,
      body: msg.body ?? null,
      media_url: msg.mediaUrl ?? null,
      external_id: msg.externalId ?? null,
      status: "delivered",
    });

    await db
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversationId);
  }
}
