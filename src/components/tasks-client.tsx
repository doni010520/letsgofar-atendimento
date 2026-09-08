"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, Button, EmptyState } from "@/components/ui";
import { toast } from "@/components/toast";
import type { TaskRow, TaskColumn } from "@/app/(app)/tarefas/page";
import { noEscopo, casaBusca, type EscopoPessoa } from "@/lib/task-filtros";
import { createTask, updateTaskStatus, deleteTask, toggleTaskItem } from "@/app/(app)/tarefas/actions";
import { TaskKanbanView, TaskCalendarView, TaskDetailPanel } from "@/components/task-extras";
import { MAX_ANEXO_LABEL, erroDeTamanho } from "@/lib/task-files";

const PRIORITY: Record<string, { label: string; cls: string }> = {
  urgent: { label: "Urgente", cls: "bg-red-100 text-red-700" },
  high: { label: "Alta", cls: "bg-orange-100 text-orange-700" },
  medium: { label: "Média", cls: "bg-blue-100 text-blue-700" },
  low: { label: "Baixa", cls: "bg-gray-100 text-gray-600" },
};

const VIEWS = [
  { key: "active", label: "Ativas" },
  { key: "today", label: "Hoje" },
  { key: "overdue", label: "Atrasadas" },
  { key: "completed", label: "Concluídas" },
] as const;

const today = () => new Date().toISOString().slice(0, 10);

