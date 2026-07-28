"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { moveConversationStage, updateDealValue } from "@/app/(app)/crm/actions";

/**
 * Painel de CRM dentro da conversa (B11).
 * Deixa o atendente mover o estágio e ajustar o valor sem sair do atendimento.
 */
export function ConversationCrmPanel({
  conversationId,
  stageId,
  dealValue,
  closedWon,
  stages,
}: {
  conversationId: string;
  stageId: string | null;
  dealValue: number | null;
  closedWon: boolean | null;
  stages: { id: string; name: string; color: string; pipeline_id: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const brl = (v: number | null) =>
    v == null ? null : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  if (!stages.length) {
    return (
      <div className="rounded-lg border border-border p-3">
        <p className="text-xs text-ink-soft">
          Nenhum funil configurado. Crie um em <strong>CRM</strong> para acompanhar o negócio aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">CRM</h4>
        {closedWon != null && (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] ${
              closedWon ? "bg-success-bg text-green-700" : "bg-red-100 text-red-700"
            }`}
          >
            {closedWon ? "ganho" : "perdido"}
          </span>
        )}
      </div>

      <div>
        <label className="mb-1 block text-[11px] text-ink-soft">Estágio</label>
        <select
          value={stageId ?? ""}
          disabled={pending}
          onChange={(e) => {
            const v = e.target.value;
            if (v) startTransition(() => void moveConversationStage(conversationId, v));
          }}
          className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
        >
          <option value="">Fora do funil</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-[11px] text-ink-soft">Valor do negócio</label>
        {editing ? (
          <input
            autoFocus
            type="number"
            defaultValue={dealValue ?? ""}
            onBlur={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              setEditing(false);
              startTransition(() => void updateDealValue(conversationId, v));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs"
          />
        ) : (
          <Button variant="ghost" onClick={() => setEditing(true)}>
            {brl(dealValue) ?? "definir valor"}
          </Button>
        )}
      </div>
    </div>
  );
}
