import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MOCK_CONVERSATIONS, MOCK_MESSAGES, PREVIEW_MODE } from "@/lib/mock";
import type { ConversationOverview, Message } from "@/lib/types";

export async function getConversations(): Promise<ConversationOverview[]> {
  if (PREVIEW_MODE) return MOCK_CONVERSATIONS;
  noStore(); // sempre dados frescos (polling da inbox)

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  // Canais PRIVADOS: um canal com credentials.private_owner só aparece para esse
  // usuário (as conversas dele ficam ocultas para todos os demais).
  const { data: chans } = await supabase.from("channels").select("id, credentials");
  const hidden = new Set<string>();
  for (const c of (chans ?? []) as { id: string; credentials: Record<string, unknown> | null }[]) {
    const owner = c.credentials?.private_owner as string | undefined;
    if (owner && owner !== userId) hidden.add(c.id);
  }

  const { data } = await supabase
    .from("conversation_overview")
    .select("*")
    .order("last_message_at", { ascending: false, nullsFirst: false });
  let rows = (data as ConversationOverview[]) ?? [];
  // Grupo APARECE. Ficava escondido por herança do app que serviu de base, e a
  // escola atende turmas por grupo — o histórico estava no banco e ninguém via.
  if (hidden.size) rows = rows.filter((r) => !hidden.has(r.channel_id));
  // Quem vê o quê: TODOS veem todas as conversas, como no Chatwoot, onde os
  // seis eram membros da mesma caixa e Minhas/Não atribuídas/Todas eram só
  // filtros de tela. Aqui isso tinha virado permissão — atendente não enxergava
  // a conversa de outro atendente nem procurando. A separação que a equipe
  // pediu é a aba na lista, não uma parede.
  return rows;
}

/** Mapa conversa → lista de tag_ids (para filtros do board). */
export async function getConversationTagMap(): Promise<Record<string, string[]>> {
  if (PREVIEW_MODE) return {};
  noStore();
  const supabase = await createClient();
  const { data } = await supabase.from("conversation_tags").select("conversation_id, tag_id");
  const map: Record<string, string[]> = {};
  for (const row of (data as { conversation_id: string; tag_id: string }[]) ?? []) {
    (map[row.conversation_id] ??= []).push(row.tag_id);
  }
  return map;
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  if (PREVIEW_MODE) return MOCK_MESSAGES[conversationId] ?? [];
  noStore(); // sempre dados frescos (polling da inbox)

  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return (data as Message[]) ?? [];
}
