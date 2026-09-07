"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { orgUpdate, orgDelete } from "@/lib/crud-helpers";
import { MAX_ANEXO_BYTES, MAX_ANEXO_LABEL } from "@/lib/task-files";

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

/** Arquivos de verdade que vieram no campo `files` do formulário. */
function arquivosDoForm(fd: FormData): File[] {
  return fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
}

/**
 * Sobe os arquivos para o storage e grava o vínculo em `task_files`.
 *
 * O upload vai pelo cliente de SERVICE ROLE de propósito. O bucket `media`
 * tem RLS ligada e a única política que existe em `storage.objects` é de
 * SELECT (`media_public_read`, migration 0007) — qualquer INSERT feito com o
 * token do usuário volta como "new row violates row-level security policy".
 * Todo o resto do app que grava mídia (envio no atendimento, avatares, áudio
 * do bot) já sobe por service role; o anexo de tarefa era o único que tentava
 * subir pelo cliente do usuário e, por isso, o único que nunca funcionou —
 * `task_files` estava com ZERO linhas em produção, com 660 tarefas criadas.
 *
 * O caminho é montado no servidor a partir da organização da sessão e a
 * tarefa é conferida antes de subir qualquer coisa, então o service role aqui
 * não amplia o alcance de quem chamou. A linha em `task_files` continua indo
 * pelo cliente do usuário, sob RLS.
 */
async function anexarArquivos(taskIds: string[], files: File[], org: string): Promise<number> {
  if (!taskIds.length || !files.length) return 0;

  const grande = files.find((f) => f.size > MAX_ANEXO_BYTES);
  if (grande) throw new Error(`"${grande.name}" passa de ${MAX_ANEXO_LABEL}.`);

  const sb = await createClient();
  const svc = createServiceClient();
  let gravados = 0;

  for (const file of files) {
    // Lê UMA vez. Com vários responsáveis o mesmo arquivo vai para N tarefas,
    // e reaproveitar o `File` a cada volta arrisca subir arquivo vazio nas
    // cópias seguintes — o buffer resolve e ainda evita reler o corpo N vezes.
    const buf = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^\w.\-]+/g, "_") || "arquivo";
    const carimbo = Date.now();

    for (const taskId of taskIds) {
      const path = `${org}/tarefas/${taskId}/${carimbo}-${safeName}`;
      const up = await svc.storage
        .from("media")
        .upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: true });
      if (up.error) throw new Error(`Falha ao enviar ${file.name}: ${up.error.message}`);

      const { error } = await sb.from("task_files").insert({
        organization_id: org,
        task_id: taskId,
        path,
        filename: file.name,
        content_type: file.type || null,
        byte_size: file.size,
      });
      // Sem a linha o arquivo existe no storage mas some da tela — nesse caso
      // desfaz o upload em vez de deixar lixo pendurado.
      if (error) {
        await svc.storage.from("media").remove([path]);
        throw new Error(`Falha ao anexar ${file.name}: ${error.message}`);
      }
      gravados++;
    }
  }

  return gravados;
}

/** Confere que a tarefa existe e é da organização da sessão. */
async function tarefaDaOrg(taskId: string, org: string): Promise<boolean> {
  const sb = await createClient();
  const { data } = await sb
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .eq("organization_id", org)
    .maybeSingle();
  return !!data;
}

export type ResultadoAnexo = { anexos: number; erroAnexo?: string };

/**
 * Cria a tarefa. Com vários responsáveis, gera UMA tarefa independente por
 * pessoa — foi o pedido da cliente: "mesma tarefa, mas cada uma faz a sua
 * parte, aparecendo no painel de cada uma".
 *
 * Os anexos escolhidos na criação sobem para CADA cópia, pelo mesmo motivo:
 * cada responsável abre a tarefa dele e precisa ter o arquivo ali.
 */
