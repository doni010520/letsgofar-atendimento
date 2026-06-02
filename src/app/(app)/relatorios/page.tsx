import { Scroll } from "@/components/scroll";
import { PageHeader } from "@/components/ui";
import { ReportsCharts } from "@/components/reports-charts";
import { getReportData } from "@/lib/data/reports";

export default async function RelatoriosPage() {
  const data = await getReportData();
  return (
    <Scroll>
      <PageHeader title="Relatórios" subtitle="Acompanhe os indicadores de atendimento da sua empresa." />
      <ReportsCharts data={data} />
    </Scroll>
  );
}
