"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { getProvider } from "@/lib/whatsapp";
import { getMessages, getConversations } from "@/lib/data/conversations";
import type { Channel, ContentType } from "@/lib/types";

const isPreview = () => !process.env.NEXT_PUBLIC_SUPABASE_URL;

export async function fetchMessages(conversationId: string) {
  return getMessages(conversationId);
}

/** Lista atualizada de conversas (usada pelo polling da inbox). */
export async function fetchConversations() {
  return getConversations();
}

/**
 * Abre (ou cria) uma conversa 1:1 com um participante — ex.: clicar no nome num grupo.
 * Se só houver o LID (mensagem comum de grupo), resolve o telefone via /group/info.
 */
export async function openDirectConversation(
  channelId: string,
  opts: { phone?: string; lid?: string; name?: string; groupJid?: string },
) {
  if (isPreview()) return { id: null as string | null };
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const supabase = await createClient();

  let digits = (opts.phone || "").replace(/\D/g, "");
  // Resolve LID → telefone real consultando os participantes do grupo.
  if (!digits && opts.lid && opts.groupJid) {
    const { data: channel } = await supabase.from("channels").select("*").eq("id", channelId).single();
    const parts = await getProvider(channel as Channel)
      .getGroupParticipants?.(opts.groupJid)
      .catch(() => [] as { lid: string; phone: string }[]);
    const lidDigits = opts.lid.replace(/\D/g, "");
    digits = (parts ?? []).find((p) => p.lid === lidDigits)?.phone ?? "";
  }
  if (!digits) return { id: null };
  const name = opts.name;

  const { data: contact } = await supabase
    .from("contacts")
    .upsert(
      { organization_id: session.organization.id, phone: digits, name: name ?? null, is_group: false },
      { onConflict: "organization_id,phone", ignoreDuplicates: false },
    )
    .select("id")
    .single();
  if (!contact) return { id: null };

  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("channel_id", channelId)
    .eq("contact_id", contact.id)
    .in("status", ["bot", "queued", "open"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let id = existing?.id ?? null;
  if (!id) {
    const { data: conv } = await supabase
      .from("conversations")
      .insert({
        organization_id: session.organization.id,
        channel_id: channelId,
        contact_id: contact.id,
        status: "open",
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    id = conv?.id ?? null;
  }
  revalidatePath("/atendimento");
  return { id };
}

/**
 * Resolve o telefone/nome de um participante SEM criar contato/conversa.
 * Usado ao clicar num participante de grupo — só materializa ao digitar/enviar.
 */
export async function resolveDirectContact(
  channelId: string,
  opts: { phone?: string; lid?: string; name?: string; groupJid?: string },
): Promise<{ phone: string | null; name: string | null; existingId: string | null }> {
  if (isPreview()) return { phone: null, name: null, existingId: null };
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const supabase = await createClient();

  let digits = (opts.phone || "").replace(/\D/g, "");
  if (!digits && opts.lid && opts.groupJid) {
    const { data: channel } = await supabase.from("channels").select("*").eq("id", channelId).single();
    const parts = await getProvider(channel as Channel)
      .getGroupParticipants?.(opts.groupJid)
      .catch(() => [] as { lid: string; phone: string }[]);
    const lidDigits = opts.lid.replace(/\D/g, "");
    digits = (parts ?? []).find((p) => p.lid === lidDigits)?.phone ?? "";
  }
  if (!digits) return { phone: null, name: null, existingId: null };

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name")
    .eq("organization_id", session.organization.id)
    .eq("phone", digits)
    .maybeSingle();

  let existingId: string | null = null;
  if (contact) {
    const { data: ex } = await supabase
      .from("conversations")
      .select("id")
      .eq("channel_id", channelId)
      .eq("contact_id", contact.id)
      .in("status", ["bot", "queued", "open"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    existingId = ex?.id ?? null;
  }
  return { phone: digits, name: opts.name ?? contact?.name ?? null, existingId };
}

export interface ContactDetails {
  id: string;
  name: string | null;
  phone: string;
  avatar_url: string | null;
  is_group: boolean;
  notes: string | null;
  custom_fields: Record<string, unknown>;
}

/** Detalhes do contato da conversa (para o painel lateral / CRM). */
export async function getContactDetails(conversationId: string): Promise<ContactDetails | null> {
  if (isPreview()) return null;
  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("conversation_overview")
    .select("contact_id")
    .eq("id", conversationId)
    .single();
  if (!conv) return null;
  const { data: c } = await supabase
    .from("contacts")
    .select("id, name, phone, avatar_url, is_group, notes, custom_fields")
    .eq("id", conv.contact_id)
    .single();
  return (c as ContactDetails) ?? null;
}

/** Salva nome, observações e campos personalizados (CRM) do contato. */
export async function updateContactDetails(
  conversationId: string,
  patch: { name?: string; notes?: string; custom_fields?: Record<string, unknown> },
) {
  if (isPreview()) return { ok: true };
  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("conversation_overview")
    .select("contact_id")
    .eq("id", conversationId)
    .single();
  if (!conv) return { ok: false };
  const upd: Record<string, unknown> = {};
  if (patch.name !== undefined) upd.name = patch.name.trim() || null;
  if (patch.notes !== undefined) upd.notes = patch.notes;
  if (patch.custom_fields !== undefined) upd.custom_fields = patch.custom_fields;
  await supabase.from("contacts").update(upd).eq("id", conv.contact_id);
  revalidatePath("/atendimento");
  return { ok: true };
}

export interface GroupInfoResult {
  name?: string;
  description?: string;
  participants: { phone: string; name: string | null; isAdmin: boolean; isOwner: boolean }[];
}

/** Informações do grupo da conversa (nome, descrição, participantes com nomes resolvidos). */
export async function getGroupInfo(conversationId: string): Promise<GroupInfoResult | null> {
  if (isPreview()) return null;
  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("conversation_overview")
    .select("channel_id, is_group, contact_jid, contact_phone")
    .eq("id", conversationId)
    .single();
  if (!conv?.is_group) return null;
  const { data: channel } = await supabase.from("channels").select("*").eq("id", conv.channel_id).single();
  const jid = (conv.contact_jid as string) || `${conv.contact_phone}@g.us`;
  const info = await getProvider(channel as Channel).getGroupInfo?.(jid);
  if (!info) return null;

  // Resolve nomes a partir dos nossos contatos.
  const phones = info.participants.map((p) => p.phone).filter(Boolean);
  const names = new Map<string, string>();
  if (phones.length) {
    const { data: contacts } = await supabase.from("contacts").select("phone, name").in("phone", phones);
    for (const c of contacts ?? []) if (c.name) names.set(c.phone, c.name);
  }
  return {
    name: info.name,
    description: info.description,
    participants: info.participants
      .filter((p) => p.phone)
      .map((p) => ({
        phone: p.phone,
        name: names.get(p.phone) ?? null,
        isAdmin: p.isAdmin,
        isOwner: p.phone === info.owner,
      }))
      .sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || Number(b.isAdmin) - Number(a.isAdmin)),
  };
}

export async function sendMessage(
  conversationId: string,
  text: string,
  replyToExternal?: string,
  mentions?: { name: string; phone: string }[],
) {
  const body = text.trim();
  if (!body) return { ok: false };
  if (isPreview()) return { ok: true }; // modo preview: client mantém otimista

  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const supabase = await createClient();

  const { data: conv } = await supabase
    .from("conversation_overview")
    .select("contact_phone, channel_id, status, is_group, contact_jid")
    .eq("id", conversationId)
    .single();
  if (!conv) throw new Error("Conversa não encontrada.");

  // Trecho da mensagem citada (para exibir o quote no nosso lado).
  let replyExcerpt: string | null = null;
  if (replyToExternal) {
    const { data: q } = await supabase
      .from("messages")
      .select("body, content_type")
      .eq("external_id", replyToExternal)
      .maybeSingle();
    replyExcerpt = q?.body ?? (q?.content_type && q.content_type !== "text" ? `[${q.content_type}]` : null);
  }

  const { data: msg } = await supabase
    .from("messages")
    .insert({
      organization_id: session.organization.id,
      conversation_id: conversationId,
      direction: "out",
      sender_type: "agent",
      sender_id: session.userId,
      content_type: "text",
      body,
      reply_to_external: replyToExternal ?? null,
      reply_excerpt: replyExcerpt,
      status: "pending",
    })
    .select("id")
    .single();

  // Envia pelo provedor do canal.
  try {
    const { data: channel } = await supabase
      .from("channels")
      .select("*")
      .eq("id", conv.channel_id)
      .single();
    const to = recipientOf(conv);
    // Menções: no texto enviado, "@Nome" vira "@<número>" (o que o WhatsApp linka).
    let waText = body;
    const mentionNums: string[] = [];
    for (const m of mentions ?? []) {
      const digits = m.phone.replace(/\D/g, "");
      if (!digits) continue;
      mentionNums.push(digits);
      waText = waText.split(`@${m.name}`).join(`@${digits}`);
    }
    const res = await getProvider(channel as Channel).sendText({
      to,
      text: waText,
      replyId: replyToExternal,
      mentions: mentionNums.length ? mentionNums : undefined,
    });
    await supabase
      .from("messages")
      .update({ status: "sent", external_id: res.externalId ?? null })
      .eq("id", msg!.id);
  } catch (e) {
    console.error("send error", e);
    await supabase.from("messages").update({ status: "failed" }).eq("id", msg!.id);
  }

  await supabase
    .from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      status: conv.status === "closed" ? "open" : conv.status,
    })
    .eq("id", conversationId);

  revalidatePath("/atendimento");
  return { ok: true };
}

export async function assignToMe(conversationId: string) {
  if (isPreview()) return;
  const session = await getSession();
  if (!session) throw new Error("Sessão inválida.");
  const supabase = await createClient();
  await supabase
    .from("conversations")
    .update({ assigned_user_id: session.userId, status: "open" })
    .eq("id", conversationId);
  revalidatePath("/atendimento");
}

export async function closeConversation(conversationId: string) {
  if (isPreview()) return;
  const supabase = await createClient();
  await supabase
    .from("conversations")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", conversationId);
  revalidatePath("/atendimento");
}

function kindFromMime(mime: string): { kind: "image" | "audio" | "video" | "document"; content: ContentType } {
  if (mime.startsWith("image")) return { kind: "image", content: "image" };
  if (mime.startsWith("audio")) return { kind: "audio", content: "audio" };
  if (mime.startsWith("video")) return { kind: "video", content: "video" };
  return { kind: "document", content: "document" };
}

/** Envia um arquivo (imagem/áudio/vídeo/documento) numa conversa. */
export async function sendMediaMessage(formData: FormData) {
  if (isPreview()) return { ok: true };
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");

  const conversationId = String(formData.get("conversationId") || "");
  const caption = String(formData.get("caption") || "").trim();
  const file = formData.get("file") as File | null;
  if (!conversationId || !file || file.size === 0) return { ok: false };

  const supabase = await createClient();
  const { data: conv } = await supabase
    .from("conversation_overview")
    .select("contact_phone, channel_id, status, is_group, contact_jid")
    .eq("id", conversationId)
    .single();
  if (!conv) throw new Error("Conversa não encontrada.");

  const override = String(formData.get("kind") || "");
  const { kind, content } =
    override === "sticker"
      ? ({ kind: "sticker", content: "sticker" } as const)
      : kindFromMime(file.type || "");

  // Upload pro bucket público "media" (service client ignora RLS no storage).
  const svc = createServiceClient();
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = (file.name?.split(".").pop() || (file.type.split("/")[1] ?? "bin")).slice(0, 5);
  const path = `${session.organization.id}/out/${conversationId}-${Date.now()}.${ext}`;
  const up = await svc.storage
    .from("media")
    .upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: true });
  if (up.error) throw new Error("Falha ao subir o arquivo.");
  const publicUrl = svc.storage.from("media").getPublicUrl(path).data.publicUrl;

  // Registra a mensagem (pendente) e envia pelo provedor.
  const { data: msg } = await supabase
    .from("messages")
    .insert({
      organization_id: session.organization.id,
      conversation_id: conversationId,
      direction: "out",
      sender_type: "agent",
      sender_id: session.userId,
      content_type: content,
      body: caption || null,
      media_url: publicUrl,
      status: "pending",
    })
    .select("id")
    .single();

  try {
    const { data: channel } = await supabase.from("channels").select("*").eq("id", conv.channel_id).single();
    const to = recipientOf(conv);
    const res = await getProvider(channel as Channel).sendMedia({ to, url: publicUrl, caption, kind });
    await supabase.from("messages").update({ status: "sent", external_id: res.externalId ?? null }).eq("id", msg!.id);
  } catch (e) {
    console.error("sendMedia error", e);
    await supabase.from("messages").update({ status: "failed" }).eq("id", msg!.id);
  }

  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString(), status: conv.status === "closed" ? "open" : conv.status })
    .eq("id", conversationId);
  revalidatePath("/atendimento");
  return { ok: true };
}

