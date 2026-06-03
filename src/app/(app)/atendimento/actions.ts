"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { getProvider } from "@/lib/whatsapp";
import { getMessages } from "@/lib/data/conversations";
import type { Channel, ContentType } from "@/lib/types";

const isPreview = () => !process.env.NEXT_PUBLIC_SUPABASE_URL;

export async function fetchMessages(conversationId: string) {
  return getMessages(conversationId);
}

export async function sendMessage(conversationId: string, text: string) {
  const body = text.trim();
  if (!body) return { ok: false };
  if (isPreview()) return { ok: true }; // modo preview: client mantém otimista

  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const supabase = await createClient();

  const { data: conv } = await supabase
    .from("conversation_overview")
    .select("contact_phone, channel_id, status, is_group")
    .eq("id", conversationId)
    .single();
  if (!conv) throw new Error("Conversa não encontrada.");

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
    const to =
      conv.is_group && channel?.type === "uazapi" ? `${conv.contact_phone}@g.us` : conv.contact_phone;
    const res = await getProvider(channel as Channel).sendText({ to, text: body });
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
    .select("contact_phone, channel_id, status, is_group")
    .eq("id", conversationId)
    .single();
  if (!conv) throw new Error("Conversa não encontrada.");

  const { kind, content } = kindFromMime(file.type || "");

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
    const to =
      conv.is_group && (channel as Channel)?.type === "uazapi"
        ? `${conv.contact_phone}@g.us`
        : conv.contact_phone;
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
