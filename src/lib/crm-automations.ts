/**
 * Motor de automações do funil (migrado do KanbanAutomationService).
 *
 * Gatilho → condições → ações. Cada execução vira log, para dar para
 * auditar o que a automação fez (e por que não fez).
 */

import { createClient, createServiceClient } from "@/lib/supabase/server";

export {
  TRIGGER_LABELS,
  ACTION_LABELS,
  type CrmTrigger,
  type CrmActionType,
} from "@/lib/crm-labels";
import type { CrmTrigger, CrmActionType } from "@/lib/crm-labels";

type Condition = { field: string; operator: string; value: string };
type Action = { type: CrmActionType; config: Record<string, unknown> };

type Db = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createServiceClient>;

function matches(op: string, left: unknown, right: string): boolean {
  const l = String(left ?? "").toLowerCase();
  const r = String(right ?? "").toLowerCase();
  switch (op) {
    case "equals": return l === r;
    case "not_equals": return l !== r;
    case "contains": return l.includes(r);
    case "greater_than": return Number(left) > Number(right);
    case "less_than": return Number(left) < Number(right);
    case "is_empty": return !l;
    case "is_not_empty": return !!l;
    default: return true;
  }
}

async function conditionsMet(
  db: Db,
  conditions: Condition[],
  conversationId: string,
): Promise<boolean> {
  if (!conditions?.length) return true;
  const { data: conv } = await db
    .from("conversations")
    .select("*, contacts(name, phone)")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return false;

  const record = conv as Record<string, unknown> & { contacts?: { name?: string; phone?: string } };
  return conditions.every((c) => {
    const value =
      c.field === "contact_name" ? record.contacts?.name
      : c.field === "contact_phone" ? record.contacts?.phone
      : record[c.field];
    return matches(c.operator, value, c.value);
  });
}

async function runAction(
  db: Db,
  organizationId: string,
  action: Action,
  conversationId: string,
): Promise<Record<string, unknown>> {
  const cfg = action.config ?? {};

  switch (action.type) {
    case "move_to_stage": {
      const stageId = String(cfg.stage_id ?? "");
      if (!stageId) return { skipped: "sem estágio configurado" };
      await db.from("conversations").update({ stage_id: stageId }).eq("id", conversationId);
      return { moved_to: stageId };
    }
    case "assign_user": {
      const userId = String(cfg.user_id ?? "");
      if (!userId) return { skipped: "sem atendente configurado" };
      await db.from("conversations").update({ assigned_user_id: userId }).eq("id", conversationId);
      return { assigned_to: userId };
    }
    case "add_tag": {
      const tagId = String(cfg.tag_id ?? "");
      if (!tagId) return { skipped: "sem etiqueta configurada" };
      await db
        .from("conversation_tags")
        .upsert({ organization_id: organizationId, conversation_id: conversationId, tag_id: tagId });
      return { tag_added: tagId };
    }
    case "remove_tag": {
      const tagId = String(cfg.tag_id ?? "");
      await db
        .from("conversation_tags")
        .delete()
        .eq("conversation_id", conversationId)
        .eq("tag_id", tagId);
      return { tag_removed: tagId };
    }
    case "update_deal_value": {
      const value = cfg.value == null ? null : Number(cfg.value);
      await db.from("conversations").update({ deal_value: value }).eq("id", conversationId);
      return { deal_value: value };
    }
    case "create_task": {
      const { data: conv } = await db
        .from("conversations")
        .select("contact_id, assigned_user_id")
        .eq("id", conversationId)
        .maybeSingle();
      const dueInHours = Number(cfg.due_in_hours ?? 0);
      const due = dueInHours > 0 ? new Date(Date.now() + dueInHours * 3600_000) : null;
      await db.from("tasks").insert({
        organization_id: organizationId,
        conversation_id: conversationId,
        contact_id: (conv as { contact_id?: string } | null)?.contact_id ?? null,
        assigned_to:
          String(cfg.assign_to ?? "") ||
          (conv as { assigned_user_id?: string } | null)?.assigned_user_id ||
          null,
        title: String(cfg.title ?? "Tarefa automática"),
        description: cfg.description ? String(cfg.description) : null,
        priority: String(cfg.priority ?? "medium"),
        due_date: due ? due.toISOString().slice(0, 10) : null,
      });
      return { task_created: true };
    }
    case "send_webhook": {
      const url = String(cfg.url ?? "");
      if (!url) return { skipped: "sem URL" };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, ...(cfg.payload as object ?? {}) }),
      });
      return { webhook_status: res.status };
    }
    default:
      return { skipped: "ação desconhecida" };
  }
}

/** Executa as automações ativas do funil para um gatilho. */
export async function runAutomationsFor(params: {
  organizationId: string;
  pipelineId: string | null;
  conversationId: string;
  trigger: CrmTrigger;
  eventData?: Record<string, unknown>;
}): Promise<number> {
  const { organizationId, pipelineId, conversationId, trigger, eventData = {} } = params;
  if (!pipelineId) return 0;

  const db = await createClient();
  const { data: automations } = await db
    .from("pipeline_automations")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .eq("trigger_type", trigger)
    .eq("is_active", true)
    .order("execution_order", { ascending: true });

  let executed = 0;

  for (const a of automations ?? []) {
    const auto = a as {
      id: string;
      conditions: Condition[];
      actions: Action[];
      trigger_config: Record<string, unknown>;
      executions_count: number;
    };

    // Gatilho de estágio pode ser restrito a um "de/para" específico.
    if (trigger === "stage_changed") {
      const from = auto.trigger_config?.from_stage_id;
      const to = auto.trigger_config?.to_stage_id;
      if (from && String(from) !== String(eventData.from_stage_id ?? "")) continue;
      if (to && String(to) !== String(eventData.to_stage_id ?? "")) continue;
    }

    if (!(await conditionsMet(db, auto.conditions ?? [], conversationId))) {
      await db.from("pipeline_automation_logs").insert({
        organization_id: organizationId,
        automation_id: auto.id,
        conversation_id: conversationId,
        status: "skipped",
        result: { reason: "condições não atendidas" },
      });
      continue;
    }

    const results: Record<string, unknown>[] = [];
    let failed = false;
    for (const action of auto.actions ?? []) {
      try {
        results.push({ [action.type]: await runAction(db, organizationId, action, conversationId) });
      } catch (err) {
        failed = true;
        results.push({ [action.type]: { error: err instanceof Error ? err.message : "falhou" } });
      }
    }

    await db.from("pipeline_automation_logs").insert({
      organization_id: organizationId,
      automation_id: auto.id,
      conversation_id: conversationId,
      status: failed ? "failed" : "success",
      result: { actions: results, event: eventData },
    });

    await db
      .from("pipeline_automations")
      .update({
        executions_count: (auto.executions_count ?? 0) + 1,
        last_executed_at: new Date().toISOString(),
      })
      .eq("id", auto.id);

    executed += 1;
  }

  return executed;
}
