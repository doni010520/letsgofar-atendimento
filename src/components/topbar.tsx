"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, Settings, MessageCircle, User, LogOut, ChevronDown } from "lucide-react";
import { APP_VERSION } from "@/lib/version";

export function Topbar({
  userName,
  orgName,
  email,
}: {
  userName: string;
  orgName: string;
  email?: string;
}) {
  const [open, setOpen] = useState(false);
  const initials = userName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-100 bg-surface px-6">
      <Link
        href="/atendimento"
        className="flex items-center gap-2 text-sm font-medium text-ink-soft transition hover:text-brand"
      >
        <MessageCircle size={18} />
        Acessar o chat
      </Link>

      <div className="flex items-center gap-1">
        <span
          title="Versão do app"
          className="mr-2 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 font-mono text-[11px] font-semibold text-ink-soft"
        >
          {APP_VERSION}
        </span>
        <Link
          href="/ajustes"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-gray-100 hover:text-ink"
          title="Ajustes"
        >
          <Settings size={18} />
        </Link>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-gray-100 hover:text-ink"
          title="Notificações"
        >
          <Bell size={18} />
        </button>

        <div className="relative ml-2">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition hover:bg-gray-100"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">
              {initials || "?"}
            </div>
            <div className="hidden text-left leading-tight sm:block">
              <p className="max-w-[160px] truncate text-sm font-semibold text-ink">{userName}</p>
              <p className="max-w-[160px] truncate text-xs text-ink-soft">{orgName}</p>
            </div>
            <ChevronDown size={15} className="hidden text-ink-soft sm:block" />
          </button>

          {open && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
              <div className="absolute right-0 top-12 z-40 w-60 overflow-hidden rounded-xl border border-gray-100 bg-surface shadow-xl">
                <div className="border-b border-gray-100 px-4 py-3">
                  <p className="truncate text-sm font-semibold text-ink">{userName}</p>
                  {email && <p className="truncate text-xs text-ink-soft">{email}</p>}
                  <p className="mt-0.5 truncate text-[11px] text-brand">{orgName}</p>
                </div>
                <Link href="/perfil" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-ink hover:bg-gray-50">
                  <User size={15} /> Meu perfil
                </Link>
                <Link href="/ajustes" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-ink hover:bg-gray-50">
                  <Settings size={15} /> Ajustes
                </Link>
                <form action="/auth/signout" method="post" className="border-t border-gray-100">
                  <button type="submit" className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-danger hover:bg-red-50">
                    <LogOut size={15} /> Sair
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
