"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/types";
import {
  Check, CheckCheck, Clock, AlertCircle, FileText, Download,
  Reply, SmilePlus, Pencil, Trash2, MoreVertical,
} from "lucide-react";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// Paleta de cores por participante (estilo WhatsApp) — determinística pelo nome.
const AUTHOR_COLORS = [
  "#d32f2f", "#1976d2", "#388e3c", "#7b1fa2", "#c2185b", "#0097a7",
  "#f57c00", "#5d4037", "#455a64", "#00796b", "#512da8", "#e64a19",
];
function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AUTHOR_COLORS[h % AUTHOR_COLORS.length];
}

function MediaContent({ message }: { message: Message }) {
  const url = message.media_url;
  if (!url) return null;
  switch (message.content_type) {
    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" className="mb-1 max-h-72 rounded-lg object-cover" /></a>;
    case "sticker":
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={url} alt="" className="mb-1 h-28 w-28 object-contain" />;
    case "audio":
      return <audio controls src={url} className="mb-1 h-10 w-56 max-w-full" />;
    case "video":
      return <video controls src={url} className="mb-1 max-h-72 rounded-lg" />;
    case "document":
      return (
        <a href={url} target="_blank" rel="noreferrer" download className="mb-1 flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm hover:bg-black/10">
          <FileText size={18} /> <span className="underline">Abrir documento</span> <Download size={14} />
        </a>
      );
    default:
      return null;
  }
}

export function MessageBubble({
  message,
  onReply,
  onReact,
  onEdit,
  onDelete,
}: {
  message: Message;
  onReply?: (m: Message) => void;
  onReact?: (m: Message, emoji: string) => void;
  onEdit?: (m: Message) => void;
  onDelete?: (m: Message) => void;
}) {
  const out = message.direction === "out";
  const [menu, setMenu] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const time = message.created_at
    ? new Date(message.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "";
  const reactions = message.reactions ?? [];

  if (message.is_deleted) {
    return (
      <div className={cn("flex", out ? "justify-end" : "justify-start")}>
        <div className="max-w-[70%] rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm italic text-ink-soft">
          🚫 Mensagem apagada
        </div>
      </div>
    );
  }

  return (
    <div className={cn("group flex items-end gap-1", out ? "justify-end" : "justify-start")}>
      {out && <Actions {...{ message, menu, setMenu, emoji, setEmoji, onReply, onReact, onEdit, onDelete }} />}
      <div className="relative max-w-[70%]">
        <div
          className={cn(
            "rounded-2xl px-3 py-2 text-sm shadow-sm",
            out ? "rounded-br-sm bg-brand text-white" : "rounded-bl-sm bg-surface text-ink",
            message.sender_type === "bot" && "bg-violet-100 text-violet-900",
            message.sender_type === "system" && "bg-gray-200 text-gray-600 italic",
          )}
        >
          {!out && message.author_name && (
            <p className="mb-0.5 text-xs font-semibold" style={{ color: colorForName(message.author_name) }}>
              {message.author_name}
            </p>
          )}
          {message.reply_excerpt && (
            <div className={cn("mb-1 rounded border-l-2 px-2 py-1 text-xs", out ? "border-white/60 bg-white/15" : "border-brand/50 bg-black/5 text-ink-soft")}>
              {message.reply_author && <span className="font-medium">{message.reply_author}: </span>}
              {message.reply_excerpt.slice(0, 120)}
            </div>
          )}
          {message.media_url ? (
            <MediaContent message={message} />
          ) : (
            message.content_type !== "text" && <p className="mb-1 text-xs opacity-80">[{message.content_type}]</p>
          )}
          {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
          <div className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]", out ? "text-white/70" : "text-ink-soft")}>
            {message.edited && <span className="italic">editada</span>}
            {time}
            {out && <StatusIcon status={message.status} />}
          </div>
        </div>
        {reactions.length > 0 && (
          <div className={cn("absolute -bottom-2 flex gap-0.5 rounded-full border border-gray-100 bg-surface px-1 text-xs shadow-sm", out ? "right-2" : "left-2")}>
            {reactions.map((r, i) => (
              <span key={i} title={r.by}>{r.emoji}</span>
            ))}
          </div>
        )}
      </div>
      {!out && <Actions {...{ message, menu, setMenu, emoji, setEmoji, onReply, onReact, onEdit, onDelete }} />}
    </div>
  );
}

function Actions({
  message, menu, setMenu, emoji, setEmoji, onReply, onReact, onEdit, onDelete,
}: {
  message: Message; menu: boolean; setMenu: (v: boolean) => void; emoji: boolean; setEmoji: (v: boolean) => void;
  onReply?: (m: Message) => void; onReact?: (m: Message, e: string) => void; onEdit?: (m: Message) => void; onDelete?: (m: Message) => void;
}) {
  const out = message.direction === "out";
  return (
    <div className="relative flex shrink-0 items-center self-center opacity-0 transition group-hover:opacity-100">
      <button onClick={() => { setEmoji(!emoji); setMenu(false); }} className="rounded-full p-1 text-ink-soft hover:bg-gray-100" title="Reagir">
        <SmilePlus size={15} />
      </button>
      <button onClick={() => onReply?.(message)} className="rounded-full p-1 text-ink-soft hover:bg-gray-100" title="Responder">
        <Reply size={15} />
      </button>
      <button onClick={() => { setMenu(!menu); setEmoji(false); }} className="rounded-full p-1 text-ink-soft hover:bg-gray-100" title="Mais">
        <MoreVertical size={15} />
      </button>

      {emoji && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setEmoji(false)} />
          <div className="absolute bottom-7 z-20 flex gap-1 rounded-full border border-gray-100 bg-surface px-2 py-1 shadow-lg">
            {QUICK_EMOJIS.map((e) => (
              <button key={e} onClick={() => { onReact?.(message, e); setEmoji(false); }} className="text-lg hover:scale-125 transition">{e}</button>
            ))}
          </div>
        </>
      )}
      {menu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
          <div className="absolute bottom-7 z-20 w-36 overflow-hidden rounded-lg border border-gray-100 bg-surface py-1 text-sm shadow-xl">
            <button onClick={() => { onReply?.(message); setMenu(false); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-ink hover:bg-gray-50">
              <Reply size={14} /> Responder
            </button>
            {out && (
              <button onClick={() => { onEdit?.(message); setMenu(false); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-ink hover:bg-gray-50">
                <Pencil size={14} /> Editar
              </button>
            )}
            <button onClick={() => { onDelete?.(message); setMenu(false); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-danger hover:bg-red-50">
              <Trash2 size={14} /> Apagar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "pending":
      return <Clock size={12} />;
    case "sent":
      return <Check size={12} />;
    case "delivered":
      return <CheckCheck size={12} />;
    case "read":
      return <CheckCheck size={12} className="text-sky-200" />;
    case "failed":
      return <AlertCircle size={12} className="text-red-200" />;
    default:
      return null;
  }
}
