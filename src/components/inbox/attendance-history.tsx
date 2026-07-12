"use client";

import { useState } from "react";
import Link from "next/link";
import { History, Hash, ChevronDown, ExternalLink, AlertTriangle } from "lucide-react";

export type CloseSummary = { motivo: string; solucao: string; encaminhamentos: string; pendencias: string };
export type AttendanceHistoryItem = {
  id: string;
  protocol: string | null;
  status: string;
  opened_at: string | null;
  closed_at: string | null;
  summary: CloseSummary | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Histórico de atendimentos do contato — com o RESUMO de cada encerramento
 * (motivo, solução, encaminhamentos, pendências) expansível, alerta de pendência
 * do último atendimento e link para reabrir/ler a conversa antiga. Permite que
 * qualquer atendente dê continuidade sem o cliente repetir a história.
 */
export function AttendanceHistory({ items, currentId }: { items: AttendanceHistoryItem[]; currentId?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!items.length) return null;

  // Pendência mais recente de um atendimento ENCERRADO (exceto o atual).
  const pend = items.find((h) => h.id !== currentId && h.status === "closed" && h.summary?.pendencias?.trim());

  return (
    <div>
      {pend && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">
              Pendência do último atendimento{pend.protocol ? ` (#${pend.protocol})` : ""}:
            </p>
            <p className="whitespace-pre-wrap break-words">{pend.summary!.pendencias}</p>
          </div>
        </div>
      )}

      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase text-ink-soft">
        <History size={12} /> Atendimentos anteriores
      </p>
      <div className="space-y-1.5">
        {items.map((h) => {
          const s = h.summary;
          const hasSummary = !!(s && (s.motivo || s.solucao || s.encaminhamentos || s.pendencias));
          const expanded = open === h.id;
          return (
            <div key={h.id} className="overflow-hidden rounded-lg bg-gray-50 text-xs">
              <button
                onClick={() => setOpen(expanded ? null : h.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-100"
              >
                {h.protocol && (
                  <span className="inline-flex items-center gap-0.5 font-mono text-ink-soft"><Hash size={9} />{h.protocol}</span>
                )}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${h.status === "closed" ? "bg-gray-100 text-ink-soft" : "bg-green-100 text-green-700"}`}>
                  {h.status === "closed" ? "Encerrado" : "Aberto"}
                </span>
                {s?.pendencias?.trim() && (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Pendência</span>
                )}
                <span className="ml-auto text-ink-soft">{fmtDate(h.opened_at)}</span>
                <ChevronDown size={13} className={`shrink-0 text-ink-soft transition ${expanded ? "rotate-180" : ""}`} />
              </button>
              {expanded && (
                <div className="space-y-2 border-t border-border/60 px-3 py-2">
                  {s?.motivo && <Field label="Motivo" value={s.motivo} />}
                  {s?.solucao && <Field label="Solução" value={s.solucao} />}
                  {s?.encaminhamentos && <Field label="Encaminhamentos" value={s.encaminhamentos} />}
                  {s?.pendencias && <Field label="Pendências" value={s.pendencias} amber />}
                  {!hasSummary && <p className="text-ink-soft">Sem registro de encerramento.</p>}
                  <Link href={`/atendimento?c=${h.id}`} className="inline-flex items-center gap-1 pt-0.5 font-medium text-brand hover:underline">
                    <ExternalLink size={11} /> Ver conversa
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, value, amber }: { label: string; value: string; amber?: boolean }) {
  return (
    <div>
      <p className={`text-[10px] font-semibold uppercase ${amber ? "text-amber-700" : "text-ink-soft"}`}>{label}</p>
      <p className="whitespace-pre-wrap break-words text-ink">{value}</p>
    </div>
  );
}
