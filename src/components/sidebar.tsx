"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, PanelLeftClose, PanelLeftOpen, Menu, X } from "lucide-react";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function Sidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  // Padrão: menu FIXO aberto. Só recolhe se o usuário tiver escolhido soltar ("0").
  const [pinned, setPinned] = useState(true);
  const [hovered, setHovered] = useState(false);
  const expanded = pinned || hovered;

  /**
   * No CELULAR o menu é gaveta, não coluna.
   *
   * Antes ele ficava sempre aberto ocupando 240px de uma tela de 390px — 55%
   * do aparelho era menu, e o app inteiro se espremia nos 150px que sobravam:
   * mensagem quebrando uma palavra por linha, tabela cortada, botão fora da
   * tela. E o "expandir ao passar o mouse" que existe no computador não tem
   * equivalente no toque, então no celular ele nunca recolhia sozinho.
   */
  const [gaveta, setGaveta] = useState(false);

  useEffect(() => {
    setPinned(localStorage.getItem("sb-pinned") !== "0");
  }, []);

  // Trocar de tela fecha a gaveta — senão o menu cobre o destino recém-aberto.
  useEffect(() => { setGaveta(false); }, [pathname]);

  function togglePin() {
    setPinned((p) => {
      localStorage.setItem("sb-pinned", p ? "0" : "1");
      return !p;
    });
  }

  return (
    <>
      {/* Botão da gaveta: só no celular, flutuando sobre o conteúdo. */}
      <button
        onClick={() => setGaveta((v) => !v)}
        aria-label={gaveta ? "Fechar menu" : "Abrir menu"}
        className="fixed left-3 top-3 z-[60] flex h-11 w-11 items-center justify-center rounded-xl bg-surface text-ink shadow-lg ring-1 ring-border lg:hidden"
      >
        {gaveta ? <X size={22} /> : <Menu size={22} />}
      </button>

      {/* Véu: fecha a gaveta ao tocar fora, que é o gesto que todo mundo tenta. */}
      {gaveta && (
        <div
          onClick={() => setGaveta(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-hidden
        />
      )}
      {conteudo()}
    </>
  );

  function conteudo() {
    // No celular a gaveta sempre mostra os nomes: um menu de ícones sem
    // texto, aberto de propósito, não ajuda ninguém.
    const rotulos = gaveta || expanded;

    return (
    // Espaçador: quando FIXADO, reserva a largura total (240px) para o conteúdo
    // refluir ao lado — não ficar por baixo do menu. No modo hover (não fixado),
    // reserva só a barra fininha e o menu expande por cima temporariamente.
    // No celular NÃO reserva nada (w-0): a gaveta passa por cima.
    <div className={cn("hidden shrink-0 transition-all duration-200 lg:block", pinned ? "lg:w-60" : "lg:w-[72px]")}>
      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          "fixed left-0 top-0 z-50 flex h-screen flex-col bg-surface py-3 transition-all duration-200",
          // Celular: gaveta que desliza de fora da tela. Computador: como era.
          gaveta ? "w-[86vw] max-w-xs translate-x-0 px-3 shadow-2xl" : "-translate-x-full",
          "lg:translate-x-0",
          expanded ? "lg:w-60 lg:px-3 lg:shadow-2xl" : "lg:w-[72px] lg:items-center lg:px-2 lg:shadow-[2px_0_12px_rgba(0,0,0,0.04)]",
        )}
      >
        {/* Logo */}
        <Link
          href="/dashboard"
          title="Let's Go Far"
          className={cn("mb-2 flex items-center gap-2", rotulos ? "px-1" : "lg:justify-center")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand">
            {/* A logo é branca: vai sobre a cor da marca para aparecer nos dois temas. */}
            <img src="/logo-letsgofar.png" alt="Let's Go Far" className="h-8 w-8 object-contain" />
          </span>
          {rotulos && <span className="whitespace-nowrap text-lg font-bold tracking-tight text-ink">Let's Go Far</span>}
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden">
          {NAV.map((group) => (
            <div key={group.title} className="flex flex-col gap-0.5 py-1">
              {rotulos ? (
                <span className="whitespace-nowrap px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-soft/70">
                  {group.title}
                </span>
              ) : (
                <span className="mx-auto my-1 h-px w-6 bg-border" aria-hidden />
              )}
              {group.items.filter((item) => !item.adminOnly || isAdmin).map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={rotulos ? undefined : item.label}
                    className={cn(
                      "flex items-center rounded-xl transition",
                      rotulos ? "gap-3 px-3 py-2" : "h-11 w-11 justify-center",
                      active ? "bg-brand-light text-brand" : "text-ink-soft hover:bg-black/5 dark:hover:bg-white/5 hover:text-ink",
                    )}
                  >
                    <Icon size={20} className="shrink-0" />
                    {rotulos && <span className="truncate whitespace-nowrap text-sm font-medium">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Rodapé: fixar/soltar + sair */}
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          <button
            onClick={togglePin}
            title={pinned ? "Soltar (recolher ao tirar o mouse)" : "Fixar aberta"}
            className={cn(
              // Recolher/fixar é comportamento de mouse: no celular não existe.
              "hidden items-center rounded-xl text-ink-soft transition hover:bg-black/5 dark:hover:bg-white/5 hover:text-ink lg:flex",
              rotulos ? "gap-3 px-3 py-2" : "h-11 w-11 justify-center",
            )}
          >
            {pinned ? <PanelLeftClose size={20} className="shrink-0" /> : <PanelLeftOpen size={20} className="shrink-0" />}
            {rotulos && <span className="whitespace-nowrap text-sm font-medium">{pinned ? "Soltar menu" : "Fixar menu"}</span>}
          </button>

          <form action="/auth/signout" method="post">
            <button
              type="submit"
              title="Sair"
              className={cn(
                "flex w-full items-center rounded-xl text-danger transition hover:bg-red-50",
                rotulos ? "gap-3 px-3 py-2" : "h-11 w-11 justify-center",
              )}
            >
              <LogOut size={20} className="shrink-0" />
              {rotulos && <span className="whitespace-nowrap text-sm font-medium">Sair</span>}
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
  }
}
