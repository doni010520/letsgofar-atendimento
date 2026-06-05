"use client";

import { useEffect, useRef, useState } from "react";
import { UserCheck, CheckCircle2, Users, Bell, BellOff, Reply, X, ArrowRightLeft, Hash, ArrowLeft } from "lucide-react";
import { MessageBubble } from "./message-bubble";
import { Composer } from "./composer";
import type { ConversationOverview, Message } from "@/lib/types";

export function ChatThread({
  conversation,
  messages,
  groupParticipants,
  onSend,
  onSendFile,
  onSendLocation,
  onSendContact,
  onReact,
  onEdit,
  onDelete,
  onAuthorClick,
  onOpenPanel,
  onBack,
  onAssign,
  onClose,
  onTransfer,
  onToggleMute,
  onType,
  pending,
}: {
  conversation: ConversationOverview;
  messages: Message[];
  groupParticipants?: { name: string; phone: string }[];
  onSend: (text: string, replyId?: string, mentions?: { name: string; phone: string }[]) => void;
  onSendFile: (file: File, asSticker?: boolean) => void;
  onType?: () => void;
  onSendLocation: () => void;
  onSendContact: () => void;
  onReact: (m: Message, emoji: string) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onAuthorClick: (m: Message) => void;
  onOpenPanel: () => void;
  onBack?: () => void;
  onAssign: () => void;
  onClose: () => void;
  onTransfer: () => void;
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
      <header className="shrink-0 border-b border-gray-100 bg-surface">
        {/* Linha 1: avatar + nome + protocolo */}
        <div className="flex items-center gap-2 px-3 pt-2.5 pb-1 md:px-4">
          {onBack && (
            <button onClick={onBack} className="shrink-0 rounded-lg p-1.5 text-ink-soft hover:bg-gray-100 md:hidden" title="Voltar">
              <ArrowLeft size={20} />
            </button>
          )}
          <button onClick={onOpenPanel} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition hover:bg-gray-50 p-1" title="Ver dados">
            {conversation.contact_avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={conversation.contact_avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
            ) : (
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${isGroup ? "bg-brand-light text-brand" : "bg-gray-200 text-gray-600"}`}>
                {isGroup ? <Users size={16} /> : title.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
                <span className="truncate">{title}</span>
                {isGroup && <span className="shrink-0 rounded bg-brand-light px-1 py-0.5 text-[9px] font-medium text-brand">Grupo</span>}
                {muted && <BellOff size={12} className="shrink-0 text-ink-soft" />}
              </p>
              <p className="truncate text-[11px] text-ink-soft">
                {isGroup ? "Conversa de grupo" : conversation.contact_phone}
                {" · "}{conversation.channel_name}
                {conversation.protocol && <span className="ml-1 font-mono text-[10px]">#{conversation.protocol}</span>}
              </p>
            </div>
          </button>
        </div>
        {/* Linha 2: ações */}
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
          <button onClick={onToggleMute} title={muted ? "Reativar" : "Silenciar"} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-[11px] font-medium text-ink hover:bg-gray-200">
            {muted ? <BellOff size={12} /> : <Bell size={12} />} {muted ? "Silenciado" : "Silenciar"}
          </button>
          {conversation.status !== "closed" && (
            <>
              <button onClick={onAssign} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-[11px] font-medium text-ink hover:bg-gray-200">
                <UserCheck size={12} /> Assumir
              </button>
              <button onClick={onTransfer} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-[11px] font-medium text-ink hover:bg-gray-200">
                <ArrowRightLeft size={12} /> Transferir
              </button>
              <button onClick={onClose} className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-danger hover:bg-red-100">
                <CheckCircle2 size={12} /> Encerrar
              </button>
            </>
          )}
          {conversation.status === "closed" && (
            <span className="rounded-md bg-gray-100 px-2 py-1 text-[11px] text-ink-soft">Encerrado</span>
          )}
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="mt-10 text-center text-xs text-ink-soft">Nenhuma mensagem ainda.</p>
        )}
        {(() => {
          // Mapa id-externo (sufixo) → mensagem, para resolver o autor/treco citado.
          const byExt = new Map<string, Message>();
          for (const mm of messages) {
            if (mm.external_id) byExt.set(mm.external_id.split(":").pop()!, mm);
          }
          return messages.map((m) => {
            if (m.is_internal) {
              return (
                <div key={m.id} className="flex justify-center px-6 py-1">
                  <div className="max-w-md rounded-lg bg-amber-50 px-3 py-1.5 text-center text-xs text-amber-800 ring-1 ring-amber-100">
                    <span className="font-medium">Nota interna</span> · {m.body}
                  </div>
                </div>
              );
            }
            let quotedAuthor: string | null | undefined = m.reply_author;
            let quotedExcerpt: string | null | undefined = m.reply_excerpt;
            if (m.reply_to_external) {
              const q = byExt.get(m.reply_to_external.split(":").pop()!);
              if (q) {
                quotedAuthor = q.author_name ?? (q.direction === "out" ? "Você" : conversation.contact_name);
                quotedExcerpt = q.body ?? (q.content_type !== "text" ? `[${q.content_type}]` : quotedExcerpt);
              }
            }
            return (
              <MessageBubble
                key={m.id}
                message={m}
                onReply={setReplyTo}
                onReact={onReact}
                onEdit={onEdit}
                onDelete={onDelete}
                onAuthorClick={onAuthorClick}
                quotedAuthor={quotedAuthor}
                quotedExcerpt={quotedExcerpt}
              />
            );
          });
        })()}
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
        onSend={(text, mentions) => {
          onSend(text, replyTo?.external_id ?? undefined, mentions);
          setReplyTo(null);
        }}
        onSendFile={onSendFile}
        onSendLocation={onSendLocation}
        onSendContact={onSendContact}
        onType={onType}
        mentionCandidates={
          conversation.is_group && groupParticipants?.length
            ? groupParticipants
            : conversation.is_group
              ? Array.from(
                  new Map(
                    messages
                      .filter((m) => m.author_name && m.author_phone)
                      .map((m) => [m.author_phone!, { name: m.author_name!, phone: m.author_phone! }]),
                  ).values(),
                )
              : undefined
        }
        disabled={conversation.status === "closed"}
        sending={pending}
        focusTrigger={replyTo}
      />
    </div>
  );
}
