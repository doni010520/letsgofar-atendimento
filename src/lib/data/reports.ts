import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";

export interface ReportData {
  totals: { all: number; open: number; queued: number; bot: number; closed: number };
  byDay: { date: string; total: number }[];
  byStatus: { name: string; value: number }[];
  byChannel: { name: string; value: number }[];
  byDepartment: { name: string; value: number }[];
}

const STATUS_LABEL: Record<string, string> = {
  open: "Em andamento", queued: "Em espera", bot: "Na automação", closed: "Encerrados",
};

function mockReport(): ReportData {
  const byDay = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400000);
    return { date: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`, total: 20 + Math.round(40 * Math.abs(Math.sin(i))) };
  });
  return {
    totals: { all: 1698, open: 13, queued: 14, bot: 6, closed: 1665 },
    byDay,
    byStatus: [
      { name: "Encerrados", value: 1665 }, { name: "Em espera", value: 14 },
      { name: "Em andamento", value: 13 }, { name: "Na automação", value: 6 },
    ],
    byChannel: [
      { name: "CENTRAL MVFNET", value: 520 }, { name: "IBICUI - API Oficial", value: 410 },
      { name: "MVF NET CANAA 1730", value: 360 }, { name: "IGUAI - API Oficial", value: 280 }, { name: "Outros", value: 128 },
    ],
    byDepartment: [
      { name: "Suporte Técnico", value: 980 }, { name: "Financeiro", value: 430 }, { name: "Comercial", value: 288 },
    ],
  };
}

export async function getReportData(): Promise<ReportData> {
  if (PREVIEW_MODE) return mockReport();
  const sb = await createClient();

  const [{ data: convs }, { data: channels }, { data: depts }] = await Promise.all([
    sb.from("conversations").select("status, channel_id, department_id, created_at").limit(2000),
    sb.from("channels").select("id, name"),
    sb.from("departments").select("id, name"),
  ]);

  const rows = convs ?? [];
  const chName = new Map((channels ?? []).map((c) => [c.id, c.name]));
  const deptName = new Map((depts ?? []).map((d) => [d.id, d.name]));

  const totals = { all: rows.length, open: 0, queued: 0, bot: 0, closed: 0 };
  const byStatusMap: Record<string, number> = {};
  const byChannelMap: Record<string, number> = {};
  const byDeptMap: Record<string, number> = {};
  const byDayMap: Record<string, number> = {};

  // últimos 14 dias
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    days.push(key);
    byDayMap[key] = 0;
  }

  for (const r of rows) {
    if (r.status in totals) (totals as Record<string, number>)[r.status]++;
    byStatusMap[STATUS_LABEL[r.status] ?? r.status] = (byStatusMap[STATUS_LABEL[r.status] ?? r.status] ?? 0) + 1;
    const cn = chName.get(r.channel_id) ?? "Sem canal";
    byChannelMap[cn] = (byChannelMap[cn] ?? 0) + 1;
    if (r.department_id) {
      const dn = deptName.get(r.department_id) ?? "Outro";
      byDeptMap[dn] = (byDeptMap[dn] ?? 0) + 1;
    }
    if (r.created_at) {
      const d = new Date(r.created_at);
      const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (key in byDayMap) byDayMap[key]++;
    }
  }

  const topN = (m: Record<string, number>, n = 6) =>
    Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, n);

  return {
    totals,
    byDay: days.map((date) => ({ date, total: byDayMap[date] })),
    byStatus: topN(byStatusMap),
    byChannel: topN(byChannelMap),
    byDepartment: topN(byDeptMap),
  };
}
