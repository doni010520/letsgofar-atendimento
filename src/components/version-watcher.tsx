"use client";

import { useEffect, useRef, useState } from "react";
import { APP_VERSION } from "@/lib/version";

/**
 * Detecta que saiu uma versão nova do app e oferece recarregar. Resolve o
 * problema recorrente de "precisa dar F5": quem fica com a aba aberta continua
 * no bundle antigo depois de um deploy (realtime/polling do código velho).
 * Compara o APP_VERSION embutido no bundle com o /api/version do servidor.
 */
export function VersionWatcher() {
  const [stale, setStale] = useState(false);
  const staleRef = useRef(false);
  const loaded = useRef(APP_VERSION);
  useEffect(() => { staleRef.current = stale; }, [stale]);

  useEffect(() => {
    let cancel = false;
    const markStale = () => {
      // Aba em segundo plano → recarrega sozinha. Aba ativa: só recarrega
      // sozinha se NINGUÉM estiver digitando (senão perderia o texto) — aí
      // mostra o botão. Objetivo: ninguém fica preso em bundle antigo.
      if (document.hidden) { window.location.reload(); return; }
      const typing = Array.from(document.querySelectorAll("textarea, input[type=text], input:not([type])"))
        .some((el) => (el as HTMLInputElement | HTMLTextAreaElement).value?.trim());
      if (!typing) window.location.reload();
      else setStale(true);
    };
    const check = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const j = (await r.json()) as { version?: string };
        if (!cancel && j.version && j.version !== loaded.current) markStale();
      } catch {
        /* silencioso */
      }
    };
    const onVis = () => {
      if (document.hidden) { if (staleRef.current) window.location.reload(); } // saiu da aba desatualizado → atualiza
      else check(); // voltou pra aba → confere na hora
    };
    const t = setInterval(check, 60000); // a cada 1 min
    document.addEventListener("visibilitychange", onVis);
    check();
    return () => { cancel = true; clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  if (!stale) return null;
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 animate-pulse rounded-full bg-brand px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:animate-none hover:bg-brand-dark"
    >
      🔄 Nova versão disponível — clique para atualizar
    </button>
  );
}
