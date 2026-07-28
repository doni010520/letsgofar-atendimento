"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { orgUpdate, orgDelete } from "@/lib/crud-helpers";

function taskFields(fd: FormData) {
  return {
    title: String(fd.get("title") || "").trim(),
    description: String(fd.get("description") || "").trim() || null,
    priority: String(fd.get("priority") || "medium"),
    due_date: String(fd.get("due_date") || "").trim() || null,
    due_time: String(fd.get("due_time") || "").trim() || null,
    recurrence_type: String(fd.get("recurrence_type") || "none"),
    contact_id: String(fd.get("contact_id") || "").trim() || null,
    conversation_id: String(fd.get("conversation_id") || "").trim() || null,
  };
}

/**
 * Cria a tarefa. Com vários responsáveis, gera UMA tarefa independente por
 * pessoa — foi o pedido da cliente: "mesma tarefa, mas cada uma faz a sua
 * parte, aparecendo no painel de cada uma".
 */
export async function createTask(fd: FormData) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");

  const fields = taskFields(fd);
  if (!fields.title) throw new Error("Informe o título da tarefa.");

  const assignees = fd.getAll("assigned_to").map(String).filter(Boolean);
  const targets = assignees.length ? assignees : [session.profile?.id ?? null];

  const sb = await createClient();
  const { data, error } = await sb
    .from("tasks")
    .insert(
      targets.map((assignee) => ({
        organization_id: session.organization!.id,
        created_by: session.profile?.id ?? null,
        assigned_to: assignee,
        ...fields,
      })),
    )
    .select("id");

  if (error) throw new Error(error.message);

  // Checklist inicial (mesmos itens em cada cópia).
  const items = fd.getAll("item").map(String).map((t) => t.trim()).filter(Boolean);
  if (items.length && data?.length) {
    await sb.from("task_items").insert(
      data.flatMap((task: { id: string }) =>
        items.map((title, position) => ({
          organization_id: session.organization!.id,
          task_id: task.id,
          title,
          position,
        })),
      ),
    );
  }

  revalidatePath("/tarefas");
  return data?.length ?? 0;
}

export async function updateTaskStatus(id: string, status: string) {
  const patch: Record<string, unknown> = { status };
  if (status === "completed") patch.completed_at = new Date().toISOString();
  if (status === "in_progress") patch.started_at = new Date().toISOString();
  if (status === "pending") {
    patch.completed_at = null;
    patch.started_at = null;
  }
  await orgUpdate("tasks", id, patch);
  revalidatePath("/tarefas");
}

export async function assignTask(id: string, profileId: string | null) {
  await orgUpdate("tasks", id, { assigned_to: profileId });
  revalidatePath("/tarefas");
}

export async function deleteTask(id: string) {
  await orgDelete("tasks", id);
  revalidatePath("/tarefas");
}

export async function toggleTaskItem(itemId: string, completed: boolean) {
  await orgUpdate("task_items", itemId, { completed });
  revalidatePath("/tarefas");
}

export async function addTaskComment(taskId: string, content: string) {
  const session = await getSession();
  if (!session?.organization || !content.trim()) return;
  const sb = await createClient();
  await sb.from("task_comments").insert({
    organization_id: session.organization.id,
    task_id: taskId,
    profile_id: session.profile?.id ?? null,
    content: content.trim(),
  });
  revalidatePath("/tarefas");
}
