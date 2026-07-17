"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { logEvent } from "@/lib/log";

/**
 * Move uma conversa entre as colunas do board (drag-drop):
 * - "open"  → assume p/ o atendente atual e pausa a IA;
 * - "queued"→ devolve à fila (sem atendente);
 * - "bot"   → devolve para a automação (reativa IA).
 */
export async function moveConversationStatus(id: string, status: "open" | "queued" | "bot") {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return { ok: false };
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();

  const patch: Record<string, unknown> = { status };
  if (status === "open") {
    patch.ai_enabled = false;
    patch.assigned_user_id = session.userId;
  } else if (status === "queued") {
    patch.ai_enabled = false;
    patch.assigned_user_id = null;
  } else if (status === "bot") {
    patch.ai_enabled = true;
    patch.bot_node_id = null;
  }

  const { error } = await sb.from("conversations").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  const label = status === "open" ? "assumiu (moveu p/ Em andamento, IA pausada)"
    : status === "queued" ? "moveu p/ Em espera (IA pausada)"
    : "devolveu para a IA";
  void logEvent("info", "atendente", `${session.profile?.name ?? "Atendente"} ${label} [V2]`, { conversationId: id, userId: session.userId, action: "mover", status }, session.organization.id);

  // Mensagem visível no chat (histórico de ativação/desativação da IA, com nome).
  const quem = session.profile?.name ? ` por ${session.profile.name}` : "";
  const nota = status === "bot" ? `Atendimento devolvido para a IA${quem}.`
    : status === "queued" ? `Atendimento devolvido à fila${quem} (IA pausada).`
    : `IA pausada — atendimento assumido${quem}.`;
  await sb.from("messages").insert({
    organization_id: session.organization.id,
    conversation_id: id,
    direction: "out",
    sender_type: "system",
    content_type: "text",
    body: nota,
    is_internal: true,
    status: "sent",
  }).then(() => {}, () => {});
  revalidatePath("/atendimento-v2");
  return { ok: true };
}
