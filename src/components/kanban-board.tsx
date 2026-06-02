"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ConversationOverview, ConversationStatus } from "@/lib/types";

const COLUMNS: { status: ConversationStatus; title: string; dot: string; head: string }[] = [
  { status: "open", title: "Em andamento", dot: "bg-green-500", head: "text-green-700" },
  { status: "queued", title: "Em espera", dot: "bg-amber-500", head: "text-amber-700" },
  { status: "bot", title: "Na automação", dot: "bg-violet-500", head: "text-violet-700" },
];

export function KanbanBoard({ conversations }: { conversations: ConversationOverview[] }) {
  const router = useRouter();
  return (
    <div className="grid h-full grid-cols-1 gap-4 overflow-hidden p-6 md:grid-cols-3">
      {COLUMNS.map((col) => {
        const items = conversations.filter((c) => c.status === col.status);
        return (
          <div key={col.status} className="flex min-h-0 flex-col rounded-card bg-gray-50/70">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", col.dot)} />
                <h3 className={cn("text-sm font-semibold", col.head)}>{col.title}</h3>
              </div>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-ink-soft">{items.length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {items.length === 0 && <p className="pt-6 text-center text-xs text-ink-soft">Nenhum atendimento.</p>}
              {items.map((c) => {
                const initials = (c.contact_name ?? c.contact_phone).split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
                const time = c.last_message_at ? new Date(c.last_message_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
                return (
                  <button
                    key={c.id}
                    onClick={() => router.push("/atendimento")}
                    className="w-full rounded-lg bg-surface p-3 text-left shadow-sm transition hover:shadow-md"
                  >
                    <div className="flex items-center gap-2">
                      {c.contact_avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.contact_avatar} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-600">{initials || "?"}</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{c.contact_name ?? c.contact_phone}</p>
                        <p className="truncate text-[11px] text-ink-soft">{c.channel_name}</p>
                      </div>
                      <span className="shrink-0 text-[10px] text-ink-soft">{time}</span>
                    </div>
                    {c.last_message_body && <p className="mt-2 line-clamp-2 text-xs text-ink-soft">{c.last_message_body}</p>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
