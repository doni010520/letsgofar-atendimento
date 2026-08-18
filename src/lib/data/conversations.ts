import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { MOCK_CONVERSATIONS, MOCK_MESSAGES, PREVIEW_MODE } from "@/lib/mock";
import type { ConversationOverview, Message } from "@/lib/types";

export async function getConversations(opts: { includeClosed?: boolean } = {}): Promise<ConversationOverview[]> {
  if (PREVIEW_MODE) return MOCK_CONVERSATIONS;
  noStore(); // sempre dados frescos (polling da inbox)
  const includeClosed = opts.includeClosed !== false;

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

  // PAGINA. O servidor corta em 1000 linhas por resposta e não avisa: com
  // 1.031 conversas, 31 nunca chegavam na tela — o "Todas 1000" redondo na aba
  // foi o que denunciou. Pedir `range(0, 9999)` NÃO resolve (testado: devolve
  // 1000 do mesmo jeito); só buscando página por página.
  //
  // includeClosed=false: usado pelo polling de 2.5s da caixa. Buscar as ~1000
  // conversas (877 delas encerradas e paradas há meses) inteiras, com os dois
  // LATERAL JOIN da view, TODA vez que o relógio bate — 24×/min, pra sempre,
  // enquanto a aba estiver aberta — é o que a Luana sentia como "trava",
  // "15 segundos pra abrir", "o botão começa a carregar sozinho": o servidor
  // faz esse trabalho pesado o tempo todo, competindo com o clique/a digitação
  // dela pelo mesmo pool de conexão. Excluir "closed" desse caminho quente
  // corta o de ~1000 linhas para ~150 — encerrada não muda mais, não precisa
  // de dado fresco a cada 2,5s.
  const PAGINA = 1000;
  let rows: ConversationOverview[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    let query = supabase
      .from("conversation_overview")
      .select("*")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .range(inicio, inicio + PAGINA - 1);
    if (!includeClosed) query = query.neq("status", "closed");
    const { data } = await query;
    const lote = (data as ConversationOverview[]) ?? [];
    rows = rows.concat(lote);
    // Teto de segurança: a caixa não é lugar para dezenas de milhares de
    // conversas — se chegar lá, o certo é buscar sob demanda, não crescer aqui.
    if (lote.length < PAGINA || rows.length >= 20000) break;
  }
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
