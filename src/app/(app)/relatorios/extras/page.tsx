import { Scroll } from "@/components/scroll";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import {
  firstResponseDistribution,
  channelTagMatrix,
  outgoingMessagesCount,
} from "@/lib/reports-extra";
import { PREVIEW_MODE } from "@/lib/mock";

export const dynamic = "force-dynamic";

/** Relatórios migrados do fork do Chatwoot (B10). */
export default async function RelatoriosExtrasPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const { dias } = await searchParams;
  const janela = Number(dias ?? 30) || 30;

  const to = new Date().toISOString();
  const from = new Date(Date.now() - janela * 86_400_000).toISOString();

  const [distribuicao, matriz, enviadas] = PREVIEW_MODE
    ? [[], [], []]
    : await Promise.all([
        firstResponseDistribution(from, to),
        channelTagMatrix(from, to),
        outgoingMessagesCount(from, to),
      ]);

  const totalDist = distribuicao.reduce((s, b) => s + b.count, 0);
  const totalEnviadas = enviadas.reduce((s, p) => s + p.count, 0);
  const maiorDia = Math.max(1, ...enviadas.map((p) => p.count));

  return (
    <Scroll>
      <PageHeader
        title="Relatórios detalhados"
        subtitle={`Tempo de primeira resposta, canais × etiquetas e volume enviado — últimos ${janela} dias.`}
      />

      <div className="mt-4 flex gap-2">
        {[7, 30, 90].map((d) => (
          <a
            key={d}
            href={`/relatorios/extras?dias=${d}`}
            className={`rounded-lg border px-3 py-1.5 text-xs ${
              janela === d ? "border-transparent bg-brand text-white" : "border-border text-ink-soft"
            }`}
          >
            {d} dias
          </a>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* 1. Distribuição do tempo de primeira resposta */}
        <Card>
          <h3 className="text-sm font-semibold text-ink">Tempo até a primeira resposta</h3>
          <p className="mt-0.5 text-xs text-ink-soft">
            Quanto tempo o cliente espera até alguém responder.
          </p>
          {totalDist === 0 ? (
            <div className="mt-3"><EmptyState title="Sem dados no período" /></div>
          ) : (
            <ul className="mt-3 space-y-2">
              {distribuicao.map((b) => {
                const pct = Math.round((b.count / totalDist) * 100);
                return (
                  <li key={b.label}>
                    <div className="flex justify-between text-xs text-ink-soft">
                      <span>{b.label}</span>
                      <span>{b.count} ({pct}%)</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-200">
                      <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* 3. Mensagens enviadas por dia */}
        <Card>
          <h3 className="text-sm font-semibold text-ink">Mensagens enviadas</h3>
          <p className="mt-0.5 text-xs text-ink-soft">
            Total de {totalEnviadas} no período. Não conta o que falhou na entrega.
          </p>
          {!enviadas.length ? (
            <div className="mt-3"><EmptyState title="Sem envios no período" /></div>
          ) : (
            <div className="mt-4 flex h-40 items-end gap-1">
              {enviadas.map((p) => (
                <div key={p.day} className="flex-1" title={`${p.day}: ${p.count}`}>
                  <div
                    className="w-full rounded-t bg-brand"
                    style={{ height: `${Math.max(4, (p.count / maiorDia) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 2. Matriz canal × etiqueta */}
        <Card className="lg:col-span-2">
          <h3 className="text-sm font-semibold text-ink">Canais × etiquetas</h3>
          <p className="mt-0.5 text-xs text-ink-soft">Assuntos mais frequentes por canal.</p>
          {!matriz.length ? (
            <div className="mt-3"><EmptyState title="Sem conversas etiquetadas no período" /></div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-ink-soft">
                    <th className="py-2">Canal</th>
                    <th className="py-2">Etiqueta</th>
                    <th className="py-2 text-right">Conversas</th>
                  </tr>
                </thead>
                <tbody>
                  {matriz.slice(0, 30).map((c) => (
                    <tr key={`${c.channel}-${c.tag}`} className="border-b border-border last:border-0">
                      <td className="py-2 text-ink">{c.channel}</td>
                      <td className="py-2 text-ink-soft">{c.tag}</td>
                      <td className="py-2 text-right font-medium text-ink">{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </Scroll>
  );
}
