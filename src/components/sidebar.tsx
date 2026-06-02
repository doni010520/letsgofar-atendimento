"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-[72px] flex-col items-center gap-1 bg-surface py-4 shadow-[2px_0_12px_rgba(0,0,0,0.04)]">
      <Link href="/dashboard" className="mb-3 flex h-11 w-11 items-center justify-center" title="MVF">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-mvf.svg" alt="MVF" className="h-10 w-10" />
      </Link>

      <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
        {NAV.map((group) => (
          <div key={group.title} className="flex flex-col items-center gap-1 py-1">
            <span className="my-1 h-px w-6 bg-gray-200" aria-hidden />
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  className={cn(
                    "group relative flex h-11 w-11 items-center justify-center rounded-xl transition",
                    active
                      ? "bg-brand-light text-brand"
                      : "text-ink-soft hover:bg-gray-100 hover:text-ink",
                  )}
                >
                  <Icon size={20} />
                  <span className="pointer-events-none absolute left-14 z-50 hidden whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-white group-hover:block">
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <form action="/auth/signout" method="post">
        <button
          type="submit"
          title="Sair"
          className="flex h-11 w-11 items-center justify-center rounded-xl text-danger transition hover:bg-red-50"
        >
          <LogOut size={20} />
        </button>
      </form>
    </aside>
  );
}
