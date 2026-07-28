"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, Button, EmptyState } from "@/components/ui";
import type { TaskRow } from "@/app/(app)/tarefas/page";
import { createTask, updateTaskStatus, deleteTask, toggleTaskItem } from "@/app/(app)/tarefas/actions";
import { TaskKanbanView, TaskCalendarView, TaskDetailPanel } from "@/components/task-extras";

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
}: {
  tasks: TaskRow[];
  agents: { id: string; name: string | null }[];
}) {
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

  const visible = useMemo(() => {
    const d = today();
    return tasks.filter((t) => {
      const active = t.status === "pending" || t.status === "in_progress";
      if (view === "active") return active;
      if (view === "today") return active && t.due_date === d;
      if (view === "overdue") return active && !!t.due_date && t.due_date < d;
      return t.status === "completed";
    });
  }, [tasks, view]);

  const stats = useMemo(() => {
    const d = today();
    const active = tasks.filter((t) => t.status === "pending" || t.status === "in_progress");
    return {
      active: active.length,
      today: active.filter((t) => t.due_date === d).length,
      overdue: active.filter((t) => !!t.due_date && t.due_date < d).length,
    };
  }, [tasks]);

  async function onSubmit(fd: FormData) {
    setError("");
    if (!String(fd.get("title") || "").trim()) {
      setError("Informe o título da tarefa.");
      return;
    }
    items.forEach((i) => fd.append("item", i));
    try {
      await createTask(fd);
      setCreating(false);
      setItems([]);
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
      <div className="grid grid-cols-3 gap-3">
        <Card><p className="text-xs text-ink-soft">Ativas</p><p className="text-2xl font-semibold text-ink">{stats.active}</p></Card>
        <Card><p className="text-xs text-ink-soft">Para hoje</p><p className="text-2xl font-semibold text-ink">{stats.today}</p></Card>
        <Card><p className="text-xs text-ink-soft">Atrasadas</p><p className="text-2xl font-semibold text-red-600">{stats.overdue}</p></Card>
      </div>

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

      {mode === "kanban" && <TaskKanbanView tasks={tasks} onOpen={setDetail} />}
      {mode === "calendar" && <TaskCalendarView tasks={tasks} onOpen={setDetail} />}

      {detail && (
        <TaskDetailPanel
          task={tasks.find((t) => t.id === detail.id) ?? detail}
          agents={agents}
          onClose={() => setDetail(null)}
        />
      )}

      <div className={`flex items-center justify-between ${mode === "list" ? "" : "hidden"}`}>
        <div className="inline-flex rounded-lg bg-gray-100 p-1">
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
      </div>

      {mode === "list" && !visible.length && <EmptyState title="Nenhuma tarefa aqui" hint="Crie uma tarefa ou troque o filtro." />}

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
