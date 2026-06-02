import Link from "next/link";
import { Bell, Settings, MessageCircle } from "lucide-react";

export function Topbar({ userName, orgName }: { userName: string; orgName: string }) {
  const initials = userName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <header className="flex h-14 items-center justify-between px-6">
      <Link
        href="/atendimento"
        className="flex items-center gap-2 text-sm font-medium text-ink-soft transition hover:text-brand"
      >
        <MessageCircle size={18} />
        Acessar o chat
      </Link>

      <div className="flex items-center gap-4">
        <Link href="/ajustes" className="text-ink-soft hover:text-ink" title="Ajustes">
          <Settings size={18} />
        </Link>
        <button className="text-ink-soft hover:text-ink" title="Notificações">
          <Bell size={18} />
        </button>
        <Link href="/perfil" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
            {initials || "?"}
          </div>
          <div className="hidden text-right leading-tight sm:block">
            <p className="text-sm font-semibold text-ink">{userName}</p>
            <p className="text-xs text-ink-soft">{orgName}</p>
          </div>
        </Link>
      </div>
    </header>
  );
}
