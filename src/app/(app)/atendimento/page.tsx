import { InboxLoader } from "@/components/inbox/inbox-loader";
import { getConversations, getMessages } from "@/lib/data/conversations";
import { getTags, getAgents, getDepartments, getQuickReplies } from "@/lib/data/management";
import { getChannels } from "@/lib/data/channels";
import { getApprovedTemplates } from "@/app/(app)/atendimento/actions";
import { getSession } from "@/lib/auth";
import { PREVIEW_MODE } from "@/lib/mock";

export const revalidate = 0;

export default async function AtendimentoPage() {
  const [conversations, tags, agents, departments, quickReplies, channels, templates] = await Promise.all([
    getConversations(),
    getTags("conversation"),
    getAgents(),
    getDepartments(),
    getQuickReplies(),
    getChannels(),
    getApprovedTemplates(),
  ]);
  const first = conversations[0]?.id ?? null;
  const initialMessages = first ? await getMessages(first) : [];

  let userId: string | null = null;
  if (!PREVIEW_MODE) {
    const session = await getSession();
    userId = session?.userId ?? null;
  }

  return (
    <InboxLoader
      initialConversations={conversations}
      initialSelectedId={first}
      initialMessages={initialMessages}
      userId={userId}
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
