import { Scroll } from "@/components/scroll";
import { PageHeader, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";
import { getChannels } from "@/lib/data/channels";

async function checkSupabase(): Promise<boolean> {
  if (PREVIEW_MODE) return true;
  try {
    const sb = await createClient();
    const { error } = await sb.from("organizations").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

export default async function StatusPage() {
  const [sbOk, channels] = await Promise.all([checkSupabase(), getChannels()]);

  const services = [
    { name: "Aplicação (Next.js)", status: true, detail: "Online" },
    { name: "Banco de Dados (Supabase)", status: sbOk, detail: sbOk ? "Online" : "Indisponível" },
    ...channels.map((c) => ({
      name: `Canal: ${c.name}`,
      status: c.status === "connected",
      detail: c.status === "connected" ? "Conectado" : c.status,
    })),
  ];

  return (
    <Scroll>
      <PageHeader title="Status dos Servidores" subtitle="Verifique a saúde dos serviços e canais." />
      <div className="max-w-xl space-y-3">
        {services.map((s) => (
          <Card key={s.name} className="flex items-center gap-3 py-3">
            <span className={`h-3 w-3 rounded-full ${s.status ? "bg-green-500" : "bg-red-500"}`} />
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">{s.name}</p>
            </div>
            <span className={`text-xs font-medium ${s.status ? "text-green-600" : "text-red-600"}`}>
              {s.detail}
            </span>
          </Card>
        ))}
      </div>
    </Scroll>
  );
}
