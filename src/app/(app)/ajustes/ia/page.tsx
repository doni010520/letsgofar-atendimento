import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Scroll } from "@/components/scroll";
import { PageHeader, Card } from "@/components/ui";
import { AiAgentForm, type AiAgentRow } from "@/components/ai-agent-form";
import { getChannels } from "@/lib/data/channels";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";

export default async function AiAgentPage() {
  const channels = await getChannels();
  let agent: AiAgentRow | null = null;
  if (!PREVIEW_MODE) {
    const session = await getSession();
    if (session?.organization) {
      const sb = await createClient();
      const { data } = await sb
        .from("ai_agents")
        .select("id, name, prompt, model, channel_id, active, config")
        .eq("organization_id", session.organization.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      agent = (data as AiAgentRow) ?? null;
    }
  }

  return (
    <Scroll>
      <Link href="/ajustes" className="mt-4 inline-flex items-center gap-1 text-sm text-brand hover:underline">
        <ArrowLeft size={15} /> Ajustes
      </Link>
      <PageHeader
        title="Agente de IA"
        subtitle="Configure o atendente virtual que resolve atendimentos usando o SGP e transfere para humanos quando necessário."
      />

      <Card className="mb-4 flex items-start gap-3 border border-brand/20 bg-brand-light/30">
        <Sparkles size={18} className="mt-0.5 shrink-0 text-brand" />
        <div className="text-xs text-ink-soft">
          O agente é acionado pelos nós <strong>IA</strong> dos seus fluxos de automação. Ele usa as ferramentas do
          SGP (consultar cliente, faturas, 2ª via/PIX, liberação por confiança, status de conexão, abrir chamado) e
          pode transferir para um atendente. Requer a variável de ambiente <code className="font-mono">OPENAI_API_KEY</code>.
        </div>
      </Card>

      <Card className="max-w-2xl">
        <AiAgentForm agent={agent} channels={channels} />
      </Card>
    </Scroll>
  );
}
