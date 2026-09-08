"use client";

import { useMemo, useState, useTransition } from "react";
import { User } from "lucide-react";
import { Card, Button } from "@/components/ui";
import { toast } from "@/components/toast";
import type { TaskRow, TaskColumn } from "@/app/(app)/tarefas/page";
import { chaveDaColuna } from "@/lib/task-filtros";
import {
  updateTaskStatus,
  moveTask,
  addTaskComment,
  addTaskItem,
  deleteTaskItem,
  toggleTaskItem,
  startTask,
  cancelTask,
  uploadTaskFiles,
  removeTaskFile,
  setTaskTags,
  assignTask,
  updateTask,
  createTaskColumn,
  updateTaskColumn,
  deleteTaskColumn,
  reorderTaskColumns,
  moveTaskToColumn,
} from "@/app/(app)/tarefas/actions";
import { MAX_ANEXO_LABEL, erroDeTamanho, urlDoAnexo } from "@/lib/task-files";

const STATUS_COLUMNS = [
  { key: "pending", label: "A fazer" },
  { key: "in_progress", label: "Em andamento" },
  { key: "completed", label: "Concluídas" },
  { key: "cancelled", label: "Canceladas" },
] as const;

const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-blue-500",
  low: "bg-gray-400",
};

/**
 * Espaço entre posições. Arrastar para o fim soma isto à última posição, e
 * arrastar para o meio grava a média dos vizinhos — assim dá para inserir
 * entre dois cards muitas vezes antes de os números se aproximarem demais.
 */
const PASSO = 1000;

/**
 * Card de tarefa. Extraído para os DOIS quadros usarem exatamente o mesmo —
 * o de status e o de colunas próprias. Duplicar o markup faria os dois
 * divergirem na primeira mudança de visual.
 */
