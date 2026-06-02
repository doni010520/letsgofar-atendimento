import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FlowEditor } from "@/components/flow-editor";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";

export default async function AutomationEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let name = "Automação";
  let flow = { nodes: [], edges: [] };
  if (!PREVIEW_MODE) {
    const sb = await createClient();
    const { data } = await sb.from("automations").select("name, flow").eq("id", id).maybeSingle();
    if (data) {
      name = data.name ?? name;
      flow = (data.flow as typeof flow) ?? flow;
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-gray-100 bg-surface px-6 py-3">
        <Link href="/automacoes" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
          <ArrowLeft size={15} /> Automações
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-sm font-semibold text-ink">{name}</h1>
      </div>
      <div className="min-h-0 flex-1">
        <FlowEditor automationId={id} initialFlow={flow} />
      </div>
    </div>
  );
}
