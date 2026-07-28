/**
 * Relatórios migrados do fork do Chatwoot (B10):
 *  1. Distribuição do tempo de primeira resposta
 *  2. Matriz canal × etiqueta
 *  3. Contagem de mensagens enviadas
 */

import { createClient } from "@/lib/supabase/server";

export type Bucket = { label: string; count: number };

/** Faixas de tempo de primeira resposta (em minutos). */
const BUCKETS: { label: string; max: number }[] = [
  { label: "até 1 min", max: 1 },
  { label: "1–5 min", max: 5 },
  { label: "5–15 min", max: 15 },
  { label: "15–60 min", max: 60 },
  { label: "1–4 h", max: 240 },
  { label: "mais de 4 h", max: Infinity },
];

/**
 * 1. Distribuição do tempo de primeira resposta.
 * Mede da abertura da conversa até a primeira mensagem de saída.
 */
export async function firstResponseDistribution(
  from: string,
  to: string,
): Promise<Bucket[]> {
  const sb = await createClient();
  const { data: conversations } = await sb
    .from("conversations")
    .select("id, created_at")
    .gte("created_at", from)
    .lte("created_at", to)
    .limit(2000);

  const ids = (conversations ?? []).map((c: { id: string }) => c.id);
  if (!ids.length) return BUCKETS.map((b) => ({ label: b.label, count: 0 }));

  const { data: replies } = await sb
    .from("messages")
    .select("conversation_id, created_at")
    .in("conversation_id", ids)
    .eq("direction", "out")
    .order("created_at", { ascending: true })
    .limit(20000);

  // Primeira saída de cada conversa.
  const firstOut = new Map<string, string>();
  for (const m of (replies ?? []) as { conversation_id: string; created_at: string }[]) {
    if (!firstOut.has(m.conversation_id)) firstOut.set(m.conversation_id, m.created_at);
  }

  const counts = BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const c of (conversations ?? []) as { id: string; created_at: string }[]) {
    const reply = firstOut.get(c.id);
    if (!reply) continue;
    const minutes = (Date.parse(reply) - Date.parse(c.created_at)) / 60000;
    if (minutes < 0) continue;
    const idx = BUCKETS.findIndex((b) => minutes <= b.max);
    counts[idx === -1 ? BUCKETS.length - 1 : idx].count += 1;
  }
  return counts;
}

export type MatrixCell = { channel: string; tag: string; count: number };

/** 2. Matriz canal × etiqueta. */
export async function channelTagMatrix(from: string, to: string): Promise<MatrixCell[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("conversation_tags")
    .select("conversation_id, tags(name), conversations(channel_id, created_at, channels(name))")
    .limit(5000);

  const cells = new Map<string, MatrixCell>();
  for (const row of (data ?? []) as unknown as {
    tags: { name: string } | null;
    conversations: { created_at: string; channels: { name: string } | null } | null;
  }[]) {
    const created = row.conversations?.created_at;
    if (!created || created < from || created > to) continue;

    const channel = row.conversations?.channels?.name ?? "Sem canal";
    const tag = row.tags?.name ?? "Sem etiqueta";
    const key = `${channel}|${tag}`;
    const cell = cells.get(key) ?? { channel, tag, count: 0 };
    cell.count += 1;
    cells.set(key, cell);
  }
  return [...cells.values()].sort((a, b) => b.count - a.count);
}

export type SentPoint = { day: string; count: number };

/** 3. Mensagens enviadas por dia (apenas as efetivamente entregues). */
export async function outgoingMessagesCount(from: string, to: string): Promise<SentPoint[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("messages")
    .select("created_at, status")
    .eq("direction", "out")
    .gte("created_at", from)
    .lte("created_at", to)
    .limit(20000);

  const byDay = new Map<string, number>();
  for (const m of (data ?? []) as { created_at: string; status: string }[]) {
    // "failed" não conta como enviada — lição do falso envio.
    if (m.status === "failed") continue;
    const day = m.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  return [...byDay.entries()]
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
