"use client";

import { useState, useTransition } from "react";
import { Card, Button, EmptyState } from "@/components/ui";
import { TRIGGER_LABELS, ACTION_LABELS, type CrmTrigger, type CrmActionType } from "@/lib/crm-labels";
import {
  createPipelineField,
  deletePipelineField,
  createAutomation,
  toggleAutomation,
  deleteAutomation,
} from "@/app/(app)/crm/config-actions";

export type PipelineField = {
  id: string;
  name: string;
  key: string;
  field_type: string;
  required: boolean;
  options: string[];
};

export type PipelineAutomation = {
  id: string;
  name: string;
  trigger_type: string;
  actions: { type: string; config: Record<string, unknown> }[];
  is_active: boolean;
  executions_count: number;
  last_executed_at: string | null;
};

const FIELD_TYPES = [
  { v: "text", l: "Texto" },
  { v: "number", l: "Número" },
  { v: "date", l: "Data" },
  { v: "select", l: "Lista de opções" },
  { v: "checkbox", l: "Sim/Não" },
  { v: "link", l: "Link" },
];

export function CrmConfig({
  pipelineId,
  fields,
  automations,
  stages,
  agents,
  tags,
}: {
  pipelineId: string;
  fields: PipelineField[];
  automations: PipelineAutomation[];
  stages: { id: string; name: string }[];
  agents: { id: string; name: string | null }[];
  tags: { id: string; name: string }[];
}) {
  const [tab, setTab] = useState<"fields" | "automations">("fields");
  const [actionType, setActionType] = useState<CrmActionType>("move_to_stage");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      setError("");
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Não foi possível salvar.");
      }
    });

  return (
    <div className="mt-4 space-y-4">
      <div className="inline-flex rounded-lg bg-gray-100 p-1">
        {([
          { k: "fields", l: "Campos personalizados" },
          { k: "automations", l: "Automações" },
        ] as const).map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              tab === t.k ? "bg-surface text-ink shadow-sm" : "text-ink-soft"
            }`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {tab === "fields" ? (
        <>
          <Card className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Novo campo</h3>
            <form
              action={(fd) => run(() => createPipelineField(pipelineId, fd))}
              className="grid gap-2 sm:grid-cols-[1fr_150px_1fr_auto]"
            >
              <input name="name" placeholder="Nome do campo"
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
              <select name="field_type" className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                {FIELD_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
              <input name="options" placeholder="Opções separadas por vírgula (para lista)"
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
              <Button type="submit" disabled={pending}>Adicionar</Button>
            </form>
            <label className="flex items-center gap-2 text-xs text-ink-soft">
              <input type="checkbox" name="required" className="rounded border-border" /> obrigatório
            </label>
          </Card>

          {!fields.length && <EmptyState title="Nenhum campo personalizado" hint="Crie campos para guardar informações do negócio." />}

          <div className="space-y-2">
            {fields.map((f) => (
              <Card key={f.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-ink">{f.name}</span>
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-ink-soft">
                      {`{${f.key}}`}
                    </span>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {FIELD_TYPES.find((t) => t.v === f.field_type)?.l ?? f.field_type}
                      {f.required && " · obrigatório"}
                      {f.options?.length ? ` · ${f.options.join(", ")}` : ""}
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => run(() => deletePipelineField(f.id))}>
                    Excluir
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <>
          <Card className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Nova automação</h3>
            <p className="text-xs text-ink-soft">Quando acontecer o gatilho, o sistema executa a ação.</p>
            <form action={(fd) => run(() => createAutomation(pipelineId, fd))} className="space-y-2">
              <input name="name" placeholder="Nome (ex.: Avisar quando fechar negócio)"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />

              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-soft">Quando (gatilho)</label>
                  <select name="trigger_type" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                    {(Object.keys(TRIGGER_LABELS) as CrmTrigger[]).map((t) => (
                      <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-soft">Então (ação)</label>
                  <select
                    name="action_type"
                    value={actionType}
                    onChange={(e) => setActionType(e.target.value as CrmActionType)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                  >
                    {(Object.keys(ACTION_LABELS) as CrmActionType[]).map((a) => (
                      <option key={a} value={a}>{ACTION_LABELS[a]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* campos da ação escolhida */}
              {actionType === "move_to_stage" && (
                <select name="action_stage_id" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                  <option value="">Escolha o estágio</option>
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              {actionType === "assign_user" && (
                <select name="action_user_id" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                  <option value="">Escolha o atendente</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name ?? "Sem nome"}</option>)}
                </select>
              )}
              {(actionType === "add_tag" || actionType === "remove_tag") && (
                <select name="action_tag_id" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                  <option value="">Escolha a etiqueta</option>
                  {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              {actionType === "create_task" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <input name="action_title" placeholder="Título da tarefa"
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
                  <input name="action_due_in_hours" type="number" placeholder="Prazo em horas"
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
                </div>
              )}
              {actionType === "send_webhook" && (
                <input name="action_url" placeholder="https://..."
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
              )}

              <Button type="submit" disabled={pending}>Criar automação</Button>
            </form>
          </Card>

          {!automations.length && <EmptyState title="Nenhuma automação" hint="Automatize o que se repete no funil." />}

          <div className="space-y-2">
            {automations.map((a) => (
              <Card key={a.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{a.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        a.is_active ? "bg-success-bg text-green-700" : "bg-gray-100 text-gray-600"
                      }`}>
                        {a.is_active ? "ativa" : "desligada"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {TRIGGER_LABELS[a.trigger_type as CrmTrigger] ?? a.trigger_type}
                      {a.actions?.[0] && ` → ${ACTION_LABELS[a.actions[0].type as CrmActionType] ?? a.actions[0].type}`}
                      {` · ${a.executions_count} execuç${a.executions_count === 1 ? "ão" : "ões"}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="ghost" onClick={() => run(() => toggleAutomation(a.id, !a.is_active))}>
                      {a.is_active ? "Desligar" : "Ligar"}
                    </Button>
                    <Button variant="danger" onClick={() => run(() => deleteAutomation(a.id))}>
                      Excluir
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