/** Destinatário do provedor: para grupos usa o JID completo (preserva traço). */
function recipientOf(conv: { contact_phone: string; is_group?: boolean; contact_jid?: string | null }) {
  if (conv.is_group) return conv.contact_jid || `${conv.contact_phone}@g.us`;
  return conv.contact_phone;
}

async function recipientFor(supabase: Awaited<ReturnType<typeof createClient>>, conversationId: string) {
  const { data: conv } = await supabase
    .from("conversation_overview")
    .select("contact_phone, channel_id, is_group, contact_jid")
    .eq("id", conversationId)
    .single();
  if (!conv) throw new Error("Conversa não encontrada.");
  const { data: channel } = await supabase.from("channels").select("*").eq("id", conv.channel_id).single();
  return { to: recipientOf(conv), channel: channel as Channel };
}

/** Reage a uma mensagem com um emoji (vazio remove a reação). */
export async function reactToMessage(conversationId: string, messageId: string, emoji: string) {
  if (isPreview()) return { ok: true };
  const supabase = await createClient();
  const { data: m } = await supabase.from("messages").select("external_id, reactions").eq("id", messageId).single();
  if (!m?.external_id) return { ok: false };
  const { to, channel } = await recipientFor(supabase, conversationId);
  try {
    await getProvider(channel).reactMessage?.(to, m.external_id, emoji);
  } catch (e) {
    console.error("react error", e);
  }
  const current = Array.isArray(m.reactions) ? (m.reactions as { emoji: string; by: string }[]) : [];
  const without = current.filter((r) => r.by !== "Você");
  const next = emoji ? [...without, { emoji, by: "Você" }] : without;
  await supabase.from("messages").update({ reactions: next }).eq("id", messageId);
  revalidatePath("/atendimento");
  return { ok: true };
}

