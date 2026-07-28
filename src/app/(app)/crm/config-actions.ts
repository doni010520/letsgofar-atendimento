"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { orgUpdate, orgDelete } from "@/lib/crud-helpers";

// ── Campos personalizados do funil ───────────────────────────────────

export async function createPipelineField(pipelineId: string, fd: FormData) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const name = String(fd.get("name") || "").trim();
  if (!name) throw new Error("Informe o nome do campo.");

  // chave estável a partir do nome (é ela que aparece nas automações)
  const key =
    String(fd.get("key") || "")
      .trim()
      .toLowerCase() ||
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");

  const options = String(fd.get("options") || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const sb = await createClient();
  const { count } = await sb
    .from("pipeline_fields")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_id", pipelineId);

  const { error } = await sb.from("pipeline_fields").insert({
    organization_id: session.organization.id,
    pipeline_id: pipelineId,
    name,
    key,
    field_type: String(fd.get("field_type") || "text"),
    options,
    required: fd.get("required") === "on",
    position: count ?? 0,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/crm");
}

export async function deletePipelineField(id: string) {
  await orgDelete("pipeline_fields", id);
  revalidatePath("/crm");
}

/** Grava o valor de um campo personalizado numa conversa. */
export async function setFieldValue(fieldId: string, conversationId: string, value: string) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();

  const { data: existing } = await sb
    .from("pipeline_field_values")
    .select("id")
    .eq("field_id", fieldId)
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (existing?.id) {
    await sb
      .from("pipeline_field_values")
      .update({ value, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await sb.from("pipeline_field_values").insert({
      organization_id: session.organization.id,
      field_id: fieldId,
      conversation_id: conversationId,
      value,
    });
  }
  revalidatePath("/crm");
}

// ── Automações do funil ──────────────────────────────────────────────

export async function createAutomation(pipelineId: string, fd: FormData) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");

  const name = String(fd.get("name") || "").trim();
  if (!name) throw new Error("Dê um nome para a automação.");

  const actionType = String(fd.get("action_type") || "");
  const actions = actionType
    ? [
        {
          type: actionType,
          config: {
            stage_id: String(fd.get("action_stage_id") || "") || undefined,
            user_id: String(fd.get("action_user_id") || "") || undefined,
            tag_id: String(fd.get("action_tag_id") || "") || undefined,
            title: String(fd.get("action_title") || "") || undefined,
            due_in_hours: Number(fd.get("action_due_in_hours") || 0) || undefined,
            url: String(fd.get("action_url") || "") || undefined,
          },
        },
      ]
    : [];

  const sb = await createClient();
  const { error } = await sb.from("pipeline_automations").insert({
    organization_id: session.organization.id,
    pipeline_id: pipelineId,
    name,
    trigger_type: String(fd.get("trigger_type") || "stage_changed"),
    trigger_config: {
      from_stage_id: String(fd.get("from_stage_id") || "") || undefined,
      to_stage_id: String(fd.get("to_stage_id") || "") || undefined,
    },
    conditions: [],
    actions,
    is_active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/crm");
}

export async function toggleAutomation(id: string, isActive: boolean) {
  await orgUpdate("pipeline_automations", id, { is_active: isActive });
  revalidatePath("/crm");
}

export async function deleteAutomation(id: string) {
  await orgDelete("pipeline_automations", id);
  revalidatePath("/crm");
}
