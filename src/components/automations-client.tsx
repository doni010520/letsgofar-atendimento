"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, X, Trash2, Pencil } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { createAutomation, toggleAutomation, deleteAutomation } from "@/app/(app)/automacoes/actions";
import type { Automation, Channel } from "@/lib/types";

export function AutomationsClient({ automations, channels }: { automations: Automation[]; channels: Channel[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const chName = (id: string | null) => channels.find((c) => c.id === id)?.name ?? "Todos os canais";

  async function submit(fd: FormData) {
    setPending(true);
    try { await createAutomation(fd); setOpen(false); router.refresh(); }
    finally { setPending(false); }
  }
  async function toggle(a: Automation) { await toggleAutomation(a.id, !a.active); router.refresh(); }
  async function remove(id: string) { if (!confirm("Excluir automação?")) return; await deleteAutomation(id); router.refresh(); }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus size={16} /> Nova automação</Button>
      </div>

      <div className="mt-4 space-y-2">
        {automations.length === 0 && <p className="py-10 text-center text-sm text-ink-soft">Nenhuma automação ainda.</p>}
        {automations.map((a) => (
          <Card key={a.id} className="flex items-center gap-3 py-3">
            <button onClick={() => toggle(a)} title={a.active ? "Desativar" : "Ativar"}
              className={`relative h-5 w-9 shrink-0 rounded-full transition ${a.active ? "bg-green-500" : "bg-gray-300"}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${a.active ? "left-4" : "left-0.5"}`} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{a.name}</p>
              <p className="truncate text-xs text-ink-soft">{chName(a.channel_id)}{a.trigger ? ` · ${a.trigger}` : ""}</p>
            </div>
            <Link href={`/automacoes/${a.id}`} className="rounded p-1.5 text-ink-soft hover:bg-gray-100 hover:text-ink" title="Editar fluxo"><Pencil size={15} /></Link>
            <button onClick={() => remove(a.id)} className="rounded p-1.5 text-ink-soft hover:bg-red-50 hover:text-danger"><Trash2 size={15} /></button>
          </Card>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-card bg-surface p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Nova automação</h2>
              <button onClick={() => setOpen(false)} className="text-ink-soft hover:text-ink"><X size={18} /></button>
            </div>
            <form action={submit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">Nome</label>
                <input name="name" required placeholder="Ex.: Horário comercial" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">Canal</label>
                <select name="channel_id" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand">
                  <option value="">Todos os canais</option>
                  {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">Gatilho (palavra-chave)</label>
                <input name="trigger" placeholder="Ex.: menu, oi, suporte" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand" />
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
