import { KanbanBoard } from "@/components/kanban-board";
import { getConversations } from "@/lib/data/conversations";

export default async function AtendimentoV2Page() {
  const conversations = await getConversations();
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-100 bg-surface px-6 py-4">
        <h1 className="text-xl font-semibold text-ink">Dashboard de atendimento</h1>
        <p className="text-sm text-ink-soft">Visão em board dos seus atendimentos por etapa.</p>
      </div>
      <div className="min-h-0 flex-1">
        <KanbanBoard conversations={conversations} />
      </div>
    </div>
  );
}
