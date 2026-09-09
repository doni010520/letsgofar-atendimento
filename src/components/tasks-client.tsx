"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, Button, EmptyState } from "@/components/ui";
import { toast } from "@/components/toast";
import type { TaskRow, TaskColumn } from "@/app/(app)/tarefas/page";
import { casaBusca, COL_DELEGADAS, COL_RECEBIDAS } from "@/lib/task-filtros";
import { createTask } from "@/app/(app)/tarefas/actions";
import { TaskKanbanView, TaskDetailPanel } from "@/components/task-extras";
import { MAX_ANEXO_LABEL, erroDeTamanho } from "@/lib/task-files";

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
  /** "todos" ou o id de alguém do time. Substitui os botões Todas/Minhas e
   *  atende o "filtrar de alguém do time" que ela pediu. */
  const [pessoa, setPessoa] = useState<string>("todos");
  /** Mostrar o quadro inteiro ou uma coluna só. */
  const [colunaVisivel, setColunaVisivel] = useState<string>("todas");
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
  const [detail, setDetail] = useState<TaskRow | null>(null);
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
    let lista = pessoa === "todos" ? tasks : tasks.filter((t) => t.assigned_to === pessoa);
    // A busca vale para lista, kanban e calendário — procurar tarefa era o
    // segundo pedido da Ianka, e não existia campo nenhum em nenhuma visão.
    if (busca.trim()) lista = lista.filter((t) => casaBusca(t, busca, agentName[t.assigned_to ?? ""]));
    if (tipo === "lead") lista = lista.filter((t) => t.contact_id);
    if (tipo === "equipe") lista = lista.filter((t) => !t.contact_id);
    if (esconderFinalizadas) {
      lista = lista.filter((t) => t.status !== "completed" && t.status !== "cancelled");
    }
    return lista;
  }, [tasks, pessoa, busca, agentName, tipo, esconderFinalizadas]);



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
    const base = pessoa === "todos" ? tasks : tasks.filter((t) => t.assigned_to === pessoa);
    return base.filter(
      (t) => t.contact_id && t.status !== "completed" && t.status !== "cancelled" && t.due_date === d,
    ).length;
  }, [tasks, pessoa]);

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

      {/* Follow-up de lead não aparece com o filtro "Da equipe". Sem este aviso,
          ele fica invisível justamente no dia em que precisa ser feito. */}
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

      {/* UMA linha de controles, em dropdown.
          Antes eram três fileiras de abas mais quatro botões, e a Ianka foi
          direta: "não fica um monte de clique, um monte de sub-aba que acaba
          sendo mais confuso do que útil". */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar tarefa"
          aria-label="Buscar tarefa"
          className="min-h-[40px] flex-1 rounded-lg border border-border px-3 py-2 text-sm text-ink placeholder:text-ink-soft sm:max-w-xs"
        />

        <select
          value={pessoa}
          onChange={(e) => setPessoa(e.target.value)}
          aria-label="Filtrar por pessoa"
          className="min-h-[40px] rounded-lg border border-border bg-surface px-2 py-2 text-sm text-ink"
        >
          <option value="todos">Time todo</option>
          {meId && <option value={meId}>Só as minhas</option>}
          {agents
            .filter((a) => a.id !== meId)
            .map((a) => (
              <option key={a.id} value={a.id}>{a.name ?? "Sem nome"}</option>
            ))}
        </select>

        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as typeof tipo)}
          aria-label="Filtrar por tipo"
          className="min-h-[40px] rounded-lg border border-border bg-surface px-2 py-2 text-sm text-ink"
        >
          <option value="equipe">Da equipe</option>
          <option value="lead">Follow-ups de leads</option>
          <option value="todas">Equipe + leads</option>
        </select>

        <select
          value={colunaVisivel}
          onChange={(e) => setColunaVisivel(e.target.value)}
          aria-label="Mostrar coluna"
          className="min-h-[40px] rounded-lg border border-border bg-surface px-2 py-2 text-sm text-ink"
        >
          <option value="todas">Todas as colunas</option>
          <option value="pending">A fazer</option>
          <option value="in_progress">Em andamento</option>
          {meId && <option value={COL_DELEGADAS}>Delegadas por mim</option>}
          {meId && <option value={COL_RECEBIDAS}>Recebidas</option>}
          <option value="completed">Concluídas</option>
          <option value="cancelled">Canceladas</option>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <button
          onClick={() => setEsconderFinalizadas((v) => !v)}
          aria-pressed={esconderFinalizadas}
          className={`min-h-[40px] rounded-lg border px-3 py-2 text-xs font-medium ${
            esconderFinalizadas
              ? "border-ink bg-ink text-white"
              : "border-border bg-surface text-ink-soft hover:text-ink"
          }`}
        >
          {esconderFinalizadas ? "Concluídas escondidas" : "Esconder concluídas"}
        </button>

        <Button onClick={() => setCreating(true)}>+ Nova tarefa</Button>
      </div>

      {/* Kanban é a ÚNICA visão.
          Lista e Calendário saíram a pedido dela: "uma que lista não dá nem
          pra gente pesquisar, pra escrolar isso daí, pra achar alguma coisa,
          fica difícil. Eu deixaria só o Kanban." */}
      <TaskKanbanView
        tasks={escopo}
        columns={columns}
        onOpen={setDetail}
        esconderFinalizadas={esconderFinalizadas}
        meId={meId}
        colunaVisivel={colunaVisivel}
      />

      {!escopo.length && (
        <EmptyState
          title="Nenhuma tarefa aqui"
          hint={busca.trim() ? "Nada com esse termo. Tente outro ou limpe a busca." : "Troque os filtros ou crie uma tarefa."}
        />
      )}

      {detail && (
        <TaskDetailPanel
          task={tasks.find((t) => t.id === detail.id) ?? detail}
          agents={agents}
          tags={tags}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
