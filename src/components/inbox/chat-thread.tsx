"use client";

import { useEffect, useRef } from "react";
import { UserCheck, CheckCircle2 } from "lucide-react";
import { MessageBubble } from "./message-bubble";
import { Composer } from "./composer";
import type { ConversationOverview, Message } from "@/lib/types";

export function ChatThread({
  conversation,
  messages,
  onSend,
  onAssign,
  onClose,
  pending,
}: {
  conversation: ConversationOverview;
  messages: Message[];
  onSend: (text: string) => void;
  onAssign: () => void;
  onClose: () => void;
  pending?: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, conversation.id]);

  const isMeta = conversation.channel_type === "meta_cloud";

  return (
    <div className="flex h-full flex-1 flex-col bg-canvas">
      <header className="flex items-center justify-between border-b border-gray-100 bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          {conversation.contact_avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={conversation.contact_avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600">
              {(conversation.contact_name ?? conversation.contact_phone).slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-ink">
              {conversation.contact_name ?? conversation.contact_phone}
            </p>
            <p className="text-xs text-ink-soft">
              {conversation.contact_phone} ·{" "}
              <span className={isMeta ? "text-blue-600" : "text-gray-600"}>
                {conversation.channel_name}
              </span>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {conversation.status !== "closed" && (
            <>
              <button
                onClick={onAssign}
                className="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-200"
              >
                <UserCheck size={14} /> Assumir
              </button>
              <button
                onClick={onClose}
                className="flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-danger hover:bg-red-100"
              >
                <CheckCircle2 size={14} /> Encerrar
              </button>
            </>
          )}
          {conversation.status === "closed" && (
            <span className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-ink-soft">Encerrado</span>
          )}
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="mt-10 text-center text-xs text-ink-soft">Nenhuma mensagem ainda.</p>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={endRef} />
      </div>

      <Composer onSend={onSend} disabled={pending || conversation.status === "closed"} />
    </div>
  );
}