export async function createTask(fd: FormData): Promise<ResultadoAnexo & { criadas: number }> {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const org = session.organization.id;

  const fields = taskFields(fd);
  if (!fields.title) throw new Error("Informe o título da tarefa.");

  const assignees = fd.getAll("assigned_to").map(String).filter(Boolean);
  const targets = assignees.length ? assignees : [session.profile?.id ?? null];

  const sb = await createClient();
  const { data, error } = await sb
    .from("tasks")
    .insert(
      targets.map((assignee) => ({
        organization_id: org,
        created_by: session.profile?.id ?? null,
        assigned_to: assignee,
        ...fields,
      })),
    )
    .select("id");

  if (error) throw new Error(error.message);

  const ids = (data ?? []).map((t: { id: string }) => t.id);

  // Checklist inicial (mesmos itens em cada cópia).
  const items = fd.getAll("item").map(String).map((t) => t.trim()).filter(Boolean);
  if (items.length && ids.length) {
    await sb.from("task_items").insert(
      ids.flatMap((taskId) =>
        items.map((title, position) => ({
          organization_id: org,
          task_id: taskId,
          title,
          position,
        })),
      ),
    );
  }

  // A tarefa já existe neste ponto: falha de anexo VOLTA COMO AVISO, não como
  // exceção. Estourando aqui, a tela mostraria "erro ao criar" e a pessoa
  // criaria a mesma tarefa de novo — duplicando o que já foi salvo.
  let anexos = 0;
  let erroAnexo: string | undefined;
  const arquivos = arquivosDoForm(fd);
  if (arquivos.length && ids.length) {
    try {
      anexos = await anexarArquivos(ids, arquivos, org);
    } catch (e) {
      erroAnexo = e instanceof Error ? e.message : "Não foi possível anexar os arquivos.";
    }
  }

  revalidatePath("/tarefas");
  return { criadas: ids.length, anexos, erroAnexo };
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
 * Edita o conteúdo da tarefa (título, descrição, prioridade, prazo) e anexa
 * o que veio no campo de arquivo. Status, responsável e recorrência têm ações
 * próprias e não são tocados aqui.
 *
 * O anexo entra aqui porque é onde a pessoa procura: ela abre "Editar" para
 * pôr o arquivo. Antes o formulário de edição nem tinha campo de arquivo — e
 * o que ela escolhesse não ia para lugar nenhum.
 */
export async function updateTask(id: string, fd: FormData): Promise<ResultadoAnexo> {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");

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

  // Mesma regra da criação: o texto já foi salvo, então falha de anexo volta
  // como aviso — não como "não deu para salvar".
  let anexos = 0;
  let erroAnexo: string | undefined;
  const arquivos = arquivosDoForm(fd);
  if (arquivos.length) {
    try {
      anexos = await anexarArquivos([id], arquivos, session.organization.id);
    } catch (e) {
      erroAnexo = e instanceof Error ? e.message : "Não foi possível anexar os arquivos.";
    }
  }

  revalidatePath("/tarefas");
  return { anexos, erroAnexo };
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

/**
 * Anexa arquivos a uma tarefa que já existe (seção "Anexos" do detalhe).
 *
 * Devolve o resultado em vez de lançar: erro lançado de server action chega
 * ao navegador redigido em produção ("An error occurred..."), e a tela mostra
 * essa frase inútil no lugar do motivo real.
 */
export async function uploadTaskFiles(taskId: string, fd: FormData): Promise<ResultadoAnexo> {
  const session = await getSession();
  if (!session?.organization) return { anexos: 0, erroAnexo: "Sessão inválida." };
  const org = session.organization.id;

  const arquivos = arquivosDoForm(fd);
  if (!arquivos.length) return { anexos: 0, erroAnexo: "Escolha um arquivo antes de enviar." };

  if (!(await tarefaDaOrg(taskId, org))) {
    return { anexos: 0, erroAnexo: "Tarefa não encontrada." };
  }

  try {
    const anexos = await anexarArquivos([taskId], arquivos, org);
    revalidatePath("/tarefas");
    return { anexos };
  } catch (e) {
    return { anexos: 0, erroAnexo: e instanceof Error ? e.message : "Falha ao enviar o arquivo." };
  }
}

export async function removeTaskFile(fileId: string) {
  const sb = await createClient();
  const { data: f } = await sb.from("task_files").select("path").eq("id", fileId).maybeSingle();
  // Apagar do storage também precisa de service role: `storage.objects` só
  // tem política de SELECT, então o DELETE do usuário falha em silêncio e o
  // arquivo fica no bucket para sempre, mesmo depois de sumir da tela.
  if (f?.path) await createServiceClient().storage.from("media").remove([f.path]);
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

// =====================================================================
// Colunas próprias do kanban de tarefas (pedido da Ianka)
//
// Estas ações CONFEREM quantas linhas mudaram, em vez de confiar no silêncio.
// `orgUpdate` não confere — e já custou caro duas vezes: a reatribuição de
// tarefa antes da migration 0036, e o botão de assinatura, que o RLS recusava
// devolvendo zero linhas e nenhum erro. Aqui a tela recebe o motivo.
// =====================================================================

const CORES_COLUNA = ["#6366F1", "#F59E0B", "#3B82F6", "#10B981", "#EF4444", "#8B5CF6", "#EC4899", "#64748B"];

export async function createTaskColumn(name: string) {
  const limpo = name.trim();
  if (!limpo) return { ok: false as const, erro: "Dê um nome para a coluna." };
  const session = await getSession();
  if (!session?.organization) return { ok: false as const, erro: "Sessão inválida." };
  const sb = await createClient();

  // Posição no fim e cor seguinte da paleta, para colunas novas não nascerem
  // todas iguais nem empilhadas na frente das que já existem.
  const { data: existentes } = await sb
    .from("task_columns")
    .select("id, position")
    .order("position", { ascending: false })
    .limit(1);
  const proxima = ((existentes?.[0]?.position as number | undefined) ?? -1) + 1;
  const { count } = await sb.from("task_columns").select("id", { count: "exact", head: true });

  const { data, error } = await sb
    .from("task_columns")
    .insert({
      organization_id: session.organization.id,
      name: limpo,
      position: proxima,
      color: CORES_COLUNA[(count ?? 0) % CORES_COLUNA.length],
      created_by: session.profile?.id ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = unique (organization_id, name).
    const dup = error.code === "23505";
    return { ok: false as const, erro: dup ? `Já existe uma coluna "${limpo}".` : error.message };
  }
  if (!data) return { ok: false as const, erro: "Não foi possível criar a coluna." };
  revalidatePath("/tarefas");
  return { ok: true as const, id: (data as { id: string }).id };
}

export async function updateTaskColumn(id: string, patch: { name?: string; color?: string }) {
  const upd: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const limpo = patch.name.trim();
    if (!limpo) return { ok: false as const, erro: "O nome não pode ficar vazio." };
    upd.name = limpo;
  }
  if (patch.color !== undefined) upd.color = patch.color;
  // Update vazio devolve 200 com lista VAZIA e o `.maybeSingle()` acharia que
  // sumiu — a mesma armadilha que quebrou o "Novo atendimento".
  if (!Object.keys(upd).length) return { ok: true as const };

  const sb = await createClient();
  const { data, error } = await sb.from("task_columns").update(upd).eq("id", id).select("id").maybeSingle();
  if (error) return { ok: false as const, erro: error.code === "23505" ? "Já existe uma coluna com esse nome." : error.message };
  if (!data) return { ok: false as const, erro: "Não foi possível salvar a coluna." };
  revalidatePath("/tarefas");
  return { ok: true as const };
}

/**
 * Apaga a coluna. As tarefas NÃO são apagadas: a FK é `on delete set null`,
 * então elas voltam para "Sem coluna". Apagar uma coluna nunca pode levar o
 * trabalho de alguém junto.
 */
export async function deleteTaskColumn(id: string) {
  const sb = await createClient();
  const { data, error } = await sb.from("task_columns").delete().eq("id", id).select("id").maybeSingle();
  if (error) return { ok: false as const, erro: error.message };
  if (!data) return { ok: false as const, erro: "Não foi possível apagar a coluna." };
  revalidatePath("/tarefas");
  return { ok: true as const };
}

/** Reordena as colunas na ordem em que os ids chegam. */
export async function reorderTaskColumns(ids: string[]) {
  const sb = await createClient();
  for (let i = 0; i < ids.length; i++) {
    const { error } = await sb.from("task_columns").update({ position: i }).eq("id", ids[i]);
    if (error) return { ok: false as const, erro: error.message };
  }
  revalidatePath("/tarefas");
  return { ok: true as const };
}

/**
 * Move a tarefa para uma coluna do quadro próprio (null = "Sem coluna").
 *
 * Não mexe em `status`: o quadro de colunas próprias é uma segunda leitura das
 * MESMAS tarefas, não um substituto do fluxo. Uma tarefa pode estar em
 * "DELEGADAS" e continuar "Em andamento" — que é justamente o que se perderia
 * se "delegada" virasse mais uma coluna de status.
 */
export async function moveTaskToColumn(taskId: string, columnId: string | null, position: number | null) {
  const sb = await createClient();
  const { data, error } = await sb
    .from("tasks")
    .update({ column_id: columnId, position })
    .eq("id", taskId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false as const, erro: error.message };
  if (!data) return { ok: false as const, erro: "Não foi possível mover a tarefa." };
  revalidatePath("/tarefas");
  return { ok: true as const };
}
