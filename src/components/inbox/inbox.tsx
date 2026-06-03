"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConversationList } from "./conversation-list";
import { ChatThread } from "./chat-thread";
import { createClient } from "@/lib/supabase/client";
import {
  sendMessage,
  sendMediaMessage,
  sendLocationMessage,
  sendContactMessage,
  reactToMessage,
  editMessageAction,
  deleteMessageAction,
  markConversationRead,
  assignToMe,
  closeConversation,
  toggleMute,
  fetchMessages,
  fetchConversations,
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

  // Carrega mensagens ao selecionar (se ainda não estiverem em cache) e marca como lida.
  async function selectConversation(id: string) {
    setSelectedId(id);
    if (!messagesByConv[id]) {
      const msgs = await fetchMessages(id);
      setMessagesByConv((prev) => ({ ...prev, [id]: msgs }));
    }
    if (live) markConversationRead(id).catch(() => {});
  }

  // Polling de segurança: atualiza a inbox a cada 5s (independe do Realtime).
  useEffect(() => {
    if (!live) return;
    let cancel = false;
    const tick = async () => {
      try {
        const convs = await fetchConversations();
        if (!cancel && Array.isArray(convs)) setConversations(convs);
        if (!cancel && selectedId) {
          const msgs = await fetchMessages(selectedId);
          setMessagesByConv((prev) => {
            const cur = prev[selectedId] ?? [];
            const lastCur = cur[cur.length - 1];
            const lastNew = msgs[msgs.length - 1];
            if (cur.length === msgs.length && lastCur?.id === lastNew?.id && lastCur?.status === lastNew?.status) return prev;
            return { ...prev, [selectedId]: msgs };
          });
        }
      } catch {
        /* silencioso */
      }
    };
    const t = setInterval(tick, 5000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, [live, selectedId]);

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

          setMessagesByConv((prev) => {
            const list = prev[m.conversation_id];
            if (!list) return prev;
            // Evita duplicar mensagens já presentes (ex.: otimista app-enviada).
            if (list.some((x) => x.id === m.id || (m.external_id && x.external_id === m.external_id))) return prev;
            return { ...prev, [m.conversation_id]: [...list, m] };
          });

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
              last_message_direction: m.direction,
              last_message_author: m.author_name ?? null,
            };
            return [updated, ...prev.filter((_, i) => i !== idx)];
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.new as Message;
          setMessagesByConv((prev) =>
            prev[m.conversation_id]
              ? { ...prev, [m.conversation_id]: prev[m.conversation_id].map((x) => (x.id === m.id ? { ...x, ...m } : x)) }
              : prev,
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [live, router]);

  function refetch(convId: string) {
    return fetchMessages(convId).then((msgs) => setMessagesByConv((prev) => ({ ...prev, [convId]: msgs })));
  }

  function handleSendLocation() {
    if (!selectedId) return;
    const convId = selectedId;
    if (!navigator.geolocation) {
      alert("Geolocalização não disponível neste dispositivo.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        startTransition(async () => {
          await sendLocationMessage(convId, { latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          await refetch(convId);
        });
      },
      () => alert("Não foi possível obter a localização."),
    );
  }

  function handleSendContact() {
    if (!selectedId) return;
    const convId = selectedId;
    const name = window.prompt("Nome do contato:");
    if (!name) return;
    const phone = window.prompt("Telefone (com DDI+DDD, só números):");
    if (!phone) return;
    startTransition(async () => {
      await sendContactMessage(convId, name, phone);
      await refetch(convId);
    });
  }

  function handleReact(m: Message, emoji: string) {
    if (!selectedId) return;
    const convId = selectedId;
    startTransition(async () => {
      await reactToMessage(convId, m.id, emoji);
      const msgs = await fetchMessages(convId);
      setMessagesByConv((prev) => ({ ...prev, [convId]: msgs }));
    });
  }

  function handleEdit(m: Message) {
    if (!selectedId) return;
    const convId = selectedId;
    const next = window.prompt("Editar mensagem:", m.body ?? "");
    if (next == null || next.trim() === (m.body ?? "")) return;
    startTransition(async () => {
      await editMessageAction(convId, m.id, next);
      const msgs = await fetchMessages(convId);
      setMessagesByConv((prev) => ({ ...prev, [convId]: msgs }));
    });
  }

  function handleDelete(m: Message) {
    if (!selectedId) return;
    const convId = selectedId;
    if (!window.confirm("Apagar esta mensagem para todos?")) return;
    startTransition(async () => {
      await deleteMessageAction(convId, m.id);
      const msgs = await fetchMessages(convId);
      setMessagesByConv((prev) => ({ ...prev, [convId]: msgs }));
    });
  }

  function handleSend(text: string, replyId?: string) {
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
      await sendMessage(selectedId, text, replyId);
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
          onSendLocation={handleSendLocation}
          onSendContact={handleSendContact}
          onReact={handleReact}
          onEdit={handleEdit}
          onDelete={handleDelete}
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
