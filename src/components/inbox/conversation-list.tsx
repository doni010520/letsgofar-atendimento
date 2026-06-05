"use client";

import { useState } from "react";
import { Search, Users, BellOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationOverview, ConversationStatus } from "@/lib/types";

const FILTERS: { key: ConversationStatus | "all"; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "queued", label: "Em espera" },
  { key: "open", label: "Em andamento" },
  { key: "bot", label: "Bot" },
  { key: "closed", label: "Encerrados" },
];

const STATUS_DOT: Record<ConversationStatus, string> = {
  bot: "bg-violet-500",
  queued: "bg-amber-500",
  open: "bg-green-500",
  closed: "bg-gray-400",
};

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: ConversationOverview[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<ConversationStatus | "all">("all");
  const [query, setQuery] = useState("");

  const filtered = conversations.filter((c) => {
    if (filter !== "all" && c.status !== filter) return false;
    if (query) {
      const q = query.toLowerCase();
      return (
        (c.contact_name ?? "").toLowerCase().includes(q) ||
        c.contact_phone.includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex h-full w-full shrink-0 flex-col border-r border-gray-100 bg-surface md:w-80">
      <div className="border-b border-gray-100 p-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar conversa..."
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand"
          />
        </div>
        <div className="mt-2 flex gap-1 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition",
                filter === f.key ? "bg-brand text-white" : "bg-gray-100 text-ink-soft hover:bg-gray-200",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="p-6 text-center text-xs text-ink-soft">Nenhuma conversa.</p>
        )}
        {filtered.map((c) => {
          const isGroup = !!c.is_group;
          const title = c.contact_name ?? (isGroup ? "Grupo" : c.contact_phone);
          const initials = title
            .split(" ")
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase())
            .join("");
          const time = c.last_message_at
            ? new Date(c.last_message_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
            : "";
          // Rótulo de mídia (quando o body está vazio, mostra o tipo como o WhatsApp Web).
          const mediaLabel: Record<string, string> = {
            image: "📷 Foto",
            video: "🎥 Vídeo",
            audio: "🎵 Áudio",
            document: "📄 Documento",
            sticker: "🏷️ Figurinha",
            location: "📍 Localização",
            contact: "👤 Contato",
            template: "📋 Template",
          };
          const bodyOrMedia = c.last_message_body
            || (c.last_message_type ? mediaLabel[c.last_message_type] ?? `[${c.last_message_type}]` : "—");
          // Em grupos, prefixa a prévia com quem enviou a última mensagem.
          const preview =
            isGroup && c.last_message_author && c.last_message_direction === "in"
              ? `${c.last_message_author.split(" ")[0]}: ${bodyOrMedia}`
              : bodyOrMedia;
          const unread = (c.unread_count ?? 0) > 0;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={cn(
                "flex w-full items-center gap-3 border-b border-gray-50 px-3 py-3 text-left transition hover:bg-gray-50",
                selectedId === c.id && "bg-brand-light hover:bg-brand-light",
              )}
            >
              <div className="relative h-10 w-10 shrink-0">
                {c.contact_avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.contact_avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold",
                      isGroup ? "bg-brand-light text-brand" : "bg-gray-200 text-gray-600",
                    )}
                  >
                    {isGroup ? <Users size={18} /> : initials || "?"}
                  </div>
                )}
                <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white", STATUS_DOT[c.status])} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className={cn("flex min-w-0 items-center gap-1 truncate text-sm", unread ? "font-bold text-ink" : "font-medium text-ink")}>
                    <span className="truncate">{title}</span>
                    {c.is_muted && <BellOff size={12} className="shrink-0 text-ink-soft" />}
                  </p>
                  <span className={cn("shrink-0 text-[10px]", unread ? "font-semibold text-green-600" : "text-ink-soft")}>{time}</span>
                </div>
                <div className="flex items-center gap-2">
                  <p className={cn("min-w-0 flex-1 truncate text-xs", unread ? "font-semibold text-ink" : "text-ink-soft")}>{preview}</p>
                  {unread && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-green-500 px-1 text-[10px] font-bold text-white">
                      {c.unread_count! > 99 ? "99+" : c.unread_count}
                    </span>
                  )}
                </div>
                <p className="truncate text-[10px] text-ink-soft/70">{c.channel_name}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
