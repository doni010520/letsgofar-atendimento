"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConversationList } from "./conversation-list";
import { ChatThread } from "./chat-thread";
import { createClient } from "@/lib/supabase/client";
import {
  sendMessage,
  sendMediaMessage,
  assignToMe,
  closeConversation,
  toggleMute,
  fetchMessages,
} from "@/app/(app)/atendimento/actions";
import type { ConversationOverview, Message } from "@/lib/types";

export function Inbox({
  initialConversations,
  initialSelectedId,
  initialMessages,
  userId,
  live,
}: {
  initialConversations: ConversationOverview[];
  initialSelectedId: string | null;
  initialMessages: Message[];
  userId: string | null;
  live: boolean;
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, Message[]>>(
    initialSelectedId ? { [initialSelectedId]: initialMessages } : {},
  );
  const [isPending, startTransition] = useTransition();

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const messages = selectedId ? messagesByConv[selectedId] ?? [] : [];

  // Carrega mensagens ao selecionar (se ainda não estiverem em cache).
  async function selectConversation(id: string) {
    setSelectedId(id);
    if (!messagesByConv[id]) {
      const msgs = await fetchMessages(id);
      setMessagesByConv((prev) => ({ ...prev, [id]: msgs }));
    }
  }

  // Realtime: mensagens recebidas (apenas direção "in"; as enviadas são otimistas).
  useEffect(() => {
    if (!live) return;
    const supabase = createClient();
    const channel = supabase
      .channel("inbox-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.new as Message;
          if (m.direction !== "in") return;

          setMessagesByConv((prev) =>
            prev[m.conversation_id]
              ? { ...prev, [m.conversation_id]: [...prev[m.conversation_id], m] }
              : prev,
          );

          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === m.conversation_id);
            if (idx < 0) {
              router.refresh();
              return prev;
            }
            const updated: ConversationOverview = {
              ...prev[idx],
              last_message_body: m.body,
              last_message_at: m.created_at,
              last_message_direction: "in",
              last_message_author: m.author_name ?? null,
            };
            return [updated, ...prev.filter((_, i) => i !== idx)];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [live, router]);

  function handleSend(text: string) {
    if (!selectedId) return;
    const optimistic: Message = {
      id: `tmp-${Date.now()}`,
      organization_id: "",
      conversation_id: selectedId,
      direction: "out",
      sender_type: "agent",
      sender_id: userId,
      content_type: "text",
      body: text,
      media_url: null,
      status: "pending",
      external_id: null,
      created_at: new Date().toISOString(),
    };
    setMessagesByConv((prev) => ({
      ...prev,
      [selectedId]: [...(prev[selectedId] ?? []), optimistic],
    }));
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === selectedId);
      if (idx < 0) return prev;
      const updated = { ...prev[idx], last_message_body: text, last_message_at: optimistic.created_at, last_message_direction: "out" as const };
      return [updated, ...prev.filter((_, i) => i !== idx)];
    });

    startTransition(async () => {
      await sendMessage(selectedId, text);
      if (live) {
        const msgs = await fetchMessages(selectedId);
        setMessagesByConv((prev) => ({ ...prev, [selectedId]: msgs }));
      }
    });
  }

  function handleSendFile(file: File) {
    if (!selectedId) return;
    const convId = selectedId;
    const fd = new FormData();
    fd.set("conversationId", convId);
    fd.set("file", file);
    startTransition(async () => {
      await sendMediaMessage(fd);
      const msgs = await fetchMessages(convId);
      setMessagesByConv((prev) => ({ ...prev, [convId]: msgs }));
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === convId);
        if (idx < 0) return prev;
        const updated = { ...prev[idx], last_message_at: new Date().toISOString(), last_message_direction: "out" as const };
        return [updated, ...prev.filter((_, i) => i !== idx)];
      });
    });
  }

  function handleAssign() {
    if (!selectedId) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, status: "open", assigned_user_id: userId } : c)),
    );
    startTransition(() => assignToMe(selectedId));
  }

  function handleClose() {
    if (!selectedId) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, status: "closed" } : c)),
    );
    startTransition(() => closeConversation(selectedId));
  }

  function handleToggleMute() {
    if (!selectedId) return;
    const next = !selected?.is_muted;
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, is_muted: next } : c)),
    );
    startTransition(() => toggleMute(selectedId, next).then(() => undefined));
  }

  return (
    <div className="flex h-full">
      <ConversationList
        conversations={conversations}
        selectedId={selectedId}
        onSelect={selectConversation}
      />
      {selected ? (
        <ChatThread
          conversation={selected}
          messages={messages}
          onSend={handleSend}
          onSendFile={handleSendFile}
          onAssign={handleAssign}
          onClose={handleClose}
          onToggleMute={handleToggleMute}
          pending={isPending}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-soft">
          Selecione uma conversa para começar.
        </div>
      )}
    </div>
  );
}
