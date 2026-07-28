/**
 * Faxina periódica (C18/C19), migrada do fork do Chatwoot.
 *
 * Lá esses jobs existiam porque a caixa de notificações crescia sem limite
 * e sobravam conversas órfãs (contato apagado) travando listagens.
 */

import { createServiceClient } from "@/lib/supabase/server";

type Db = ReturnType<typeof createServiceClient>;

/** Quantas notificações manter por usuário. */
const KEEP_PER_USER = 300;
/** Idade máxima de uma notificação. */
const MAX_AGE_DAYS = 30;

/** C18 — remove notificações antigas e limita o total por usuário. */
export async function pruneNotifications(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString();

  const { data: old } = await db
    .from("internal_mentions")
    .select("id")
    .lte("created_at", cutoff)
    .limit(1000);

  let removed = 0;
  if (old?.length) {
    await db.from("internal_mentions").delete().in("id", old.map((m: { id: string }) => m.id));
    removed += old.length;
  }

  // Excedente por usuário (mantém as mais recentes).
  const { data: recipients } = await db
    .from("internal_mentions")
    .select("mentioned_user_id")
    .limit(5000);

  const counts = new Map<string, number>();
  for (const r of (recipients ?? []) as { mentioned_user_id: string | null }[]) {
    if (!r.mentioned_user_id) continue;
    counts.set(r.mentioned_user_id, (counts.get(r.mentioned_user_id) ?? 0) + 1);
  }

  for (const [profileId, total] of counts) {
    if (total <= KEEP_PER_USER) continue;
    const { data: excess } = await db
      .from("internal_mentions")
      .select("id")
      .eq("mentioned_user_id", profileId)
      .order("created_at", { ascending: false })
      .range(KEEP_PER_USER, total - 1);
    if (excess?.length) {
      await db.from("internal_mentions").delete().in("id", excess.map((m: { id: string }) => m.id));
      removed += excess.length;
    }
  }

  return removed;
}

/** C19 — apaga conversas sem contato (órfãs). */
export async function removeOrphanConversations(db: Db): Promise<number> {
  const { data: orphans } = await db
    .from("conversations")
    .select("id")
    .is("contact_id", null)
    .limit(500);

  if (!orphans?.length) return 0;
  await db.from("conversations").delete().in("id", orphans.map((c: { id: string }) => c.id));
  return orphans.length;
}

export async function runHousekeeping() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { notifications: 0, orphans: 0 };
  const db = createServiceClient();
  return {
    notifications: await pruneNotifications(db),
    orphans: await removeOrphanConversations(db),
  };
}
