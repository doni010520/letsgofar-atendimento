"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, ChevronsLeft, ChevronsRight } from "lucide-react";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(localStorage.getItem("sb-expanded") === "1");
  }, []);

  function toggle() {
    setExpanded((e) => {
      localStorage.setItem("sb-expanded", e ? "0" : "1");
      return !e;
    });
  }

  return (
    <aside
      className={cn(
        "flex h-screen shrink-0 flex-col bg-surface py-3 shadow-[2px_0_12px_rgba(0,0,0,0.04)] transition-all duration-200",
        expanded ? "w-60 px-3" : "w-[72px] items-center px-2",
      )}
    >
      {/* Logo */}
      <Link
        href="/dashboard"
        title="MVF"
        className={cn("mb-2 flex items-center gap-2", expanded ? "px-1" : "justify-center")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mvf.png" alt="MVF" className="h-10 w-10 object-contain" />
        {expanded && <span className="text-lg font-bold tracking-tight text-ink">MVF Chat</span>}
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden">
        {NAV.map((group) => (
          <div key={group.title} className="flex flex-col gap-0.5 py-1">
            {expanded ? (
              <span className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-soft/70">
                {group.title}
              </span>
            ) : (
              <span className="mx-auto my-1 h-px w-6 bg-gray-200" aria-hidden />
            )}
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={expanded ? undefined : item.label}
                  className={cn(
                    "group relative flex items-center rounded-xl transition",
                    expanded ? "gap-3 px-3 py-2" : "h-11 w-11 justify-center",
                    active
                      ? "bg-brand-light text-brand"
                      : "text-ink-soft hover:bg-gray-100 hover:text-ink",
                  )}
                >
                  <Icon size={20} className="shrink-0" />
                  {expanded ? (
                    <span className="truncate text-sm font-medium">{item.label}</span>
                  ) : (
                    <span className="pointer-events-none absolute left-14 z-50 hidden whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-white group-hover:block">
                      {item.label}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Rodapé: expandir/recolher + sair */}
      <div className="mt-2 flex flex-col gap-1 border-t border-gray-100 pt-2">
        <button
          onClick={toggle}
          title={expanded ? "Recolher" : "Expandir"}
          className={cn(
            "flex items-center rounded-xl text-ink-soft transition hover:bg-gray-100 hover:text-ink",
            expanded ? "gap-3 px-3 py-2" : "h-11 w-11 justify-center",
          )}
        >
          {expanded ? <ChevronsLeft size={20} /> : <ChevronsRight size={20} />}
          {expanded && <span className="text-sm font-medium">Recolher</span>}
        </button>

        <form action="/auth/signout" method="post">
          <button
            type="submit"
            title="Sair"
            className={cn(
              "flex w-full items-center rounded-xl text-danger transition hover:bg-red-50",
              expanded ? "gap-3 px-3 py-2" : "h-11 w-11 justify-center",
            )}
          >
            <LogOut size={20} className="shrink-0" />
            {expanded && <span className="text-sm font-medium">Sair</span>}
          </button>
        </form>
      </div>
    </aside>
  );
}
