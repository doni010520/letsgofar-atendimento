import { Inbox } from "@/components/inbox/inbox";
import { getConversations, getMessages } from "@/lib/data/conversations";
import { getTags, getAgents, getDepartments } from "@/lib/data/management";
import { getSession } from "@/lib/auth";
import { PREVIEW_MODE } from "@/lib/mock";

export default async function AtendimentoPage() {
  const [conversations, tags, agents, departments] = await Promise.all([
    getConversations(),
    getTags("conversation"),
    getAgents(),
    getDepartments(),
  ]);
  const first = conversations[0]?.id ?? null;
  const initialMessages = first ? await getMessages(first) : [];

  let userId: string | null = null;
  if (!PREVIEW_MODE) {
    const session = await getSession();
    userId = session?.userId ?? null;
  }

  return (
    <Inbox
      initialConversations={conversations}
      initialSelectedId={first}
      initialMessages={initialMessages}
      userId={userId}
      tags={tags}
      agents={agents}
      departments={departments}
      live={!PREVIEW_MODE}
    />
  );
}
