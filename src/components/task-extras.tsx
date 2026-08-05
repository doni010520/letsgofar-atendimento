"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, Button } from "@/components/ui";
import type { TaskRow } from "@/app/(app)/tarefas/page";
import {
  updateTaskStatus,
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
} from "@/app/(app)/tarefas/actions";

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

/** Visão Kanban por status (paridade com o TaskKanban do Chatwoot). */
export function TaskKanbanView({
  tasks,
  onOpen,
}: {
  tasks: TaskRow[];
  onOpen: (t: TaskRow) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const byStatus = useMemo(() => {
    const map: Record<string, TaskRow[]> = {};
    for (const c of STATUS_COLUMNS) map[c.key] = [];
    for (const t of tasks) if (map[t.status]) map[t.status].push(t);
    return map;
  }, [tasks]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {STATUS_COLUMNS.map((col) => (
        <div
          key={col.key}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (!dragging) return;
            const id = dragging;
            setDragging(null);
            startTransition(() => void updateTaskStatus(id, col.key));
          }}
          className="flex w-64 shrink-0 flex-col rounded-card border border-border bg-surface/60"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium text-ink">{col.label}</span>
            <span className="text-xs text-ink-soft">{byStatus[col.key].length}</span>
          </div>
          <div className="flex-1 space-y-2 p-2">
            {byStatus[col.key].map((t) => (
              <button
                key={t.id}
                draggable
                onDragStart={() => setDragging(t.id)}
                onDragEnd={() => setDragging(null)}
                onClick={() => onOpen(t)}
                className={`w-full cursor-grab rounded-lg border border-border bg-surface p-3 text-left shadow-sm ${
                  dragging === t.id ? "opacity-50" : ""
                }`}
              >
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
            ))}
            {!byStatus[col.key].length && (
              <p className="py-6 text-center text-xs text-ink-soft">vazio</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Visão Calendário mensal (paridade com o TaskCalendar do Chatwoot). */
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
                    title={t.title}
                    className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] hover:bg-gray-100"
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[t.priority]}`} />
                    <span className={`truncate ${t.status === "completed" ? "line-through opacity-60" : ""}`}>
                      {t.title}
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
            action={(fd) =>
              startTransition(async () => {
                await updateTask(task.id, fd);
                setEditando(false);
              })
            }
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
            <Button type="submit" disabled={pending}>Salvar</Button>
          </form>
        ) : (
          task.description && <p className="mt-2 text-sm text-ink-soft">{task.description}</p>
        )}

        {/* Responsável: trocar transfere a tarefa para outra pessoa. */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          <label htmlFor="resp" className="shrink-0">Responsável:</label>
          <select
            id="resp"
            value={task.assigned_to ?? ""}
            disabled={pending}
            onChange={(e) =>
              startTransition(() => void assignTask(task.id, e.target.value || null))
            }
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
                <button
                  onClick={() => startTransition(() => void deleteTaskItem(i.id))}
                  className="text-xs text-red-600"
                >
                  remover
                </button>
              </li>
            ))}
          </ul>
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
            className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
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
                <span className="truncate text-ink">{f.filename}</span>
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
          <form
            action={(fd) => startTransition(() => void uploadTaskFiles(task.id, fd))}
            className="mt-2 flex items-center gap-2"
          >
            <input type="file" name="files" multiple className="text-xs text-ink-soft" />
            <Button type="submit" variant="ghost" disabled={pending}>Enviar</Button>
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
