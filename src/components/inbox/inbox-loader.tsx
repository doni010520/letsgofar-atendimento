"use client";

import dynamic from "next/dynamic";
import type { ConversationOverview, Message, Tag, Profile, Department } from "@/lib/types";

const Inbox = dynamic(
  () => import("./inbox").then((m) => ({ default: m.Inbox })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-ink-soft">
        Carregando atendimento…
      </div>
    ),
  },
);

export function InboxLoader(props: {
  initialConversations: ConversationOverview[];
  initialSelectedId: string | null;
  initialMessages: Message[];
  userId: string | null;
  tags: Tag[];
  agents: Profile[];
  departments: Department[];
  live: boolean;
}) {
  return <Inbox {...props} />;
}
