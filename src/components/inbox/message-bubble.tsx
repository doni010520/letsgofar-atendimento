import { cn } from "@/lib/utils";
import type { Message } from "@/lib/types";
import { Check, CheckCheck, Clock, AlertCircle } from "lucide-react";

export function MessageBubble({ message }: { message: Message }) {
  const out = message.direction === "out";
  const time = message.created_at
    ? new Date(message.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] rounded-2xl px-3 py-2 text-sm shadow-sm",
          out ? "rounded-br-sm bg-brand text-white" : "rounded-bl-sm bg-surface text-ink",
          message.sender_type === "bot" && "bg-violet-100 text-violet-900",
          message.sender_type === "system" && "bg-gray-200 text-gray-600 italic",
        )}
      >
        {message.content_type !== "text" && (
          <p className="mb-1 text-xs opacity-80">[{message.content_type}]</p>
        )}
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <div className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]", out ? "text-white/70" : "text-ink-soft")}>
          {time}
          {out && <StatusIcon status={message.status} />}
        </div>
      </div>
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
