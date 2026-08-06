"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { CalendarDays, Plus, Trash2, Check } from "lucide-react";
import {
  listContactTasks,
  createContactTask,
  toggleContactTask,
  deleteContactTask,
  type TarefaDoContato,
} from "@/app/(app)/atendimento/actions";
import { toast } from "@/components/toast";

const PRIORIDADES = [
  { valor: "low", rotulo: "Baixa", cls: "bg-gray-100 text-gray-600" },
  { valor: "medium", rotulo: "Média", cls: "bg-blue-100 text-blue-700" },
  { valor: "high", rotulo: "Alta", cls: "bg-orange-100 text-orange-700" },
  { valor: "urgent", rotulo: "Urgente", cls: "bg-red-100 text-red-700" },
];

const dataBR = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR");

/**
 * Tarefas do contato dentro da conversa — equivalente ao painel `KanbanTasks`
 * do Chatwoot, que a equipe usava para follow-up ("Entrar em contato em
 * junho"). É a mesma tabela da aba de Tarefas, recortada por contato.
 */
export function ContactTasks({ conversationId }: { conversationId: string }) {
  const [tarefas, setTarefas] = useState<TarefaDoContato[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [form, setForm] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [prioridade, setPrioridade] = useState("medium");
  const [pendente, startTransition] = useTransition();

  const recarregar = useCallback(async () => {
    const t = await listContactTasks(conversationId).catch(() => []);
    setTarefas(t);
    setCarregando(false);
  }, [conversationId]);

  useEffect(() => {
    setCarregando(true);
    void recarregar();
  }, [recarregar]);

  function limpar() {
    setTitulo(""); setDescricao(""); setVencimento(""); setPrioridade("medium"); setForm(false);
  }

  function salvar() {
    if (!titulo.trim()) return;
    startTransition(async () => {
      const r = await createContactTask(conversationId, {
        title: titulo, description: descricao, due_date: vencimento, priority: prioridade,
      });
      if (!r.ok) { toast(r.error ?? "Não foi possível criar a tarefa.", "error"); return; }
      limpar();
      await recarregar();
    });
  }

  const pendentes = tarefas.filter((t) => t.status !== "completed").length;

  return (
    <div className="border-t border-border p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          Tarefas {pendentes > 0 && <span className="text-brand">({pendentes})</span>}
        </h3>
        <button
          onClick={() => setForm((v) => !v)}
          className="flex items-center gap-1 text-xs text-brand hover:underline"
        >
          <Plus size={13} /> {form ? "Cancelar" : "Adicionar"}
        </button>
      </div>

      {form && (
        <div className="mb-3 space-y-2 rounded-lg border border-border p-2">
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") salvar(); }}
            placeholder="O que precisa ser feito?"
            autoFocus
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          />
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={2}
            placeholder="Detalhes (opcional)"
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <input
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
              className="flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
            />
            <select
              value={prioridade}
              onChange={(e) => setPrioridade(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
            >
              {PRIORIDADES.map((p) => (
                <option key={p.valor} value={p.valor}>{p.rotulo}</option>
              ))}
            </select>
          </div>
          <button
            onClick={salvar}
            disabled={pendente || !titulo.trim()}
            className="w-full rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Salvar tarefa
          </button>
        </div>
      )}

      {carregando ? (
        <p className="text-xs text-ink-soft">Carregando…</p>
      ) : !tarefas.length ? (
        <p className="text-xs text-ink-soft">Nenhuma tarefa para este contato.</p>
      ) : (
        <ul className="space-y-1.5">
          {tarefas.map((t) => {
            const feita = t.status === "completed";
            const pr = PRIORIDADES.find((p) => p.valor === t.priority) ?? PRIORIDADES[1];
            return (
              <li
                key={t.id}
                className={`flex items-start gap-2 rounded-lg border p-2 ${
                  t.atrasada ? "border-red-200 bg-red-50" : "border-border"
                }`}
              >
                <button
                  onClick={() => startTransition(async () => {
                    await toggleContactTask(t.id, !feita);
                    await recarregar();
                  })}
                  title={feita ? "Reabrir" : "Concluir"}
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    feita ? "border-brand bg-brand text-white" : "border-border"
                  }`}
                >
                  {feita && <Check size={11} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${feita ? "text-ink-soft line-through" : "text-ink"}`}>
                    {t.title}
                  </p>
                  {t.description && (
                    <p className="mt-0.5 text-xs text-ink-soft">{t.description}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {t.due_date && (
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] ${
                          t.atrasada ? "font-medium text-red-600" : "text-ink-soft"
                        }`}
                      >
                        <CalendarDays size={11} /> {dataBR(t.due_date)}
                        {t.due_time ? ` ${t.due_time.slice(0, 5)}` : ""}
                      </span>
                    )}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${pr.cls}`}>
                      {pr.rotulo}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => startTransition(async () => {
                    await deleteContactTask(t.id);
                    await recarregar();
                  })}
                  title="Excluir"
                  className="shrink-0 text-ink-soft hover:text-red-600"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