export function TasksClient({
  tasks,
  agents,
  tags = [],
  columns = [],
  meId = null,
}: {
  tasks: TaskRow[];
  agents: { id: string; name: string | null }[];
  tags?: { id: string; name: string; color: string | null }[];
  /** Colunas do quadro próprio, criadas pela equipe. */
  columns?: TaskColumn[];
  /** Perfil de quem está logado — habilita o filtro "Minhas". */
  meId?: string | null;
}) {
  /**
   * Um recorte por pessoa de cada vez — antes eram dois booleanos que se
   * desligavam na mão, o que já é um estado único mal escrito.
   *
   * - `delegadas` (já existia): eu criei e passei para OUTRA pessoa.
   * - `recebidas` (novo, pedido da Ianka): outra pessoa criou e passou PARA
   *   MIM. É o espelho do de cima — "as que recebemos de terceiros e não
   *   misturar com as nossas". O botão que existia fazia só o sentido oposto.
   *
   * A regra fica em `src/lib/task-filtros.ts`, com teste.
   */
  const [escopoPessoa, setEscopoPessoa] = useState<EscopoPessoa>("todas");
  /** Busca por título, descrição ou nome de quem é responsável. */
  const [busca, setBusca] = useState("");

  /**
   * São dois tipos de tarefa e o Chatwoot os mantinha em lugares separados: a
   * aba de Tarefas listava só as da equipe (conferido na tela: "Pendente 47",
   * que são exatamente as `agent_tasks`), enquanto o follow-up de lead vivia
   * dentro da ficha do contato. Por isso "equipe" é o padrão — misturar os
   * dois inflava a contagem e tirava a aba do uso que ela tinha.
   */
  const [tipo, setTipo] = useState<"todas" | "lead" | "equipe">("equipe");
  const [esconderFinalizadas, setEsconderFinalizadas] = useState(false);
  const [mode, setMode] = useState<"list" | "kanban" | "calendar">("list");
  const [detail, setDetail] = useState<TaskRow | null>(null);
  const [view, setView] = useState<(typeof VIEWS)[number]["key"]>("active");
  const [creating, setCreating] = useState(false);
  const [items, setItems] = useState<string[]>([]);
  const [newItem, setNewItem] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const agentName = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a.name ?? "Sem nome"])),
    [agents],
  );

  // Escopo de pessoa: vale para lista, kanban e calendário — por isso é
  // aplicado antes, e não só dentro do filtro de status da lista.
  const escopo = useMemo(() => {
    let lista = tasks.filter((t) => noEscopo(t, escopoPessoa, meId));
    // A busca vale para lista, kanban e calendário — procurar tarefa era o
    // segundo pedido da Ianka, e não existia campo nenhum em nenhuma visão.
    if (busca.trim()) lista = lista.filter((t) => casaBusca(t, busca, agentName[t.assigned_to ?? ""]));
    if (tipo === "lead") lista = lista.filter((t) => t.contact_id);
    if (tipo === "equipe") lista = lista.filter((t) => !t.contact_id);
    if (esconderFinalizadas) {
      lista = lista.filter((t) => t.status !== "completed" && t.status !== "cancelled");
    }
    return lista;
  }, [tasks, escopoPessoa, busca, agentName, meId, tipo, esconderFinalizadas]);

  /** Follow-ups pendentes: tarefa presa a um contato. Vêm em lista própria. */
  const followUps = useMemo(
    () =>
      escopo
        .filter((t) => t.contact_id && t.status !== "completed" && t.status !== "cancelled")
        .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")),
    [escopo],
  );

  const visible = useMemo(() => {
    const d = today();
    return escopo.filter((t) => {
      // Follow-up de contato já aparece na seção de cima.
      if (t.contact_id && t.status !== "completed" && t.status !== "cancelled") return false;
      const active = t.status === "pending" || t.status === "in_progress";
      if (view === "active") return active;
      if (view === "today") return active && t.due_date === d;
      if (view === "overdue") return active && !!t.due_date && t.due_date < d;
      return t.status === "completed";
    });
  }, [escopo, view]);

  // Tarefas sinalizadas pelo cron: lembrete disparado ou venceram.
  const atencao = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (t.status === "pending" || t.status === "in_progress") &&
          (t.reminder_sent_at || t.overdue_notified_at),
      ),
    [tasks],
  );

  // O resumo conta o MESMO conjunto que a lista mostra. Contando tudo, ele
  // dizia "3 para hoje" com a lista vazia — as 3 eram de leads, escondidas
  // pelo filtro, e não havia como saber onde estavam.
  const stats = useMemo(() => {
    const d = today();
    const active = escopo.filter((t) => t.status === "pending" || t.status === "in_progress");
    return {
      active: active.length,
      today: active.filter((t) => t.due_date === d).length,
      overdue: active.filter((t) => !!t.due_date && t.due_date < d).length,
    };
  }, [escopo]);

  /** Follow-ups de lead para hoje — contados fora do filtro, para avisar que
   *  existem mesmo quando a aba está mostrando só tarefas da equipe. */
  const leadsHoje = useMemo(() => {
    const d = today();
    const base = tasks.filter((t) => noEscopo(t, escopoPessoa, meId));
    return base.filter(
      (t) => t.contact_id && t.status !== "completed" && t.status !== "cancelled" && t.due_date === d,
    ).length;
  }, [tasks, escopoPessoa, meId]);

  async function onSubmit(fd: FormData) {
    setError("");
    if (!String(fd.get("title") || "").trim()) {
      setError("Informe o título da tarefa.");
      return;
    }
    // Barra o arquivo grande ANTES de enviar: passando do teto da server
    // action o Next recusa o corpo inteiro e a tela não recebe motivo nenhum.
    const arquivos = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    const grande = erroDeTamanho(arquivos);
    if (grande) {
      setError(grande);
      return;
    }
    items.forEach((i) => fd.append("item", i));
    try {
      const r = await createTask(fd);
      setCreating(false);
      setItems([]);
      // A tarefa foi criada mesmo quando o anexo falha — avisa em vez de
      // deixar a pessoa achar que o arquivo subiu junto.
      if (r.erroAnexo) toast(`Tarefa criada, mas o anexo não subiu: ${r.erroAnexo}`, "error");
      else if (r.anexos) toast(r.anexos === 1 ? "Tarefa criada com 1 anexo." : `Tarefa criada com ${r.anexos} anexos.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar a tarefa.");
    }
  }

  if (creating) {
    return (
      <form action={(fd) => startTransition(() => void onSubmit(fd))} className="mt-6 max-w-2xl space-y-5">
        <Card className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Título</label>
            <input name="title" placeholder="Ex.: Preparar material do aluno novo"
              className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm" />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Descrição</label>
            <textarea name="description" rows={3}
              className="w-full resize-y rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm" />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Responsáveis</label>
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface p-2">
              {agents.map((a) => (
                <label key={a.id} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name="assigned_to" value={a.id} className="rounded border-border" />
                  <span>{a.name ?? "Sem nome"}</span>
                </label>
              ))}
              {!agents.length && <p className="text-xs text-ink-soft">Nenhum atendente cadastrado.</p>}
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              Marque uma ou mais pessoas. Cada uma recebe uma cópia independente da tarefa.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">Prioridade</label>
              <select name="priority" defaultValue="medium"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">Prazo</label>
              <input name="due_date" type="date"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">Hora</label>
              <input name="due_time" type="time"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">Repetir</label>
              <select name="recurrence_type" defaultValue="none"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                <option value="none">Não repetir</option>
                <option value="daily">Diariamente</option>
                <option value="weekly">Semanalmente</option>
                <option value="monthly">Mensalmente</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Checklist</label>
            <div className="flex gap-2">
              <input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (newItem.trim()) {
                      setItems((s) => [...s, newItem.trim()]);
                      setNewItem("");
                    }
                  }
                }}
                placeholder="Adicionar item e pressionar Enter"
                className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              />
            </div>
            {items.length > 0 && (
              <ul className="mt-2 space-y-1">
                {items.map((it, i) => (
                  <li key={`${it}-${i}`} className="flex items-center justify-between rounded border border-border px-3 py-1.5 text-sm">
                    <span>{it}</span>
                    <button type="button" className="text-xs text-red-600"
                      onClick={() => setItems((s) => s.filter((_, idx) => idx !== i))}>
                      remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Anexo já na criação — no Chatwoot o formulário de nova tarefa
              aceitava `files`, e sem este campo só dava para anexar depois,
              abrindo o detalhe. */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Anexos</label>
            <input
              type="file"
              name="files"
              multiple
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-soft file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink"
            />
            <p className="mt-1 text-xs text-ink-soft">
              Até {MAX_ANEXO_LABEL} por arquivo. Marcando mais de um responsável, cada cópia da
              tarefa recebe os mesmos anexos.
            </p>
          </div>
        </Card>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button>
          <Button type="submit" disabled={pending}>{pending ? "Salvando..." : "Criar tarefa"}</Button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {atencao.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/60">
          <p className="text-sm font-medium text-amber-800">
            {atencao.length} {atencao.length === 1 ? "tarefa precisa" : "tarefas precisam"} de atenção
          </p>
          <ul className="mt-1 space-y-0.5">
            {atencao.slice(0, 5).map((t) => (
              <li key={t.id} className="text-xs text-amber-900">
                <button onClick={() => setDetail(t)} className="hover:underline">
                  {t.title}
                </button>
                {t.overdue_notified_at ? " · venceu" : " · lembrete"}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Card><p className="text-xs text-ink-soft">Ativas</p><p className="text-2xl font-semibold text-ink">{stats.active}</p></Card>
        <Card><p className="text-xs text-ink-soft">Para hoje</p><p className="text-2xl font-semibold text-ink">{stats.today}</p></Card>
        <Card><p className="text-xs text-ink-soft">Atrasadas</p><p className="text-2xl font-semibold text-red-600">{stats.overdue}</p></Card>
      </div>

      {/* Follow-up de lead não aparece na aba "Da equipe". Sem este aviso, ele
          fica invisível justamente no dia em que precisa ser feito. */}
      {tipo !== "lead" && leadsHoje > 0 && (
        <button
          onClick={() => setTipo("lead")}
          className="flex w-full items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-left text-sm text-ink hover:bg-brand/10"
        >
          <span className="font-semibold text-brand">{leadsHoje}</span>
          <span>
            {leadsHoje === 1 ? "follow-up de lead para hoje" : "follow-ups de leads para hoje"}
          </span>
          <span className="ml-auto shrink-0 text-xs font-medium text-brand">ver →</span>
        </button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg bg-gray-100 p-1">
          {([
            { k: "list", l: "Lista" },
            { k: "kanban", l: "Kanban" },
            { k: "calendar", l: "Calendário" },
          ] as const).map((m) => (
            <button
              key={m.k}
              onClick={() => setMode(m.k)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                mode === m.k ? "bg-surface text-ink shadow-sm" : "text-ink-soft"
              }`}
            >
              {m.l}
            </button>
          ))}
        </div>
        <Button onClick={() => setCreating(true)}>+ Nova tarefa</Button>
      </div>

      {/* Quadro ÚNICO: colunas de status + as que a equipe criou, lado a lado.
          Eram dois quadros alternados e a Ianka reclamou com razão — criar uma
          coluna é acrescentar ao fluxo, não trocar de fluxo. */}
      {mode === "kanban" && (
        <TaskKanbanView
          tasks={escopo}
          columns={columns}
          onOpen={setDetail}
          esconderFinalizadas={esconderFinalizadas}
        />
      )}
      {mode === "calendar" && <TaskCalendarView tasks={escopo} onOpen={setDetail} />}

      {detail && (
        <TaskDetailPanel
          task={tasks.find((t) => t.id === detail.id) ?? detail}
          agents={agents}
          tags={tags}
          onClose={() => setDetail(null)}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={`inline-flex rounded-lg bg-gray-100 p-1 ${mode === "list" ? "" : "hidden"}`}>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                view === v.key ? "bg-surface text-ink shadow-sm" : "text-ink-soft"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {/* Separa os dois tipos em qualquer visão. */}
        <div className="inline-flex rounded-lg bg-gray-100 p-1">
          {([
            { k: "equipe", r: "Da equipe" },
            { k: "lead", r: "Follow-ups de leads" },
            { k: "todas", r: "Todas" },
          ] as const).map((o) => (
            <button
              key={o.k}
              onClick={() => setTipo(o.k)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                tipo === o.k ? "bg-surface text-ink shadow-sm" : "text-ink-soft"
              }`}
            >
              {o.r}
            </button>
          ))}
        </div>

        {/* Concluída/cancelada continua feita, mas ninguém precisa olhar para
            ela o dia inteiro — no kanban some a coluna, na lista some a linha. */}
        <button
          onClick={() => setEsconderFinalizadas((v) => !v)}
          aria-pressed={esconderFinalizadas}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
            esconderFinalizadas
              ? "border-ink bg-ink text-white"
              : "border-border bg-surface text-ink-soft hover:text-ink"
          }`}
        >
          {esconderFinalizadas ? "Concluídas escondidas" : "Esconder concluídas"}
        </button>

        {/* Recorte por pessoa — vale para lista, kanban e calendário. */}
        {meId && (
          <div className="inline-flex rounded-lg bg-gray-100 p-1">
            {([
              { k: "todas", r: "Todas", t: "Sem recorte por pessoa" },
              { k: "minhas", r: "Minhas", t: "Tarefas sob minha responsabilidade" },
              { k: "delegadas", r: "Delegadas por mim", t: "Eu criei e passei para outra pessoa" },
              { k: "recebidas", r: "Recebidas", t: "Outra pessoa criou e passou para mim — as que vêm de terceiros" },
            ] as const).map((o) => (
              <button
                key={o.k}
                onClick={() => setEscopoPessoa(o.k)}
                aria-pressed={escopoPessoa === o.k}
                title={o.t}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  escopoPessoa === o.k ? "bg-surface text-ink shadow-sm" : "text-ink-soft"
                }`}
              >
                {o.r}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Busca — vale para as três visões. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar tarefa por título, descrição ou responsável"
          aria-label="Buscar tarefa"
          className="min-h-[40px] flex-1 rounded-lg border border-border px-3 py-2 text-sm text-ink placeholder:text-ink-soft sm:max-w-md"
        />
        {busca && (
          <button
            type="button"
            onClick={() => setBusca("")}
            className="min-h-[40px] rounded-lg border border-border px-3 py-2 text-xs font-medium text-ink-soft hover:text-ink"
          >
            Limpar
          </button>
        )}
        {busca.trim() && (
          <span className="text-xs text-ink-soft">{escopo.length} encontrada(s)</span>
        )}
      </div>

      {/* Follow-ups: tarefas presas a um contato. No Chatwoot ficavam em outro
          lugar (dentro da ficha), e misturá-las com as tarefas da equipe
          atrapalhou a rotina de quem trabalha o funil — por isso vêm em cima e
          separadas, cada uma abrindo a conversa daquela pessoa. */}
      {mode === "list" && followUps.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Follow-ups de contatos <span className="text-brand">({followUps.length})</span>
          </h2>
          <div className="space-y-1.5">
            {followUps.map((t) => {
              const p = PRIORITY[t.priority] ?? PRIORITY.medium;
              const late = !!t.due_date && t.due_date < today();
              const quem = t.contacts?.name || t.contacts?.phone || "contato";
              const conteudo = (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{quem}</p>
                    <p className="truncate text-xs text-ink-soft">{t.title}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {t.due_date && (
                      <span className={`text-[11px] ${late ? "font-medium text-red-600" : "text-ink-soft"}`}>
                        {new Date(`${t.due_date}T12:00:00`).toLocaleDateString("pt-BR")}
                      </span>
                    )}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${p.cls}`}>{p.label}</span>
                  </div>
                </>
              );
              const cls = `flex items-center gap-3 rounded-lg border p-2.5 transition ${
                late ? "border-red-200 bg-red-50" : "border-border bg-surface"
              }`;
              // Sem conversa não há para onde levar; mostra sem link.
              return t.conversation_id ? (
                <a key={t.id} href={`/atendimento?c=${t.conversation_id}`} className={`${cls} hover:border-brand`}>
                  {conteudo}
                </a>
              ) : (
                <div key={t.id} className={cls}>{conteudo}</div>
              );
            })}
          </div>
        </section>
      )}

      {mode === "list" && !visible.length && !followUps.length && (
        <EmptyState title="Nenhuma tarefa aqui" hint="Crie uma tarefa ou troque o filtro." />
      )}

      {mode === "list" && visible.length > 0 && followUps.length > 0 && (
        <h2 className="pt-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
          Tarefas da equipe <span className="text-ink-soft">({visible.length})</span>
        </h2>
      )}

      <div className={`space-y-2 ${mode === "list" ? "" : "hidden"}`}>
        {visible.map((t) => {
          const p = PRIORITY[t.priority] ?? PRIORITY.medium;
          const done = t.status === "completed";
          const late = !done && !!t.due_date && t.due_date < today();
          const items = (t.task_items ?? []).sort((a, b) => a.position - b.position);
          const doneCount = items.filter((i) => i.completed).length;

          return (
            <Card key={t.id}>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={done}
                  onChange={() =>
                    startTransition(() => void updateTaskStatus(t.id, done ? "pending" : "completed"))
                  }
                  className="mt-1 rounded border-border"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setDetail(t)} className={`text-left font-medium text-ink hover:underline ${done ? "line-through opacity-60" : ""}`}>{t.title}</button>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${p.cls}`}>{p.label}</span>
                    {t.recurrence_type !== "none" && (
                      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">repete</span>
                    )}
                  </div>
                  {t.description && <p className="mt-1 text-sm text-ink-soft">{t.description}</p>}

                  <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-ink-soft">
                    {t.assigned_to && <span>{agentName[t.assigned_to] ?? "—"}</span>}
                    {t.due_date && (
                      <span className={late ? "font-medium text-red-600" : ""}>
                        {new Date(`${t.due_date}T12:00:00`).toLocaleDateString("pt-BR")}
                        {t.due_time ? ` ${t.due_time.slice(0, 5)}` : ""}
                        {late ? " · atrasada" : ""}
                      </span>
                    )}
                    {items.length > 0 && <span>{doneCount}/{items.length} itens</span>}
                  </div>

                  {items.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {items.map((i) => (
                        <li key={i.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={i.completed}
                            onChange={() => startTransition(() => void toggleTaskItem(i.id, !i.completed))}
                            className="rounded border-border"
                          />
                          <span className={i.completed ? "text-ink-soft line-through" : "text-ink"}>{i.title}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <Button variant="ghost" onClick={() => startTransition(() => void deleteTask(t.id))}>
                  Excluir
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
