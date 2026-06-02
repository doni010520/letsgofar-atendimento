"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { getProvider } from "@/lib/whatsapp";
import { getMessages } from "@/lib/data/conversations";
import type { Channel } from "@/lib/types";

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
    .select("contact_phone, channel_id, status")
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
    const res = await getProvider(channel as Channel).sendText({
      to: conv.contact_phone,
      text: body,
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

export async function transferConversation(conversationId: string, toUserId: string) {
  if (isPreview()) return;
  const supabase = await createClient();
  await supabase
    .from("conversations")
    .update({ assigned_user_id: toUserId, status: "open" })
    .eq("id", conversationId);
  revalidatePath("/atendimento");
}
