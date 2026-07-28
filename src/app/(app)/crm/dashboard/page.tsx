import { Scroll } from "@/components/scroll";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";

export const dynamic = "force-dynamic";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Card = {
  id: string;
  stage_id: string | null;
  deal_value: number | null;
  closed_won: boolean | null;
  closed_at: string | null;
  assigned_user_id: string | null;
  last_message_at: string | null;
};

/** Dashboard do funil + controle de leads (A1). */
export default async function CrmDashboardPage() {
  if (PREVIEW_MODE) {
    return (
      <Scroll>
        <PageHeader title="Painel do CRM" subtitle="Visão geral do funil." />
        <EmptyState title="Configure o Supabase para ver os números" />
      </Scroll>
    );
  }

  const sb = await createClient();
  const [{ data: stages }, { data: cards }, { data: agents }] = await Promise.all([
    sb.from("pipeline_stages").select("id, name, color, position, outcome").order("position"),
    sb
      .from("conversations")
      .select("id, stage_id, deal_value, closed_won, closed_at, assigned_user_id, last_message_at")
      .not("stage_id", "is", null)
      .limit(2000),
    sb.from("profiles").select("id, name"),
  ]);

  const lista = (cards as Card[]) ?? [];
  const etapas = (stages as { id: string; name: string; color: string; outcome: string | null }[]) ?? [];
  const nomes = Object.fromEntries(
    ((agents as { id: string; name: string | null }[]) ?? []).map((a) => [a.id, a.name ?? "Sem nome"]),
  );

  const abertos = lista.filter((c) => c.closed_won == null);
  const ganhos = lista.filter((c) => c.closed_won === true);
  const perdidos = lista.filter((c) => c.closed_won === false);
  const valorAberto = abertos.reduce((s, c) => s + Number(c.deal_value ?? 0), 0);
  const valorGanho = ganhos.reduce((s, c) => s + Number(c.deal_value ?? 0), 0);
  const conversao = ganhos.length + perdidos.length
    ? Math.round((ganhos.length / (ganhos.length + perdidos.length)) * 100)
    : 0;

  // Lead parado: sem mensagem há mais de 7 dias e ainda em aberto.
  const limite = Date.now() - 7 * 86_400_000;
  const parados = abertos.filter(
    (c) => c.last_message_at && new Date(c.last_message_at).getTime() < limite,
  );

  // Distribuição por estágio e por responsável.
  const porEtapa = etapas.map((e) => {
    const doEstagio = lista.filter((c) => c.stage_id === e.id);
    return {
      ...e,
      count: doEstagio.length,
      value: doEstagio.reduce((s, c) => s + Number(c.deal_value ?? 0), 0),
    };
  });
  const maiorEtapa = Math.max(1, ...porEtapa.map((e) => e.count));

  const porResponsavel = Object.entries(
    abertos.reduce<Record<string, { count: number; value: number }>>((acc, c) => {
      const k = c.assigned_user_id ?? "—";
      acc[k] ??= { count: 0, value: 0 };
      acc[k].count += 1;
      acc[k].value += Number(c.deal_value ?? 0);
      return acc;
    }, {}),
  ).sort((a, b) => b[1].value - a[1].value);

  return (
    <Scroll>
      <PageHeader
        title="Painel do CRM"
        subtitle="Negócios em aberto, conversão e leads que pararam de responder."
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs text-ink-soft">Em aberto</p>
          <p className="text-2xl font-semibold text-ink">{abertos.length}</p>
          <p className="text-xs text-ink-soft">{brl(valorAberto)}</p>
        </Card>
        <Card>
          <p className="text-xs text-ink-soft">Ganhos</p>
          <p className="text-2xl font-semibold text-green-700">{ganhos.length}</p>
          <p className="text-xs text-ink-soft">{brl(valorGanho)}</p>
        </Card>
        <Card>
          <p className="text-xs text-ink-soft">Conversão</p>
          <p className="text-2xl font-semibold text-ink">{conversao}%</p>
          <p className="text-xs text-ink-soft">{perdidos.length} perdidos</p>
        </Card>
        <Card>
          <p className="text-xs text-ink-soft">Leads parados</p>
          <p className="text-2xl font-semibold text-amber-600">{parados.length}</p>
          <p className="text-xs text-ink-soft">sem resposta há +7 dias</p>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="text-sm font-semibold text-ink">Por estágio</h3>
          {!porEtapa.length ? (
            <div className="mt-3"><EmptyState title="Nenhum funil configurado" /></div>
          ) : (
            <ul className="mt-3 space-y-2">
              {porEtapa.map((e) => (
                <li key={e.id}>
                  <div className="flex justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-ink">
                      <span className="h-2 w-2 rounded-full" style={{ background: e.color }} />
                      {e.name}
                    </span>
                    <span className="text-ink-soft">{e.count} · {brl(e.value)}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-full"
                      style={{ width: `${(e.count / maiorEtapa) * 100}%`, background: e.color }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-ink">Por responsável</h3>
          {!porResponsavel.length ? (
            <div className="mt-3"><EmptyState title="Nenhum negócio em aberto" /></div>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-soft">
                  <th className="py-2">Atendente</th>
                  <th className="py-2 text-right">Negócios</th>
                  <th className="py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {porResponsavel.map(([id, v]) => (
                  <tr key={id} className="border-b border-border last:border-0">
                    <td className="py-2 text-ink">{nomes[id] ?? "Sem responsável"}</td>
                    <td className="py-2 text-right text-ink-soft">{v.count}</td>
                    <td className="py-2 text-right font-medium text-ink">{brl(v.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </Scroll>
  );
}
