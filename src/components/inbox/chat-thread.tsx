"use client";

import { useEffect, useRef, useState } from "react";
import { UserCheck, CheckCircle2, Users, Bell, BellOff, Reply, X } from "lucide-react";
import { MessageBubble } from "./message-bubble";
import { Composer } from "./composer";
import type { ConversationOverview, Message } from "@/lib/types";

export function ChatThread({
  conversation,
  messages,
  onSend,
  onSendFile,
  onSendLocation,
  onSendContact,
  onReact,
  onEdit,
  onDelete,
  onAssign,
  onClose,
  onToggleMute,
  pending,
}: {
  conversation: ConversationOverview;
  messages: Message[];
  onSend: (text: string, replyId?: string) => void;
  onSendFile: (file: File) => void;
  onSendLocation: () => void;
  onSendContact: () => void;
  onReact: (m: Message, emoji: string) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onAssign: () => void;
  onClose: () => void;
  onToggleMute: () => void;
  pending?: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, conversation.id]);
  useEffect(() => setReplyTo(null), [conversation.id]);

  const isMeta = conversation.channel_type === "meta_cloud";
  const isGroup = !!conversation.is_group;
  const muted = !!conversation.is_muted;
  const title = conversation.contact_name ?? (isGroup ? "Grupo" : conversation.contact_phone);

  return (
    <div className="flex h-full flex-1 flex-col bg-canvas">
      <header className="flex items-center justify-between border-b border-gray-100 bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          {conversation.contact_avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={conversation.contact_avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold ${
                isGroup ? "bg-brand-light text-brand" : "bg-gray-200 text-gray-600"
              }`}
            >
              {isGroup ? <Users size={18} /> : title.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              {title}
              {isGroup && (
                <span className="rounded bg-brand-light px-1.5 py-0.5 text-[10px] font-medium text-brand">
                  Grupo
                </span>
              )}
              {muted && <BellOff size={13} className="text-ink-soft" />}
            </p>
            <p className="text-xs text-ink-soft">
              {isGroup ? "Conversa de grupo" : conversation.contact_phone} ·{" "}
              <span className={isMeta ? "text-blue-600" : "text-gray-600"}>
                {conversation.channel_name}
              </span>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onToggleMute}
            title={muted ? "Reativar notificações" : "Silenciar conversa"}
            className="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-200"
          >
            {muted ? <BellOff size={14} /> : <Bell size={14} />}
            {muted ? "Silenciado" : "Silenciar"}
          </button>
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
          <MessageBubble
            key={m.id}
            message={m}
            onReply={setReplyTo}
            onReact={onReact}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
        <div ref={endRef} />
      </div>

      {replyTo && (
        <div className="flex items-center gap-2 border-t border-gray-100 bg-brand-light/40 px-4 py-2 text-xs">
          <Reply size={14} className="text-brand" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-brand">Respondendo</p>
            <p className="truncate text-ink-soft">
              {replyTo.body ?? (replyTo.content_type !== "text" ? `[${replyTo.content_type}]` : "")}
            </p>
          </div>
          <button onClick={() => setReplyTo(null)} className="text-ink-soft hover:text-ink"><X size={15} /></button>
        </div>
      )}

      <Composer
        onSend={(text) => {
          onSend(text, replyTo?.external_id ?? undefined);
          setReplyTo(null);
        }}
        onSendFile={onSendFile}
        onSendLocation={onSendLocation}
        onSendContact={onSendContact}
        disabled={conversation.status === "closed"}
        sending={pending}
      />
    </div>
  );
}