function CardTarefa({
  t,
  onOpen,
  arrastando,
  algoArrastando,
  onDragStart,
  onDragEnd,
  onSoltarAqui,
}: {
  t: TaskRow;
  onOpen: (t: TaskRow) => void;
  arrastando: boolean;
  algoArrastando: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onSoltarAqui: () => void;
}) {
  return (
              <div
                                draggable
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                // Soltar SOBRE um card insere antes dele; o `stopPropagation`
                // impede que a coluna também receba o evento e jogue no fim.
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.stopPropagation(); onSoltarAqui(); }}
                className={`cursor-grab rounded-lg border border-border bg-surface p-3 shadow-sm ${
                  arrastando ? "opacity-50" : ""
                } ${algoArrastando && !arrastando ? "hover:border-brand hover:border-t-2" : ""}`}
              >
                <button onClick={() => onOpen(t)} className="w-full text-left">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[t.priority] ?? "bg-gray-400"}`} />
                    <span className="truncate text-sm text-ink">{t.title}</span>
                  </div>
                  {t.due_date && (
                    <p className="mt-1 text-[11px] text-ink-soft">
                      {new Date(`${t.due_date}T12:00:00`).toLocaleDateString("pt-BR")}
                    </p>
                  )}
                </button>
                {/* Tarefa de lead: o nome leva direto à conversa, para escrever
                    para a pessoa sem ter que procurá-la pelo nome depois. */}
                {t.contacts && (
                  t.conversation_id ? (
                    <a
                      href={`/atendimento?c=${t.conversation_id}`}
                      className="mt-1.5 flex items-center gap-1 truncate rounded bg-brand/10 px-1.5 py-1 text-[11px] font-medium text-brand hover:bg-brand/20"
                    >
                      <User size={11} /> {t.contacts.name || t.contacts.phone}
                      <span className="ml-auto shrink-0">→</span>
                    </a>
                  ) : (
                    <p className="mt-1.5 flex items-center gap-1 truncate text-[11px] font-medium text-ink-soft">
                      <User size={11} /> {t.contacts.name || t.contacts.phone}
                    </p>
                  )
                )}
              </div>
  );
}

/**
 * Kanban de tarefas: UM quadro só, com as colunas de status e as colunas que
 * a equipe criou lado a lado.
 *
 * Antes eram dois quadros alternados, e a Ianka bateu de frente com isso:
 * "quando clico em minhas colunas somem as outras (andamento...), tem como
 * manter elas? E eu add as que eu quiser na nova coluna?". Estava certa — o
 * ponto de criar uma coluna é acrescentar ao fluxo, não trocar de fluxo.
 *
 * Uma tarefa aparece em UM lugar só (ver `chaveDaColuna`): na coluna própria
 * onde foi posta, ou, na falta dela, na coluna do seu status. Arrastar para
 * uma coluna de status limpa a coluna própria e grava o status; arrastar para
 * uma coluna própria guarda a coluna e NÃO mexe no status — o que estava "em
 * andamento" continua em andamento por baixo.
 */
export function TaskKanbanView({
  tasks,
  columns = [],
  onOpen,
  esconderFinalizadas = false,
}: {
  tasks: TaskRow[];
  /** Colunas criadas pela equipe. Vazio = quadro só de status, como sempre foi. */
  columns?: TaskColumn[];
  onOpen: (t: TaskRow) => void;
  /** Esconde as colunas Concluídas e Canceladas — a tela vive cheia delas. */
  esconderFinalizadas?: boolean;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");
  const [, startTransition] = useTransition();

  const proprias = useMemo(
    () => [...columns].sort((a, b) => a.position - b.position),
    [columns],
  );
  const idsProprias = useMemo(() => new Set(proprias.map((c) => c.id)), [proprias]);

  const status = esconderFinalizadas
    ? STATUS_COLUMNS.filter((c) => c.key !== "completed" && c.key !== "cancelled")
    : STATUS_COLUMNS;

  const porColuna = useMemo(() => {
    const map: Record<string, TaskRow[]> = {};
    for (const c of STATUS_COLUMNS) map[c.key] = [];
    for (const c of proprias) map[c.id] = [];
    for (const t of tasks) {
      const k = chaveDaColuna(t, idsProprias);
      (map[k] ??= []).push(t);
    }
    return map;
  }, [tasks, proprias, idsProprias]);

  /** Nova posição do card: média entre os vizinhos, como no quadro antigo. */
  function novaPosicao(chave: string, id: string, antesDe: string | null) {
    const lista = (porColuna[chave] ?? []).filter((t) => t.id !== id);
    const idx = antesDe ? lista.findIndex((t) => t.id === antesDe) : lista.length;
    const anterior = idx > 0 ? lista[idx - 1]?.position : null;
    const seguinte = idx < lista.length ? lista[idx]?.position : null;
    if (anterior == null && seguinte == null) return PASSO;
    if (anterior == null) return (seguinte as number) - PASSO;
    if (seguinte == null) return (anterior as number) + PASSO;
    return ((anterior as number) + (seguinte as number)) / 2;
  }

  function soltarNoStatus(statusKey: string, antesDe: string | null) {
    if (!dragging) return;
    const id = dragging;
    setDragging(null);
    startTransition(() => void moveTask(id, statusKey, novaPosicao(statusKey, id, antesDe)));
  }

  function soltarNaPropria(columnId: string, antesDe: string | null) {
    if (!dragging) return;
    const id = dragging;
    setDragging(null);
    startTransition(async () => {
      const r = await moveTaskToColumn(id, columnId, novaPosicao(columnId, id, antesDe));
      if (!r.ok) toast(r.erro, "error");
    });
  }

  function criar() {
    const limpo = nome.trim();
    if (!limpo) return;
    setNome("");
    setCriando(false);
    startTransition(async () => {
      const r = await createTaskColumn(limpo);
      if (!r.ok) toast(r.erro, "error");
      else toast('Coluna "' + limpo + '" criada.');
    });
  }

  function renomear(id: string) {
    const limpo = rascunho.trim();
    setEditando(null);
    if (!limpo) return;
    startTransition(async () => {
      const r = await updateTaskColumn(id, { name: limpo });
      if (!r.ok) toast(r.erro, "error");
    });
  }

  function apagar(c: TaskColumn) {
    const n = porColuna[c.id]?.length ?? 0;
    const aviso = n
      ? 'Apagar a coluna "' + c.name + '"? As ' + n + ' tarefa(s) dela voltam para a coluna do status — nenhuma tarefa é apagada.'
      : 'Apagar a coluna "' + c.name + '"?';
    if (!confirm(aviso)) return;
    startTransition(async () => {
      const r = await deleteTaskColumn(c.id);
      if (!r.ok) toast(r.erro, "error");
    });
  }

  function moverColuna(id: string, direcao: -1 | 1) {
    const idx = proprias.findIndex((c) => c.id === id);
    const alvo = idx + direcao;
    if (idx < 0 || alvo < 0 || alvo >= proprias.length) return;
    const nova = [...proprias];
    [nova[idx], nova[alvo]] = [nova[alvo], nova[idx]];
    startTransition(async () => {
      const r = await reorderTaskColumns(nova.map((c) => c.id));
      if (!r.ok) toast(r.erro, "error");
    });
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {/* Colunas de STATUS — continuam onde sempre estiveram. */}
      {status.map((col) => (
        <div
          key={col.key}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => soltarNoStatus(col.key, null)}
          className="flex w-64 shrink-0 flex-col rounded-card border border-border bg-surface/60"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium text-ink">{col.label}</span>
            <span className="text-xs text-ink-soft">{porColuna[col.key]?.length ?? 0}</span>
          </div>
          <div className="flex-1 space-y-2 p-2">
            {(porColuna[col.key] ?? []).map((t) => (
              <CardTarefa
                key={t.id}
                t={t}
                onOpen={onOpen}
                arrastando={dragging === t.id}
                algoArrastando={!!dragging}
                onDragStart={() => setDragging(t.id)}
                onDragEnd={() => setDragging(null)}
                onSoltarAqui={() => soltarNoStatus(col.key, t.id)}
              />
            ))}
            {!(porColuna[col.key] ?? []).length && (
              <p className="py-6 text-center text-xs text-ink-soft">vazio</p>
            )}
          </div>
        </div>
      ))}

      {/* Colunas da EQUIPE — a partir daqui é o que ela criou. */}
      {proprias.map((c, i) => (
        <div
          key={c.id}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => soltarNaPropria(c.id, null)}
          className="flex w-64 shrink-0 flex-col rounded-card border border-border bg-surface/60"
        >
          <div className="border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
              {editando === c.id ? (
                <input
                  autoFocus
                  value={rascunho}
                  onChange={(e) => setRascunho(e.target.value)}
                  onBlur={() => renomear(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") renomear(c.id);
                    if (e.key === "Escape") setEditando(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-border px-1.5 py-0.5 text-sm text-ink"
                />
              ) : (
                <button
                  onClick={() => { setEditando(c.id); setRascunho(c.name); }}
                  title="Clique para renomear"
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium text-ink hover:underline"
                >
                  {c.name}
                </button>
              )}
              <span className="shrink-0 text-xs text-ink-soft">{porColuna[c.id]?.length ?? 0}</span>
            </div>
            <div className="mt-1 flex items-center gap-1">
              <button
                onClick={() => moverColuna(c.id, -1)}
                disabled={i === 0}
                title="Mover coluna para a esquerda"
                className="rounded px-1.5 py-0.5 text-xs text-ink-soft hover:bg-gray-100 disabled:opacity-30"
              >
                &larr;
              </button>
              <button
                onClick={() => moverColuna(c.id, 1)}
                disabled={i === proprias.length - 1}
                title="Mover coluna para a direita"
                className="rounded px-1.5 py-0.5 text-xs text-ink-soft hover:bg-gray-100 disabled:opacity-30"
              >
                &rarr;
              </button>
              <button
                onClick={() => apagar(c)}
                title="Apagar coluna (as tarefas voltam para a coluna do status)"
                className="ml-auto rounded px-1.5 py-0.5 text-xs text-ink-soft hover:bg-red-50 hover:text-red-600"
              >
                apagar
              </button>
            </div>
          </div>
          <div className="flex-1 space-y-2 p-2">
            {(porColuna[c.id] ?? []).map((t) => (
              <CardTarefa
                key={t.id}
                t={t}
                onOpen={onOpen}
                arrastando={dragging === t.id}
                algoArrastando={!!dragging}
                onDragStart={() => setDragging(t.id)}
                onDragEnd={() => setDragging(null)}
                onSoltarAqui={() => soltarNaPropria(c.id, t.id)}
              />
            ))}
            {!(porColuna[c.id] ?? []).length && (
              <p className="py-6 text-center text-xs text-ink-soft">arraste tarefas para cá</p>
            )}
          </div>
        </div>
      ))}

      {/* Criar coluna nova, sempre no fim da fila. */}
      <div className="flex w-56 shrink-0 flex-col rounded-card border border-dashed border-border p-2">
        {criando ? (
          <div className="space-y-2">
            <input
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") criar();
                if (e.key === "Escape") { setCriando(false); setNome(""); }
              }}
              placeholder="Ex.: DELEGADAS"
              className="w-full rounded-lg border border-border px-2 py-1.5 text-sm text-ink"
            />
            <div className="flex gap-2">
              <Button onClick={criar}>Criar</Button>
              <Button variant="ghost" onClick={() => { setCriando(false); setNome(""); }}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCriando(true)}
            className="w-full rounded-lg px-3 py-6 text-sm font-medium text-ink-soft hover:bg-gray-50 hover:text-ink"
          >
            + Nova coluna
          </button>
        )}
      </div>
    </div>
  );
}

export function TaskCalendarView({
  tasks,
  onOpen,
}: {
  tasks: TaskRow[];
  onOpen: (t: TaskRow) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const byDay = useMemo(() => {
    const map: Record<string, TaskRow[]> = {};
    for (const t of tasks) {
      if (!t.due_date) continue;
      (map[t.due_date] ??= []).push(t);
    }
    return map;
  }, [tasks]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  const cells: (string | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const d = String(i + 1).padStart(2, "0");
      return `${year}-${String(month + 1).padStart(2, "0")}-${d}`;
    }),
  ];

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <Button variant="ghost" onClick={() => setCursor(new Date(year, month - 1, 1))}>
          ← anterior
        </Button>
        <span className="text-sm font-medium text-ink">
          {cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
        </span>
        <Button variant="ghost" onClick={() => setCursor(new Date(year, month + 1, 1))}>
          próximo →
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-soft">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
          <div key={i} className="py-1 font-medium">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />;
          const list = byDay[day] ?? [];
          const isToday = day === today;
          return (
            <div
              key={day}
              className={`min-h-20 rounded-lg border p-1 ${
                isToday ? "border-blue-400 bg-blue-50/40" : "border-border"
              }`}
            >
              <div className="text-[11px] text-ink-soft">{Number(day.slice(-2))}</div>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onOpen(t)}
                    title={t.contacts ? `${t.contacts.name || t.contacts.phone} — ${t.title}` : t.title}
                    className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] hover:bg-gray-100"
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[t.priority]}`} />
                    <span className={`truncate ${t.status === "completed" ? "line-through opacity-60" : ""}`}>
                      {/* No espaço apertado do calendário, o nome do contato
                          vale mais que o título ("Follow-up" repete sempre). */}
                      {t.contacts ? (t.contacts.name || t.contacts.phone) : t.title}
                    </span>
                  </button>
                ))}
                {list.length > 3 && (
                  <p className="px-1 text-[10px] text-ink-soft">+{list.length - 3}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Painel de detalhe: checklist, comentários e ações. */
export function TaskDetailPanel({
  task,
  agents,
  tags = [],
  onClose,
}: {
  task: TaskRow;
  agents: { id: string; name: string | null }[];
  tags?: { id: string; name: string; color: string | null }[];
  onClose: () => void;
}) {
  const [comment, setComment] = useState("");
  const [item, setItem] = useState("");
  const [editando, setEditando] = useState(false);
  /** Contador só para remontar (e limpar) o campo de arquivo após cada envio. */
  const [envio, setEnvio] = useState(0);
  const [pending, startTransition] = useTransition();

  const agentName = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a.name ?? "Sem nome"])),
    [agents],
  );

  const items = (task.task_items ?? []).sort((a, b) => a.position - b.position);
  const comments = (task.task_comments ?? []).sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">{task.title}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditando((v) => !v)}
              className="text-sm text-ink-soft hover:text-ink"
              title="Editar tarefa"
            >
              {editando ? "Cancelar" : "Editar"}
            </button>
            <button onClick={onClose} className="text-sm text-ink-soft">✕</button>
          </div>
        </div>

        {editando ? (
          <form
            action={(fd) => {
              // Mesmo corte que a criação faz: arquivo acima do teto derruba o
              // corpo inteiro da server action, e aí nem o texto seria salvo.
              const arquivos = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
              const grande = erroDeTamanho(arquivos);
              if (grande) {
                toast(grande, "error");
                return;
              }
              startTransition(async () => {
                try {
                  const r = await updateTask(task.id, fd);
                  setEditando(false);
                  if (r.erroAnexo) toast(`Tarefa salva, mas o anexo não subiu: ${r.erroAnexo}`, "error");
                  else if (r.anexos) toast(r.anexos === 1 ? "1 anexo adicionado." : `${r.anexos} anexos adicionados.`);
                } catch (err) {
                  toast(err instanceof Error ? err.message : "Não foi possível salvar a tarefa.", "error");
                }
              });
            }}
            className="mt-3 space-y-2"
          >
            <input
              name="title" defaultValue={task.title} required
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              placeholder="Título"
            />
            <textarea
              name="description" defaultValue={task.description ?? ""} rows={3}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              placeholder="Descrição"
            />
            <div className="flex flex-wrap gap-2">
              <select
                name="priority" defaultValue={task.priority}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              >
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
              </select>
              <input
                type="date" name="due_date" defaultValue={task.due_date ?? ""}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              />
              <input
                type="time" name="due_time" defaultValue={task.due_time?.slice(0, 5) ?? ""}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              />
            </div>
            {/* É aqui que a pessoa procura o anexo ("edito para colocar").
                Sem este campo, o formulário de edição salvava só o texto. */}
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-soft">Anexar arquivos</label>
              <input
                type="file"
                name="files"
                multiple
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink-soft file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink"
              />
              <p className="mt-1 text-[11px] text-ink-soft">Até {MAX_ANEXO_LABEL} por arquivo.</p>
            </div>
            <Button type="submit" disabled={pending}>{pending ? "Salvando..." : "Salvar"}</Button>
          </form>
        ) : (
          task.description && <p className="mt-2 text-sm text-ink-soft">{task.description}</p>
        )}

        {/* Contato do follow-up: leva direto à conversa, que é o próximo passo
            de quem abre a tarefa ("preciso falar com quem?"). */}
        {task.contacts && (
          <a
            href={task.conversation_id ? `/atendimento?c=${task.conversation_id}` : undefined}
            className={`mt-3 flex items-center gap-2 rounded-lg border border-border p-2 text-sm ${
              task.conversation_id ? "text-brand hover:border-brand" : "text-ink"
            }`}
          >
            <User size={14} />
            <span className="min-w-0 flex-1 truncate font-medium">
              {task.contacts.name || task.contacts.phone}
            </span>
            {task.conversation_id && <span className="shrink-0 text-xs">abrir conversa →</span>}
          </a>
        )}

        {/* Responsável: trocar transfere a tarefa para outra pessoa. */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          <label htmlFor="resp" className="shrink-0">Responsável:</label>
          <select
            id="resp"
            value={task.assigned_to ?? ""}
            disabled={pending}
            onChange={(e) => {
              const novo = e.target.value || null;
              startTransition(async () => {
                try {
                  await assignTask(task.id, novo);
                } catch (err) {
                  toast(err instanceof Error ? err.message : "Não foi possível mudar o responsável.", "error");
                }
              });
            }}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink"
          >
            <option value="">Sem responsável</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name ?? "Sem nome"}</option>
            ))}
          </select>
          {task.due_date && (
            <span>
              Prazo: {new Date(`${task.due_date}T12:00:00`).toLocaleDateString("pt-BR")}
              {task.due_time ? ` ${task.due_time.slice(0, 5)}` : ""}
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {task.status === "pending" && (
            <Button onClick={() => startTransition(() => void startTask(task.id))}>Iniciar</Button>
          )}
          {task.status !== "completed" && (
            <Button onClick={() => startTransition(() => void updateTaskStatus(task.id, "completed"))}>
              Concluir
            </Button>
          )}
          {task.status !== "cancelled" && task.status !== "completed" && (
            <Button variant="ghost" onClick={() => startTransition(() => void cancelTask(task.id))}>
              Cancelar tarefa
            </Button>
          )}
        </div>

        {/* Checklist */}
        <section className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-ink">Checklist</h3>
          <ul className="space-y-1">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={i.completed}
                  onChange={() => startTransition(() => void toggleTaskItem(i.id, !i.completed))}
                  className="rounded border-border"
                />
                <span className={`flex-1 ${i.completed ? "text-ink-soft line-through" : "text-ink"}`}>
                  {i.title}
                </span>
                {/* Hora de criação, automática — igual ao Chatwoot: ninguém preenche nada. */}
                <span className="shrink-0 text-[11px] text-ink-soft">
                  {new Date(i.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
                <button
                  onClick={() => startTransition(() => void deleteTaskItem(i.id))}
                  className="text-xs text-red-600"
                >
                  remover
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <input
              value={item}
              onChange={(e) => setItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && item.trim()) {
                  const v = item.trim();
                  setItem("");
                  startTransition(() => void addTaskItem(task.id, v));
                }
              }}
              placeholder="Novo item (Enter para adicionar)"
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
          </div>
        </section>

        {/* Etiquetas */}
        {tags.length > 0 && (
          <section className="mt-5">
            <h3 className="mb-2 text-sm font-semibold text-ink">Etiquetas</h3>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tg) => {
                const marcada = (task.task_tags ?? []).some((t) => t.tag_id === tg.id);
                return (
                  <button
                    key={tg.id}
                    onClick={() => {
                      const atuais = (task.task_tags ?? []).map((t) => t.tag_id);
                      const novas = marcada
                        ? atuais.filter((id) => id !== tg.id)
                        : [...atuais, tg.id];
                      startTransition(() => void setTaskTags(task.id, novas));
                    }}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      marcada ? "border-transparent text-white" : "border-border text-ink-soft"
                    }`}
                    style={marcada ? { background: tg.color ?? "#6366F1" } : undefined}
                  >
                    {tg.name}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Anexos */}
        <section className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-ink">Anexos</h3>
          <ul className="space-y-1">
            {(task.task_files ?? []).map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded border border-border px-2 py-1.5 text-sm">
                {/* Anexo que não abre não serve para nada: a lista só mostrava
                    o nome, sem link para o arquivo. */}
                <a
                  href={urlDoAnexo(f.path)}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-brand hover:underline"
                  title={f.filename}
                >
                  {f.filename}
                </a>
                {f.byte_size != null && (
                  <span className="ml-2 shrink-0 text-[11px] text-ink-soft">
                    {Math.max(1, Math.round(f.byte_size / 1024))} KB
                  </span>
                )}
                <button
                  onClick={() => startTransition(() => void removeTaskFile(f.id))}
                  className="ml-2 shrink-0 text-xs text-red-600"
                >
                  remover
                </button>
              </li>
            ))}
            {!(task.task_files ?? []).length && (
              <li className="text-xs text-ink-soft">Nenhum anexo.</li>
            )}
          </ul>
          {/* `key` limpa o campo depois de enviar — sem isso o mesmo arquivo
              fica selecionado e dá para reenviar sem perceber. */}
          <form
            key={envio}
            action={(fd) => {
              const arquivos = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
              if (!arquivos.length) {
                toast("Escolha um arquivo antes de enviar.", "error");
                return;
              }
              const grande = erroDeTamanho(arquivos);
              if (grande) {
                toast(grande, "error");
                return;
              }
              startTransition(async () => {
                const r = await uploadTaskFiles(task.id, fd);
                // O resultado era descartado com `void`: quando o upload
                // falhava, a tela não mudava e não dizia nada — que é
                // exatamente o "não fica os arquivos" relatado.
                if (r.erroAnexo) toast(r.erroAnexo, "error");
                else {
                  setEnvio((n) => n + 1);
                  toast(r.anexos === 1 ? "1 anexo adicionado." : `${r.anexos} anexos adicionados.`);
                }
              });
            }}
            className="mt-2 flex items-center gap-2"
          >
            <input type="file" name="files" multiple className="min-w-0 flex-1 text-xs text-ink-soft" />
            <Button type="submit" variant="ghost" disabled={pending}>
              {pending ? "Enviando..." : "Enviar"}
            </Button>
          </form>
        </section>

        {/* Comentários */}
        <section className="mt-5">
          <h3 className="mb-2 text-sm font-semibold text-ink">Comentários</h3>
          <div className="space-y-2">
            {comments.map((c) => (
              <div key={c.id} className="rounded-lg border border-border p-2">
                <p className="text-sm text-ink">{c.content}</p>
                <p className="mt-1 text-[11px] text-ink-soft">
                  {c.profile_id ? agentName[c.profile_id] ?? "—" : "—"} ·{" "}
                  {new Date(c.created_at).toLocaleString("pt-BR")}
                </p>
              </div>
            ))}
            {!comments.length && <p className="text-xs text-ink-soft">Nenhum comentário ainda.</p>}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Escrever um comentário"
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
            <Button
              disabled={pending || !comment.trim()}
              onClick={() => {
                const v = comment.trim();
                setComment("");
                startTransition(() => void addTaskComment(task.id, v));
              }}
            >
              Enviar
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
