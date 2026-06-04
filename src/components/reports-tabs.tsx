"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReportsCharts } from "./reports-charts";
import type { ReportData, AgentReport, ClientReport, CsatReport } from "@/lib/data/reports";

const TABS = [
  "Dashboard",
  "Atendimentos",
  "Atendentes",
  "Clientes",
  "Pesquisa de Satisfação",
] as const;

type Tab = (typeof TABS)[number];

export function ReportsTabs({
  data,
  agents,
  clients,
  csat,
}: {
  data: ReportData;
  agents: AgentReport[];
  clients: ClientReport[];
  csat: CsatReport[];
}) {
  const [tab, setTab] = useState<Tab>("Dashboard");

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-1 rounded-lg bg-gray-100 p-0.5 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium transition",
              tab === t ? "bg-surface text-ink shadow-sm" : "text-ink-soft",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Dashboard" && <ReportsCharts data={data} />}

      {tab === "Atendimentos" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Total", value: data.totals.all },
              { label: "Em andamento", value: data.totals.open },
              { label: "Em espera", value: data.totals.queued },
              { label: "Encerrados", value: data.totals.closed },
            ].map((c) => (
              <div key={c.label} className="rounded-card bg-surface p-4 shadow-sm">
                <p className="text-xs text-ink-soft">{c.label}</p>
                <p className="mt-1 text-2xl font-semibold text-ink">{c.value}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-card border border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium text-ink-soft">
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Quantidade</th>
                  <th className="px-4 py-3 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {data.byStatus.map((r) => (
                  <tr key={r.name} className="border-b border-gray-50">
                    <td className="px-4 py-3 text-ink">{r.name}</td>
                    <td className="px-4 py-3 text-right font-medium">{r.value}</td>
                    <td className="px-4 py-3 text-right text-ink-soft">
                      {data.totals.all ? ((r.value / data.totals.all) * 100).toFixed(1) + "%" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "Atendentes" && (
        <div className="overflow-x-auto rounded-card border border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium text-ink-soft">
                <th className="px-4 py-3">Atendente</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Em andamento</th>
                <th className="px-4 py-3 text-right">Encerrados</th>
                <th className="px-4 py-3 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-soft">Nenhum dado.</td></tr>
              )}
              {agents.map((a) => {
                const totalAll = agents.reduce((s, x) => s + x.total, 0);
                return (
                  <tr key={a.name} className="border-b border-gray-50">
                    <td className="px-4 py-3 font-medium text-ink">{a.name}</td>
                    <td className="px-4 py-3 text-right">{a.total}</td>
                    <td className="px-4 py-3 text-right text-green-600">{a.open}</td>
                    <td className="px-4 py-3 text-right">{a.closed}</td>
                    <td className="px-4 py-3 text-right text-ink-soft">
                      {totalAll ? ((a.total / totalAll) * 100).toFixed(1) + "%" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === "Clientes" && (
        <div className="overflow-x-auto rounded-card border border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium text-ink-soft">
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3 text-right">Atendimentos</th>
                <th className="px-4 py-3 text-right">Último</th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-soft">Nenhum dado.</td></tr>
              )}
              {clients.map((c, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="px-4 py-3 font-medium text-ink">{c.name}</td>
                  <td className="px-4 py-3 text-ink-soft">{c.phone}</td>
                  <td className="px-4 py-3 text-right">{c.total}</td>
                  <td className="px-4 py-3 text-right text-ink-soft">
                    {c.last ? new Date(c.last).toLocaleDateString("pt-BR") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "Pesquisa de Satisfação" && (
        <div className="space-y-4">
          {csat.length === 0 && (
            <p className="py-10 text-center text-sm text-ink-soft">Nenhuma avaliação registrada.</p>
          )}
          {csat.map((s) => (
            <div key={s.survey} className="rounded-card bg-surface p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-ink">{s.survey}</h3>
                <div className="flex items-center gap-1 text-yellow-500">
                  <Star size={18} className="fill-yellow-400" />
                  <span className="text-lg font-bold">{s.avg}</span>
                  <span className="text-xs text-ink-soft">({s.count} avaliações)</span>
                </div>
              </div>
              <div className="flex gap-3">
                {s.distribution.map((d) => (
                  <div key={d.note} className="flex-1 text-center">
                    <div className="mx-auto mb-1 h-20 w-full max-w-[40px] rounded-t bg-gray-100 relative overflow-hidden">
                      <div
                        className="absolute bottom-0 w-full bg-brand transition-all"
                        style={{ height: s.count ? `${(d.count / s.count) * 100}%` : "0%" }}
                      />
                    </div>
                    <p className="text-xs font-medium text-ink">{d.note}★</p>
                    <p className="text-[10px] text-ink-soft">{d.count}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
