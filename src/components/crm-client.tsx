"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, Button, EmptyState } from "@/components/ui";
import type { Pipeline, Stage, CrmCard } from "@/app/(app)/crm/page";
import { createPipeline, moveConversationStage, updateDealValue } from "@/app/(app)/crm/actions";
import { CrmConfig, type PipelineField, type PipelineAutomation } from "@/components/crm-config";

const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function CrmClient({
  pipelines,
  stages,
  cards,
  agents,
  fields = [],
  automations = [],
  tags = [],
}: {
  pipelines: Pipeline[];
  stages: Stage[];
  cards: CrmCard[];
  agents: { id: string; name: string | null }[];
  fields?: (PipelineField & { pipeline_id: string })[];
  automations?: (PipelineAutomation & { pipeline_id: string })[];
  tags?: { id: string; name: string }[];
}) {
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const [showConfig, setShowConfig] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const agentName = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a.name ?? "Sem nome"])),
    [agents],
  );

  const pipelineStages = useMemo(
    () => stages.filter((s) => s.pipeline_id === pipelineId).sort((a, b) => a.position - b.position),
    [stages, pipelineId],
  );

  const byStage = useMemo(() => {
    const map: Record<string, CrmCard[]> = {};
    for (const s of pipelineStages) map[s.id] = [];
    for (const c of cards) if (c.stage_id && map[c.stage_id]) map[c.stage_id].push(c);
    return map;
  }, [cards, pipelineStages]);

  const totals = useMemo(() => {
    const inPipeline = pipelineStages.flatMap((s) => byStage[s.id] ?? []);
    return {
      count: inPipeline.length,
      value: inPipeline.reduce((sum, c) => sum + Number(c.deal_value ?? 0), 0),
      won: inPipeline.filter((c) => c.closed_won === true).length,
    };
  }, [byStage, pipelineStages]);

  function onDrop(stageId: string) {
    if (!dragging) return;
    const id = dragging;
    setDragging(null);
    startTransition(() => void moveConversationStage(id, stageId));
  }

  if (!pipelines.length) {
    return (
      <div className="mt-6 max-w-md">
        <Card className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Crie seu primeiro funil</h3>
            <p className="mt-1 text-xs text-ink-soft">
              O funil já vem com os estágios Leads, Qualificação, Negociação e Fechamento.
            </p>
          </div>
          <form action={(fd) => startTransition(() => void createPipeline(fd))} className="flex gap-2">
            <input
              name="name"
              placeholder="Ex.: Comercial"
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
            <Button type="submit" disabled={pending}>Criar funil</Button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-gray-100 p-1">
          {pipelines.map((p) => (
            <button
              key={p.id}
              onClick={() => setPipelineId(p.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                pipelineId === p.id ? "bg-surface text-ink shadow-sm" : "text-ink-soft"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 text-xs text-ink-soft">
          <button onClick={() => setShowConfig((v) => !v)} className="underline hover:text-ink">
            {showConfig ? "ocultar configurações" : "campos e automações"}
          </button>
          <span><strong className="text-ink">{totals.count}</strong> negócios</span>
          <span><strong className="text-ink">{brl(totals.value)}</strong> em aberto</span>
          <span><strong className="text-green-700">{totals.won}</strong> ganhos</span>
        </div>
      </div>

      {showConfig && (
        <CrmConfig
          pipelineId={pipelineId}
          fields={fields.filter((f) => f.pipeline_id === pipelineId)}
          automations={automations.filter((a) => a.pipeline_id === pipelineId)}
          stages={pipelineStages.map((s) => ({ id: s.id, name: s.name }))}
          agents={agents}
          tags={tags}
        />
      )}

      {!pipelineStages.length && <EmptyState title="Este funil não tem estágios" />}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {pipelineStages.map((stage) => {
          const list = byStage[stage.id] ?? [];
          const stageValue = list.reduce((s, c) => s + Number(c.deal_value ?? 0), 0);

          return (
            <div
              key={stage.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(stage.id)}
              className="flex w-72 shrink-0 flex-col rounded-card border border-border bg-surface/60"
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color }} />
                  <span className="text-sm font-medium text-ink">{stage.name}</span>
                  {stage.outcome && (
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                      stage.outcome === "won" ? "bg-success-bg text-green-700" : "bg-red-100 text-red-700"
                    }`}>
                      {stage.outcome === "won" ? "ganho" : "perdido"}
                    </span>
                  )}
                </div>
                <span className="text-xs text-ink-soft">{list.length}</span>
              </div>

              <div className="px-3 py-1.5 text-[11px] text-ink-soft">{brl(stageValue)}</div>

              <div className="flex-1 space-y-2 p-2">
                {list.map((c) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => setDragging(c.id)}
                    onDragEnd={() => setDragging(null)}
                    className={`cursor-grab rounded-lg border border-border bg-surface p-3 shadow-sm ${
                      dragging === c.id ? "opacity-50" : ""
                    }`}
                  >
                    <p className="truncate text-sm font-medium text-ink">
                      {c.contacts?.name ?? c.contacts?.phone ?? "Sem nome"}
                    </p>
                    {c.contacts?.phone && (
                      <p className="truncate text-[11px] text-ink-soft">{c.contacts.phone}</p>
                    )}

                    {editingValue === c.id ? (
                      <input
                        autoFocus
                        type="number"
                        defaultValue={c.deal_value ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value === "" ? null : Number(e.target.value);
                          setEditingValue(null);
                          startTransition(() => void updateDealValue(c.id, v));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditingValue(null);
                        }}
                        className="mt-2 w-full rounded border border-border px-2 py-1 text-xs"
                      />
                    ) : (
                      <button
                        onClick={() => setEditingValue(c.id)}
                        className="mt-2 text-xs font-medium text-blue-700 hover:underline"
                      >
                        {c.deal_value != null ? brl(Number(c.deal_value)) : "definir valor"}
                      </button>
                    )}

                    {c.assigned_user_id && (
                      <p className="mt-1 truncate text-[11px] text-ink-soft">
                        {agentName[c.assigned_user_id] ?? "—"}
                      </p>
                    )}
                  </div>
                ))}

                {!list.length && (
                  <p className="py-6 text-center text-xs text-ink-soft">Arraste um card para cá</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
