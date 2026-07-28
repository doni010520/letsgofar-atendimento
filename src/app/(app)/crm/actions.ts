"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { orgUpdate, orgDelete } from "@/lib/crud-helpers";
import { runAutomationsFor } from "@/lib/crm-automations";

const DEFAULT_STAGES = [
  { name: "Leads", color: "#6366F1" },
  { name: "Qualificação", color: "#F59E0B" },
  { name: "Negociação", color: "#3B82F6" },
  { name: "Fechamento", color: "#10B981" },
];

export async function createPipeline(fd: FormData) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const name = String(fd.get("name") || "").trim();
  if (!name) throw new Error("Informe o nome do funil.");

  const sb = await createClient();
  const { data, error } = await sb
    .from("pipelines")
    .insert({ organization_id: session.organization.id, name })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Todo funil nasce utilizável, com os estágios padrão.
  await sb.from("pipeline_stages").insert(
    DEFAULT_STAGES.map((s, position) => ({
      organization_id: session.organization!.id,
      pipeline_id: (data as { id: string }).id,
      name: s.name,
      color: s.color,
      position,
    })),
  );

  revalidatePath("/crm");
  return (data as { id: string }).id;
}

export async function createStage(pipelineId: string, fd: FormData) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();
  const { count } = await sb
    .from("pipeline_stages")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_id", pipelineId);

  await sb.from("pipeline_stages").insert({
    organization_id: session.organization.id,
    pipeline_id: pipelineId,
    name: String(fd.get("name") || "").trim() || "Novo estágio",
    color: String(fd.get("color") || "#6366F1"),
    outcome: String(fd.get("outcome") || "") || null,
    position: count ?? 0,
  });
  revalidatePath("/crm");
}

export async function deleteStage(id: string) {
  await orgDelete("pipeline_stages", id);
  revalidatePath("/crm");
}

/**
 * Move a conversa de estágio. Além de mover, registra a atividade e dispara
 * as automações do funil (C14) — no Chatwoot isso era callback do model.
 */
export async function moveConversationStage(conversationId: string, stageId: string) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();

  const { data: before } = await sb
    .from("conversations")
    .select("id, stage_id, deal_value")
    .eq("id", conversationId)
    .single();

  const { data: stage } = await sb
    .from("pipeline_stages")
    .select("id, name, outcome, pipeline_id")
    .eq("id", stageId)
    .single();

  const patch: Record<string, unknown> = { stage_id: stageId };
  // Estágio terminal marca ganho/perdido e a data de fechamento.
  if (stage?.outcome === "won" || stage?.outcome === "lost") {
    patch.closed_won = stage.outcome === "won";
    patch.closed_at = new Date().toISOString();
  }
  await sb.from("conversations").update(patch).eq("id", conversationId);

  await sb.from("crm_activities").insert({
    organization_id: session.organization.id,
    conversation_id: conversationId,
    profile_id: session.profile?.id ?? null,
    kind: "stage_changed",
    title: `Movido para ${stage?.name ?? "outro estágio"}`,
    metadata: { from_stage_id: before?.stage_id ?? null, to_stage_id: stageId },
  });

  await runAutomationsFor({
    organizationId: session.organization.id,
    pipelineId: stage?.pipeline_id ?? null,
    conversationId,
    trigger:
      stage?.outcome === "won" ? "deal_won" : stage?.outcome === "lost" ? "deal_lost" : "stage_changed",
    eventData: { from_stage_id: before?.stage_id ?? null, to_stage_id: stageId },
  });

  revalidatePath("/crm");
}

export async function updateDealValue(conversationId: string, value: number | null) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();

  const { data: before } = await sb
    .from("conversations")
    .select("deal_value, stage_id")
    .eq("id", conversationId)
    .single();

  await sb.from("conversations").update({ deal_value: value }).eq("id", conversationId);

  await sb.from("crm_activities").insert({
    organization_id: session.organization.id,
    conversation_id: conversationId,
    profile_id: session.profile?.id ?? null,
    kind: "value_changed",
    title: value != null ? `Valor definido: R$ ${value}` : "Valor removido",
    metadata: { old_value: before?.deal_value ?? null, new_value: value },
  });

  const { data: stage } = await sb
    .from("pipeline_stages")
    .select("pipeline_id")
    .eq("id", before?.stage_id ?? "")
    .maybeSingle();

  await runAutomationsFor({
    organizationId: session.organization.id,
    pipelineId: stage?.pipeline_id ?? null,
    conversationId,
    trigger: "deal_value_changed",
    eventData: { old_value: before?.deal_value ?? null, new_value: value },
  });

  revalidatePath("/crm");
}

/** Adiciona um contato ao funil (C15). */
export async function addContactToCrm(contactId: string, stageId: string, dealValue?: number | null) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();

  await sb
    .from("contacts")
    .update({ stage_id: stageId, deal_value: dealValue ?? null })
    .eq("id", contactId);

  // A conversa aberta do contato acompanha o funil (herança C13).
  const { data: conv } = await sb
    .from("conversations")
    .select("id")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (conv?.id) {
    await sb
      .from("conversations")
      .update({ stage_id: stageId, deal_value: dealValue ?? null })
      .eq("id", conv.id);
  }

  revalidatePath("/crm");
}

export async function deletePipeline(id: string) {
  await orgDelete("pipelines", id);
  revalidatePath("/crm");
}

export async function renameStage(id: string, name: string) {
  await orgUpdate("pipeline_stages", id, { name });
  revalidatePath("/crm");
}
