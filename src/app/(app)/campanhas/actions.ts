"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { orgInsert, orgUpdate, orgDelete } from "@/lib/crud-helpers";
import { getProvider } from "@/lib/whatsapp";
import type { Channel } from "@/lib/types";

export async function createCampaign(fd: FormData) {
  await orgInsert("campaigns", {
    name: String(fd.get("name") || "").trim(),
    channel_id: String(fd.get("channel_id") || "").trim() || null,
    automation_id: String(fd.get("automation_id") || "").trim() || null,
    status: "draft",
    scheduled_at: String(fd.get("scheduled_at") || "").trim() || null,
  });
  revalidatePath("/campanhas");
}

export async function updateCampaign(id: string, fd: FormData) {
  await orgUpdate("campaigns", id, {
    name: String(fd.get("name") || "").trim(),
    channel_id: String(fd.get("channel_id") || "").trim() || null,
    automation_id: String(fd.get("automation_id") || "").trim() || null,
    scheduled_at: String(fd.get("scheduled_at") || "").trim() || null,
  });
  revalidatePath("/campanhas");
}

export async function updateCampaignStatus(id: string, status: string) {
  await orgUpdate("campaigns", id, { status });
  revalidatePath("/campanhas");
}

export async function deleteCampaign(id: string) {
  await orgDelete("campaigns", id);
  revalidatePath("/campanhas");
}

/**
 * Disparo real de campanha: envia a msg do fluxo para cada contato.
 * Roda em background via server action — atualiza progresso na tabela.
 */
export async function launchCampaign(campaignId: string) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();

  const { data: campaign } = await sb.from("campaigns").select("*").eq("id", campaignId).single();
  if (!campaign || !campaign.channel_id) throw new Error("Campanha sem canal.");

  const { data: channel } = await sb.from("channels").select("*").eq("id", campaign.channel_id).single();
  if (!channel) throw new Error("Canal não encontrado.");

  // Audiência: todos os contatos não-grupo da org
  const { data: contacts } = await sb
    .from("contacts")
    .select("phone")
    .eq("organization_id", session.organization.id)
    .neq("is_group", true)
    .limit(10000);

  const phones = (contacts ?? []).map((c) => c.phone).filter(Boolean);
  await sb.from("campaigns").update({
    status: "running",
    started_at: new Date().toISOString(),
    total_contacts: phones.length,
    sent_count: 0,
    failed_count: 0,
  }).eq("id", campaignId);

  const provider = getProvider(channel as Channel);
  let sent = 0;
  let failed = 0;

  // Dispara mensagem simples (TODO: vincular ao fluxo de automação)
  const text = campaign.name; // simplificado; idealmente seria o conteúdo do fluxo

  for (const phone of phones) {
    try {
      await provider.sendText({ to: phone, text });
      sent++;
    } catch {
      failed++;
    }
    // Atualiza progresso a cada 10 mensagens
    if ((sent + failed) % 10 === 0) {
      const progress = Math.round(((sent + failed) / phones.length) * 100);
      await sb.from("campaigns").update({ sent_count: sent, failed_count: failed, progress }).eq("id", campaignId);
    }
  }

  await sb.from("campaigns").update({
    status: "done",
    sent_count: sent,
    failed_count: failed,
    progress: 100,
    finished_at: new Date().toISOString(),
    stats: { sent, failed, total: phones.length },
  }).eq("id", campaignId);

  revalidatePath("/campanhas");
}
