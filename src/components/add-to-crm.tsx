"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { addContactToCrm } from "@/app/(app)/crm/actions";

/**
 * "Adicionar ao funil" na lista de contatos (C15).
 *
 * A ação `addContactToCrm` existia desde o começo, mas nenhuma tela a chamava:
 * o contato que não veio da importação do Chatwoot não tinha como entrar no
 * funil. Era o "não achei nenhum local que tenha opção para adicionar ao CRM".
 */
export function AddToCrm({
  contactId,
  stageId,
  stageName,
  stages,
}: {
  contactId: string;
  /** Estágio atual, se o contato já está no funil. */
  stageId: string | null;
  stageName: string | null;
  stages: { id: string; name: string }[];
}) {
  const [abrir, setAbrir] = useState(false);
  const [atual, setAtual] = useState(stageName);
  const [pending, startTransition] = useTransition();

  if (!stages.length) return null;

  // Já está no funil: mostra onde, sem virar mais um botão para clicar à toa.
  if (atual && !abrir) {
    return (
      <button
        type="button"
        onClick={() => setAbrir(true)}
        title="Mudar de estágio"
        className="inline-flex items-center gap-1 rounded-lg bg-success-bg px-2 py-1 text-xs font-medium text-green-700 transition hover:brightness-95"
      >
        <Check size={13} /> {atual}
      </button>
    );
  }

  if (!abrir) {
    return (
      <button
        type="button"
        onClick={() => setAbrir(true)}
        title="Adicionar ao funil do CRM"
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-ink-soft transition hover:border-brand hover:text-brand"
      >
        <Plus size={13} /> Funil
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      {pending && <Loader2 size={13} className="animate-spin text-ink-soft" />}
      <select
        autoFocus
        disabled={pending}
        defaultValue={stageId ?? ""}
        onBlur={() => setAbrir(false)}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          const nome = stages.find((s) => s.id === v)?.name ?? null;
          startTransition(async () => {
            await addContactToCrm(contactId, v);
            setAtual(nome);
            setAbrir(false);
          });
        }}
        className="rounded-lg border border-border bg-surface px-2 py-1 text-xs"
      >
        <option value="">escolher estágio…</option>
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </span>
  );
}
