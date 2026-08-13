import { InboxLoader } from "@/components/inbox/inbox-loader";
import { getConversations, getMessages } from "@/lib/data/conversations";
import { getTags, getAgents, getDepartments, getQuickReplies } from "@/lib/data/management";
import { getChannels } from "@/lib/data/channels";
import { getApprovedTemplates } from "@/app/(app)/atendimento/actions";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";

export const revalidate = 0;

export default async function AtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const [conversations, tags, agents, departments, quickReplies, channels, templates] = await Promise.all([
    getConversations(),
    getTags("conversation"),
    getAgents(),
    getDepartments(),
    getQuickReplies(),
    getChannels(),
    getApprovedTemplates(),
  ]);
  // Deep-link ?c=<convId> (ex.: clique numa menção do sino) abre essa conversa.
  const requested = (await searchParams)?.c;
  const first =
    (requested && conversations.some((c) => c.id === requested) ? requested : conversations[0]?.id) ?? null;
  const initialMessages = first ? await getMessages(first) : [];

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
      // Só admin vê o conteúdo de mensagens apagadas (visão de auditoria).
      isAdmin = p?.role === "admin" || !!p?.super_admin;
    }
  }

  return (
    <InboxLoader
      initialConversations={conversations}
      initialSelectedId={first}
      initialMessages={initialMessages}
      userId={userId}
      hideAi={hideAi}
      isAdmin={isAdmin}
      identifyAgentEnabled={identifyAgentEnabled}
      tags={tags}
      agents={agents}
      departments={departments}
      channels={channels}
      quickReplies={quickReplies.map((q) => ({ title: q.title, content: q.content, shortcut: q.shortcut }))}
      templates={templates}
      live={!PREVIEW_MODE}
    />
  );
}
