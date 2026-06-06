"use client";

import { useEffect, useState } from "react";
import type { ConversationOverview, Message, Tag, Profile, Department } from "@/lib/types";

// Lazy import evita SSR do Inbox (que usa toLocaleTimeString etc.)
// mas sem next/dynamic que pode ter problemas de serialização de props.
let InboxComponent: typeof import("./inbox").Inbox | null = null;

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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (InboxComponent) {
      setReady(true);
      return;
    }
    import("./inbox").then((m) => {
      InboxComponent = m.Inbox;
      setReady(true);
    });
  }, []);

  if (!ready || !InboxComponent) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-soft">
        Carregando atendimento…
      </div>
    );
  }

  return <InboxComponent {...props} />;
}
