import { Scroll } from "@/components/scroll";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";

interface LogRow { id: string; action: string; entity: string | null; created_at: string; metadata: Record<string, unknown> }

async function getLogs(): Promise<LogRow[]> {
  if (PREVIEW_MODE)
    return [
      { id: "l1", action: "Atendimento encerrado", entity: "conversation", created_at: new Date().toISOString(), metadata: {} },
      { id: "l2", action: "Canal conectado", entity: "channel", created_at: new Date(Date.now() - 3600000).toISOString(), metadata: {} },
      { id: "l3", action: "Atendente criado", entity: "profile", created_at: new Date(Date.now() - 7200000).toISOString(), metadata: {} },
    ];
  const sb = await createClient();
  const { data } = await sb.from("audit_logs").select("id, action, entity, created_at, metadata").order("created_at", { ascending: false }).limit(200);
  return (data as LogRow[]) ?? [];
}

export default async function AuditoriaPage() {
  const logs = await getLogs();
  return (
    <Scroll>
      <PageHeader title="Auditoria" subtitle="Histórico de ações e atendimentos do sistema." />
      <div className="overflow-hidden rounded-card bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-ink-soft">
              <th className="px-4 py-3 font-medium">Ação</th>
              <th className="px-4 py-3 font-medium">Entidade</th>
              <th className="px-4 py-3 font-medium">Data</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan={3} className="px-4 py-10 text-center text-ink-soft">Nenhum registro de auditoria.</td></tr>}
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-3 font-medium text-ink">{l.action}</td>
                <td className="px-4 py-3 text-ink-soft">{l.entity ?? "—"}</td>
                <td className="px-4 py-3 text-ink-soft">{new Date(l.created_at).toLocaleString("pt-BR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Scroll>
  );
}