/** Edita o texto de uma mensagem enviada. */
export async function editMessageAction(conversationId: string, messageId: string, newText: string) {
  if (isPreview()) return { ok: true };
  const text = newText.trim();
  if (!text) return { ok: false };
  const supabase = await createClient();
  const { data: m } = await supabase.from("messages").select("external_id").eq("id", messageId).single();
  if (!m?.external_id) return { ok: false };
  const { channel } = await recipientFor(supabase, conversationId);
  try {
    await getProvider(channel).editMessage?.(m.external_id, text);
  } catch (e) {
    console.error("edit error", e);
  }
  await supabase.from("messages").update({ body: text, edited: true }).eq("id", messageId);
  revalidatePath("/atendimento");
  return { ok: true };
}

/** Apaga uma mensagem (para todos). */
export async function deleteMessageAction(conversationId: string, messageId: string) {
  if (isPreview()) return { ok: true };
  const supabase = await createClient();
  const { data: m } = await supabase.from("messages").select("external_id").eq("id", messageId).single();
  const { channel } = await recipientFor(supabase, conversationId);
  try {
    if (m?.external_id) await getProvider(channel).deleteMessage?.(m.external_id);
  } catch (e) {
    console.error("delete error", e);
  }
  await supabase.from("messages").update({ is_deleted: true, body: null, media_url: null }).eq("id", messageId);
  revalidatePath("/atendimento");
  return { ok: true };
}

