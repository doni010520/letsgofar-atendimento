"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Trash2, Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui";
import { createInvoice, setInvoiceStatus, deleteInvoice } from "@/app/(app)/financeiro/actions";
import type { Invoice } from "@/lib/types";

const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "Em aberto", cls: "bg-amber-100 text-amber-700" },
  paid: { label: "Paga", cls: "bg-green-100 text-green-700" },
  overdue: { label: "Vencida", cls: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelada", cls: "bg-gray-100 text-gray-600" },
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function FinanceClient({ invoices }: { invoices: Invoice[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  // Marca vencidas (em aberto + due_date no passado) só para exibição.
  const today = new Date().toISOString().slice(0, 10);
  const rows = invoices.map((i) =>
    i.status === "open" && i.due_date && i.due_date < today ? { ...i, status: "overdue" as const } : i,
  );

  const openTotal = rows.filter((i) => i.status === "open" || i.status === "overdue").reduce((s, i) => s + Number(i.amount), 0);
  const paidTotal = rows.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.amount), 0);
  const openCount = rows.filter((i) => i.status === "open" || i.status === "overdue").length;
  const paidCount = rows.filter((i) => i.status === "paid").length;

  async function submit(fd: FormData) {
    setPending(true);
    try { await createInvoice(fd); setOpen(false); router.refresh(); }
    finally { setPending(false); }
  }
  async function mark(id: string, status: "paid" | "open" | "cancelled") {
    await setInvoiceStatus(id, status); router.refresh();
  }
  async function remove(id: string) {
    if (!confirm("Excluir fatura?")) return;
    await deleteInvoice(id); router.refresh();
  }

  const cardCls = "rounded-card bg-surface p-4 shadow-sm";

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={cardCls}>
          <p className="text-xs text-ink-soft">Faturas em aberto</p>
          <p className="mt-1 text-2xl font-semibold text-amber-600">{openCount}</p>
          <p className="text-xs text-ink-soft">{brl(openTotal)}</p>
        </div>
        <div className={cardCls}>
          <p className="text-xs text-ink-soft">Faturas pagas</p>
          <p className="mt-1 text-2xl font-semibold text-green-600">{paidCount}</p>
          <p className="text-xs text-ink-soft">{brl(paidTotal)}</p>
        </div>
        <div className={cardCls}>
          <p className="text-xs text-ink-soft">Total faturas</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{rows.length}</p>
        </div>
        <div className="flex items-center justify-end">
          <Button onClick={() => setOpen(true)}><Plus size={16} /> Nova fatura</Button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-card bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-ink-soft">
              <th className="px-4 py-3 font-medium">Descrição</th>
              <th className="px-4 py-3 font-medium text-right">Valor</th>
              <th className="px-4 py-3 font-medium">Vencimento</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-soft">Ainda não foram geradas faturas.</td></tr>
            )}
            {rows.map((i) => {
              const s = STATUS[i.status] ?? STATUS.open;
              return (
                <tr key={i.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{i.description}</td>
                  <td className="px-4 py-3 text-right">{brl(Number(i.amount))}</td>
                  <td className="px-4 py-3 text-ink-soft">{i.due_date ? new Date(i.due_date + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}`}>{s.label}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {i.status !== "paid" ? (
                        <button onClick={() => mark(i.id, "paid")} title="Marcar como paga" className="rounded p-1.5 text-ink-soft hover:bg-green-50 hover:text-green-600"><Check size={15} /></button>
                      ) : (
                        <button onClick={() => mark(i.id, "open")} title="Reabrir" className="rounded p-1.5 text-ink-soft hover:bg-amber-50 hover:text-amber-600"><Undo2 size={15} /></button>
                      )}
                      <button onClick={() => remove(i.id)} className="rounded p-1.5 text-ink-soft hover:bg-red-50 hover:text-danger"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Nova fatura</h2>
              <button onClick={() => setOpen(false)} className="text-ink-soft hover:text-ink"><X size={18} /></button>
            </div>
            <form action={submit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">Descrição</label>
                <input name="description" required placeholder="Ex.: Mensalidade do sistema" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-soft">Valor (R$)</label>
                  <input name="amount" required inputMode="decimal" placeholder="0,00" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-soft">Vencimento</label>
                  <input type="date" name="due_date" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button type="submit" disabled={pending}>{pending ? "Salvando..." : "Criar"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
