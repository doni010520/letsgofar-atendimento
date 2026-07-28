"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { orgUpdate, orgDelete } from "@/lib/crud-helpers";
import { parseRecipientsCsv, normalizePhone, type Recipient } from "@/lib/broadcast";

export async function createBroadcast(fd: FormData): Promise<string | null> {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");

  const minMinutes = Number(fd.get("min_minutes") || 5);
  const maxMinutes = Number(fd.get("max_minutes") || 6);
  const assignee = String(fd.get("assigned_to") || "").trim();

  const sb = await createClient();
  const { data, error } = await sb
    .from("broadcasts")
    .insert({
      organization_id: session.organization.id,
      title: String(fd.get("title") || "").trim(),
      message_template: String(fd.get("message_template") || "").trim(),
      channel_id: String(fd.get("channel_id") || "").trim() || null,
      // por padrão, quem cria o disparo recebe as conversas
      assigned_to: assignee || session.profile?.id || null,
      created_by: session.profile?.id ?? null,
      min_interval: Math.round(minMinutes * 60),
      max_interval: Math.round(maxMinutes * 60),
      window_start: Number(fd.get("window_start") || 9),
      window_end: Number(fd.get("window_end") || 18),
      daily_cap: Number(fd.get("daily_cap") || 50),
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/disparos");
  return (data as { id: string } | null)?.id ?? null;
}

/** Substitui a lista de destinatários a partir do CSV enviado. */
export async function uploadRecipientsCsv(broadcastId: string, csv: string) {
  const recipients = parseRecipientsCsv(csv);
  if (!recipients.length) throw new Error("Nenhum contato válido no arquivo.");
  await replaceRecipients(broadcastId, recipients);
  return recipients.length;
}

/** Destinatários a partir dos contatos já salvos. */
export async function addSavedContacts(broadcastId: string, contactIds: string[]) {
  if (!contactIds.length) throw new Error("Selecione ao menos um contato.");
  const sb = await createClient();
  const { data: contacts } = await sb
    .from("contacts")
    .select("id, name, phone")
    .in("id", contactIds)
    .not("phone", "is", null);

  const recipients = (contacts ?? [])
    .map((c) => {
      const phone = normalizePhone(c.phone as string);
      return phone ? { phone, name: c.name as string, contact_id: c.id as string } : null;
    })
    .filter(Boolean) as (Recipient & { contact_id: string })[];

  if (!recipients.length) throw new Error("Nenhum contato com telefone válido.");
  await replaceRecipients(broadcastId, recipients);
  return recipients.length;
}

async function replaceRecipients(
  broadcastId: string,
  recipients: (Recipient & { contact_id?: string })[],
) {
  const sb = await createClient();
  const { data: broadcast } = await sb
    .from("broadcasts")
    .select("id, organization_id")
    .eq("id", broadcastId)
    .single();
  if (!broadcast) throw new Error("Disparo não encontrado.");

  await sb.from("broadcast_recipients").delete().eq("broadcast_id", broadcastId);
  await sb.from("broadcast_recipients").insert(
    recipients.map((r, index) => ({
      organization_id: broadcast.organization_id,
      broadcast_id: broadcastId,
      contact_id: r.contact_id ?? null,
      phone: r.phone,
      name: r.name ?? null,
      merge_fields: r.merge_fields ?? {},
      position: index,
    })),
  );

  await sb.from("broadcasts").update({ total_count: recipients.length }).eq("id", broadcastId);
  revalidatePath("/disparos");
}

export async function startBroadcast(id: string) {
  const sb = await createClient();
  const { count } = await sb
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", id)
    .eq("status", "pending");

  if (!count) throw new Error("Adicione contatos pendentes antes de iniciar.");

  await orgUpdate("broadcasts", id, {
    status: "running",
    started_at: new Date().toISOString(),
    // null = o job pega no próximo tique
    next_run_at: null,
  });
  revalidatePath("/disparos");
}

export async function pauseBroadcast(id: string) {
  await orgUpdate("broadcasts", id, { status: "paused" });
  revalidatePath("/disparos");
}

export async function cancelBroadcast(id: string) {
  await orgUpdate("broadcasts", id, { status: "cancelled" });
  revalidatePath("/disparos");
}

export async function deleteBroadcast(id: string) {
  await orgDelete("broadcasts", id);
  revalidatePath("/disparos");
}
