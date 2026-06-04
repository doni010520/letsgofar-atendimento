"use client";

import { useEffect, useRef, useState } from "react";
import { UserCheck, CheckCircle2, Users, Bell, BellOff, Reply, X, Info, Crown, Shield, Loader2 } from "lucide-react";
import { MessageBubble } from "./message-bubble";
import { Composer } from "./composer";
import { getGroupInfo, type GroupInfoResult } from "@/app/(app)/atendimento/actions";
import { formatPhone } from "@/lib/utils";
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
  onAuthorClick,
  onOpenContact,
  onAssign,
  onClose,
  onToggleMute,
  onType,
  pending,
}: {
  conversation: ConversationOverview;
  messages: Message[];
  onSend: (text: string, replyId?: string, mentions?: { name: string; phone: string }[]) => void;
  onSendFile: (file: File, asSticker?: boolean) => void;
  onType?: () => void;
  onSendLocation: () => void;
  onSendContact: () => void;
  onReact: (m: Message, emoji: string) => void;
  onEdit: (m: Message) => void;
  onDelete: (m: Message) => void;
  onAuthorClick: (m: Message) => void;
  onOpenContact: (phone: string, name?: string) => void;
  onAssign: () => void;
  onClose: () => void;
  onToggleMute: () => void;
  pending?: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [groupInfo, setGroupInfo] = useState<GroupInfoResult | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoLoading, setInfoLoading] = useState(false);

  async function openGroupInfo() {
    setInfoOpen(true);
    setInfoLoading(true);
    try {
      setGroupInfo(await getGroupInfo(conversation.id));
    } finally {
      setInfoLoading(false);
    }
  }
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
          {isGroup && (
            <button
              onClick={openGroupInfo}
              title="Informações do grupo"
              className="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-ink hover:bg-gray-200"
            >
              <Info size={14} /> Info
            </button>
          )}
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
        {(() => {
          // Mapa id-externo (sufixo) → mensagem, para resolver o autor/treco citado.
          const byExt = new Map<string, Message>();
          for (const mm of messages) {
            if (mm.external_id) byExt.set(mm.external_id.split(":").pop()!, mm);
          }
          return messages.map((m) => {
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
          conversation.is_group
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
      />

      {infoOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setInfoOpen(false)}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-card bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 p-4">
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink"><Users size={18} /> Informações do grupo</h2>
              <button onClick={() => setInfoOpen(false)} className="text-ink-soft hover:text-ink"><X size={18} /></button>
            </div>
            <div className="overflow-y-auto p-4">
              {infoLoading && (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink-soft">
                  <Loader2 size={16} className="animate-spin" /> Carregando...
                </div>
              )}
              {!infoLoading && groupInfo && (
                <>
                  <p className="text-lg font-semibold text-ink">{groupInfo.name ?? title}</p>
                  {groupInfo.description && (
                    <p className="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-ink-soft">{groupInfo.description}</p>
                  )}
                  <p className="mt-4 mb-2 text-xs font-semibold uppercase text-ink-soft">
                    {groupInfo.participants.length} participantes
                  </p>
                  <div className="space-y-1">
                    {groupInfo.participants.map((p) => (
                      <button
                        key={p.phone}
                        onClick={() => { setInfoOpen(false); onOpenContact(p.phone, p.name ?? undefined); }}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-gray-50"
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600">
                          {(p.name ?? p.phone).slice(0, 2).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{p.name ?? formatPhone(p.phone)}</span>
                          {p.name && <span className="block truncate text-xs text-ink-soft">{formatPhone(p.phone)}</span>}
                        </span>
                        {p.isOwner ? (
                          <span className="flex items-center gap-1 text-[10px] font-medium text-amber-600"><Crown size={12} /> Dono</span>
                        ) : p.isAdmin ? (
                          <span className="flex items-center gap-1 text-[10px] font-medium text-brand"><Shield size={12} /> Admin</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {!infoLoading && !groupInfo && (
                <p className="py-8 text-center text-sm text-ink-soft">Não foi possível carregar as informações do grupo.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
