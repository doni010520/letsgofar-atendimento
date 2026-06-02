import { Inbox } from "@/components/inbox/inbox";
import { getConversations, getMessages } from "@/lib/data/conversations";
import { getSession } from "@/lib/auth";
import { PREVIEW_MODE } from "@/lib/mock";

export default async function AtendimentoPage() {
  const conversations = await getConversations();
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
      live={!PREVIEW_MODE}
    />
  );
}
