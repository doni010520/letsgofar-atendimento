import dynamic from "next/dynamic";
import { getConversations, getMessages } from "@/lib/data/conversations";
import { getTags, getAgents, getDepartments } from "@/lib/data/management";
import { getSession } from "@/lib/auth";
import { PREVIEW_MODE } from "@/lib/mock";

export const revalidate = 0; // force-dynamic

// SSR desligado para o Inbox — é uma app de chat real-time; o servidor
// Docker está em UTC e o browser em UTC-3, gerando hydration mismatch
// (#418) em qualquer formatação de data/hora. Client-only resolve 100%.
const Inbox = dynamic(
  () => import("@/components/inbox/inbox").then((m) => ({ default: m.Inbox })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-ink-soft">
        Carregando atendimento…
      </div>
    ),
  },
);

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
