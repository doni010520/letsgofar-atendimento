import { KanbanBoard } from "@/components/kanban-board";
import { getConversations, getConversationTagMap } from "@/lib/data/conversations";
import { getChannels } from "@/lib/data/channels";
import { getAgents, getDepartments, getTags, getQuickReplies } from "@/lib/data/management";
import { getApprovedTemplates } from "@/app/(app)/atendimento/actions";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";

export const revalidate = 0;

export default async function AtendimentoV2Page() {
  const [conversations, tagMap, channels, agents, departments, tags, quickReplies, templates] = await Promise.all([
    getConversations(),
    getConversationTagMap(),
    getChannels(),
    getAgents(),
    getDepartments(),
    getTags("conversation"),
    getQuickReplies(),
    getApprovedTemplates(),
  ]);

  // Dados do usuário para o modal de atendimento (chat).
  let userId: string | null = null;
  let hideAi = false;
  let isAdmin = false;
  let identifyAgentEnabled = false;
  if (!PREVIEW_MODE) {
    const session = await getSession();
    userId = session?.userId ?? null;
    identifyAgentEnabled = (session?.organization?.settings as Record<string, unknown> | undefined)?.identify_agent === true;
    if (userId) {
      const sb = await createClient();
      const { data: me } = await sb
        .from("profiles")
        .select("hide_ai, role, super_admin")
        .eq("id", userId)
        .maybeSingle();
      const p = me as { hide_ai?: boolean; role?: string; super_admin?: boolean } | null;
      hideAi = !!p?.hide_ai;
      isAdmin = p?.role === "admin" || !!p?.super_admin;
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-surface px-6 py-4">
        <h1 className="text-xl font-semibold text-ink">Dashboard de atendimento</h1>
        <p className="text-sm text-ink-soft">Visão em board dos seus atendimentos por etapa.</p>
      </div>
      <div className="min-h-0 flex-1">
        <KanbanBoard
          conversations={conversations}
          tagMap={tagMap}
          channels={channels}
          agents={agents}
          departments={departments}
          tags={tags}
          quickReplies={quickReplies.map((q) => ({ title: q.title, content: q.content, shortcut: q.shortcut }))}
          templates={templates}
          userId={userId}
          hideAi={hideAi}
          isAdmin={isAdmin}
          identifyAgentEnabled={identifyAgentEnabled}
        />
      </div>
    </div>
  );
}
