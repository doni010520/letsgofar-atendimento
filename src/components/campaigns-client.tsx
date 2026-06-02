"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { createCampaign, deleteCampaign } from "@/app/(app)/campanhas/actions";
import type { Campaign } from "@/lib/types";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Rascunho", cls: "bg-gray-100 text-gray-600" },
  scheduled: { label: "Agendada", cls: "bg-blue-100 text-blue-700" },
  running: { label: "Em execução", cls: "bg-green-100 text-green-700" },
  paused: { label: "Pausada", cls: "bg-amber-100 text-amber-700" },
  done: { label: "Concluída", cls: "bg-violet-100 text-violet-700" },
  failed: { label: "Falhou", cls: "bg-red-100 text-red-700" },
};

export function CampaignsClient({ campaigns }: { campaigns: Campaign[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(fd: FormData) {
    setPending(true);
    try {
      await createCampaign(fd);
      setOpen(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }
  async function remove(id: string) {
    if (!confirm("Excluir campanha?")) return;
    await deleteCampaign(id);
    router.refresh();
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus size={16} /> Criar Nova Campanha</Button>
      </div>

      <div className="mt-4 overflow-hidden rounded-card bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-ink-soft">
              <th className="px-4 py-3 font-medium">Nome da Campanha</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Progresso</th>
              <th className="px-4 py-3 font-medium">Criada em</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-ink-soft">Nenhuma campanha encontrada.</td></tr>
            )}
            {campaigns.map((c) => {
              const s = STATUS[c.status] ?? STATUS.draft;
              return (
                <tr key={c.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{c.name}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}`}>{s.label}</span></td>
                  <td className="px-4 py-3">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full bg-brand" style={{ width: `${c.progress}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{c.created_at ? new Date(c.created_at).toLocaleDateString("pt-BR") : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remove(c.id)} className="rounded p-1.5 text-ink-soft hover:bg-red-50 hover:text-danger"><Trash2 size={15} /></button>
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
              <h2 className="text-lg font-semibold text-ink">Nova campanha</h2>
              <button onClick={() => setOpen(false)} className="text-ink-soft hover:text-ink"><X size={18} /></button>
            </div>
            <form action={submit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">Nome da campanha</label>
                <input name="name" required className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">Status</label>
                <select name="status" defaultValue="draft" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand">
                  <option value="draft">Rascunho</option>
                  <option value="scheduled">Agendada</option>
                </select>
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
