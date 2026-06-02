import Link from "next/link";
import { ArrowLeft, Workflow } from "lucide-react";
import { Scroll } from "@/components/scroll";
import { PageHeader, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";

export default async function AutomationEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let name = "Automação";
  if (!PREVIEW_MODE) {
    const sb = await createClient();
    const { data } = await sb.from("automations").select("name").eq("id", id).maybeSingle();
    name = data?.name ?? name;
  }

  return (
    <Scroll>
      <Link href="/automacoes" className="mt-4 inline-flex items-center gap-1 text-sm text-brand hover:underline">
        <ArrowLeft size={15} /> Automações
      </Link>
      <PageHeader title={name} subtitle="Construtor de fluxo do chatbot." />
      <Card className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <Workflow size={48} className="text-gray-300" />
        <p className="font-medium text-ink">Construtor visual de fluxos</p>
        <p className="max-w-md text-xs text-ink-soft">
          O editor drag-and-drop (mensagens, menus, condições, transferência para humano, nó de IA)
          será implementado nesta tela. A estrutura do fluxo já está pronta no banco (campo <code>flow</code> JSON).
        </p>
      </Card>
    </Scroll>
  );
}