/** Marca as mensagens recebidas da conversa como lidas (✓✓ azul no WhatsApp). */
export async function markConversationRead(conversationId: string) {
  if (isPreview()) return { ok: true };
  const supabase = await createClient();
  const { data: msgs } = await supabase
    .from("messages")
    .select("id, external_id")
    .eq("conversation_id", conversationId)
    .eq("direction", "in")
    .neq("status", "read")
    .limit(200);
  const ids = (msgs ?? []).map((m) => m.external_id).filter(Boolean) as string[];
  if (!ids.length) return { ok: true };
  try {
    const { channel } = await recipientFor(supabase, conversationId);
    await getProvider(channel).markRead?.(ids);
  } catch (e) {
    console.warn("markRead", (e as Error)?.message);
  }
  await supabase.from("messages").update({ status: "read" }).eq("conversation_id", conversationId).eq("direction", "in");
  return { ok: true };
}

/** Envia uma localização na conversa. */
export async function sendLocationMessage(
  conversationId: string,
  loc: { latitude: number; longitude: number; name?: string; address?: string },
) {
  if (isPreview()) return { ok: true };
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const supabase = await createClient();
  const { to, channel } = await recipientFor(supabase, conversationId);
  const label = loc.name || loc.address || `${loc.latitude}, ${loc.longitude}`;
  const { data: msg } = await supabase
    .from("messages")
    .insert({
      organization_id: session.organization.id,
      conversation_id: conversationId,
      direction: "out",
      sender_type: "agent",
      sender_id: session.userId,
      content_type: "location",
      body: `📍 ${label}\nhttps://maps.google.com/?q=${loc.latitude},${loc.longitude}`,
      status: "pending",
    })
    .select("id")
    .single();
  try {
    const res = await getProvider(channel).sendLocation?.(to, loc);
    await supabase.from("messages").update({ status: "sent", external_id: res?.externalId ?? null }).eq("id", msg!.id);
  } catch (e) {
    console.error("sendLocation", e);
    await supabase.from("messages").update({ status: "failed" }).eq("id", msg!.id);
  }
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);
  revalidatePath("/atendimento");
  return { ok: true };
}

