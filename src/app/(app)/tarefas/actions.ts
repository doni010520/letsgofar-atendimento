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

/**
 * Move o card no kanban: muda a coluna (status) e/ou a ordem dentro dela.
 *
 * `position` vem da tela como a média entre o card de cima e o de baixo — é o
 * que evita renumerar a coluna a cada arrasto. Passar `null` deixa a tarefa na
 * ordem automática (por prazo), como era antes de existir ordem manual.
 */
export async function moveTask(id: string, status: string, position: number | null) {
  const patch: Record<string, unknown> = { position };
  if (status) {
    patch.status = status;
    if (status === "completed") patch.completed_at = new Date().toISOString();
    if (status === "in_progress") patch.started_at = new Date().toISOString();
    if (status === "pending") {
      patch.completed_at = null;
      patch.started_at = null;
    }
  }
  await orgUpdate("tasks", id, patch);
  revalidatePath("/tarefas");
}

export async function assignTask(id: string, profileId: string | null) {
  // `orgUpdate` não confere quantas linhas mudaram — se o RLS bloquear em
  // silêncio, a chamada "funciona" (sem erro) e zero linhas mudam. Foi
  // exatamente isso que aconteceu aqui até a migration 0036: reatribuir para
  // outra pessoa esbarrava na própria política de UPDATE. Conferir a linha
  // devolvida transforma esse silêncio num erro visível, se voltar a ocorrer.
  const sb = await createClient();
  const { data, error } = await sb.from("tasks").update({ assigned_to: profileId }).eq("id", id).select("id").maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Não foi possível mudar o responsável.");
  revalidatePath("/tarefas");
}

/**
 * Edita o conteúdo da tarefa (título, descrição, prioridade, prazo).
 * Só mexe no que veio no formulário — status, responsável e recorrência têm
 * ações próprias e não são tocados aqui.
 */
export async function updateTask(id: string, fd: FormData) {
  const titulo = String(fd.get("title") || "").trim();
  if (!titulo) throw new Error("O título não pode ficar vazio.");

  await orgUpdate("tasks", id, {
    title: titulo,
    description: String(fd.get("description") || "").trim() || null,
    priority: String(fd.get("priority") || "medium"),
    due_date: String(fd.get("due_date") || "").trim() || null,
    due_time: String(fd.get("due_time") || "").trim() || null,
    updated_at: new Date().toISOString(),
  });
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

/** Ações de ciclo de vida (paridade com o Chatwoot: start/cancel/reopen). */
export async function startTask(id: string) {
  await orgUpdate("tasks", id, { status: "in_progress", started_at: new Date().toISOString() });
  revalidatePath("/tarefas");
}

export async function cancelTask(id: string) {
  await orgUpdate("tasks", id, { status: "cancelled" });
  revalidatePath("/tarefas");
}

export async function reopenTask(id: string) {
  await orgUpdate("tasks", id, { status: "pending", completed_at: null, started_at: null });
  revalidatePath("/tarefas");
}

/** Dia/hora do item ficam de fora de propósito — igual ao Chatwoot, que só
 * carimba a hora de criação (automática) e nunca pede pra preencher nada. */
export async function addTaskItem(taskId: string, title: string) {
  const session = await getSession();
  if (!session?.organization || !title.trim()) return;
  const sb = await createClient();
  const { count } = await sb
    .from("task_items")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId);
  await sb.from("task_items").insert({
    organization_id: session.organization.id,
    task_id: taskId,
    title: title.trim(),
    position: count ?? 0,
  });
  revalidatePath("/tarefas");
}

export async function deleteTaskItem(itemId: string) {
  await orgDelete("task_items", itemId);
  revalidatePath("/tarefas");
}

export async function deleteTaskComment(commentId: string) {
  await orgDelete("task_comments", commentId);
  revalidatePath("/tarefas");
}

/** Anexa arquivos à tarefa (bucket "media", pasta por organização). */
export async function uploadTaskFiles(taskId: string, fd: FormData) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const org = session.organization.id;
  const sb = await createClient();

  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  for (const file of files) {
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${org}/tarefas/${taskId}/${Date.now()}-${safeName}`;
    const { error } = await sb.storage
      .from("media")
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) throw new Error(`Falha ao enviar ${file.name}: ${error.message}`);

    await sb.from("task_files").insert({
      organization_id: org,
      task_id: taskId,
      path,
      filename: file.name,
      content_type: file.type || null,
      byte_size: file.size,
    });
  }
  revalidatePath("/tarefas");
  return files.length;
}

export async function removeTaskFile(fileId: string) {
  const sb = await createClient();
  const { data: f } = await sb.from("task_files").select("path").eq("id", fileId).maybeSingle();
  if (f?.path) await sb.storage.from("media").remove([f.path]);
  await orgDelete("task_files", fileId);
  revalidatePath("/tarefas");
}

/** Etiquetas da tarefa (reusa as tags da organização). */
export async function setTaskTags(taskId: string, tagIds: string[]) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();
  await sb.from("task_tags").delete().eq("task_id", taskId);
  if (tagIds.length) {
    await sb.from("task_tags").insert(
      tagIds.map((tag_id) => ({
        organization_id: session.organization!.id,
        task_id: taskId,
        tag_id,
      })),
    );
  }
  revalidatePath("/tarefas");
}