/** Envia um contato (vCard) na conversa. */
export async function sendContactMessage(conversationId: string, fullName: string, phoneNumber: string) {
  if (isPreview()) return { ok: true };
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const name = fullName.trim();
  const phone = phoneNumber.replace(/\D/g, "");
  if (!name || !phone) return { ok: false };
  const supabase = await createClient();
  const { to, channel } = await recipientFor(supabase, conversationId);
  const { data: msg } = await supabase
    .from("messages")
    .insert({
      organization_id: session.organization.id,
      conversation_id: conversationId,
      direction: "out",
      sender_type: "agent",
      sender_id: session.userId,
      content_type: "contact",
      body: `👤 ${name} — ${phone}`,
      status: "pending",
    })
    .select("id")
    .single();
  try {
    const res = await getProvider(channel).sendContact?.(to, { fullName: name, phoneNumber: phone });
    await supabase.from("messages").update({ status: "sent", external_id: res?.externalId ?? null }).eq("id", msg!.id);
  } catch (e) {
    console.error("sendContact", e);
    await supabase.from("messages").update({ status: "failed" }).eq("id", msg!.id);
  }
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversationId);
  revalidatePath("/atendimento");
  return { ok: true };
}

/** Silencia/dessilencia uma conversa (grupo ou contato). */
export async function toggleMute(conversationId: string, muted: boolean) {
  if (isPreview()) return { muted };
  const supabase = await createClient();
  await supabase.from("conversations").update({ is_muted: muted }).eq("id", conversationId);
  revalidatePath("/atendimento");
  return { muted };
}

export async function transferConversation(conversationId: string, toUserId: string) {
  if (isPreview()) return;
  const supabase = await createClient();
  await supabase
    .from("conversations")
    .update({ assigned_user_id: toUserId, status: "open" })
    .eq("id", conversationId);
  revalidatePath("/atendimento");
}
