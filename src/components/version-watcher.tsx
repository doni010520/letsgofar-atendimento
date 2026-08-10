"use client";

import { useEffect, useRef, useState } from "react";
import { APP_VERSION } from "@/lib/version";

// Tempo parado digitando antes de recarregar sozinho, uma vez desatualizado.
const OCIOSO_MS = 12000;

/**
 * Detecta que saiu uma versão nova do app e recarrega sozinho. Resolve o
 * problema recorrente de "precisa dar F5": quem fica com a aba aberta continua
 * no bundle antigo depois de um deploy — e nesse bundle antigo, o clique em
 * Enviar chama uma Server Action que já não existe no servidor novo. O
 * pedido morre ANTES de chegar no nosso código: sem erro no log, sem aviso
 * na tela, só o botão girando. Foi exatamente o que aconteceu com a Luana.
 *
 * Antes disto, uma aba com texto digitado só mostrava um botão pequeno no
 * rodapé e esperava alguém notar — o que não aconteceu. Agora: enquanto a
 * pessoa digita, nada interrompe; no primeiro instante sem tecla nenhuma
 * (12s), a aba recarrega sozinha. Só sobrevive quem digita sem pausa por
 * mais de 12 segundos — e mesmo assim o botão de aviso continua visível
 * como rede de segurança.
 */
export function VersionWatcher() {
  const [stale, setStale] = useState(false);
  const staleRef = useRef(false);
  const loaded = useRef(APP_VERSION);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { staleRef.current = stale; }, [stale]);

  useEffect(() => {
    let cancel = false;

    const armarRecarga = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => window.location.reload(), OCIOSO_MS);
    };

    const markStale = () => {
      // Aba em segundo plano → recarrega na hora, ninguém está olhando.
      if (document.hidden) { window.location.reload(); return; }
      setStale(true);
      armarRecarga();
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
    // Qualquer tecla, com a aba já desatualizada, empurra a recarga para
    // depois — é isto que preserva a frase em andamento.
    const onKey = () => { if (staleRef.current) armarRecarga(); };
    const onVis = () => {
      if (document.hidden) { if (staleRef.current) window.location.reload(); } // saiu da aba desatualizado → atualiza
      else check(); // voltou pra aba → confere na hora
    };
    const t = setInterval(check, 60000); // a cada 1 min
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("keydown", onKey);
    check();
    return () => {
      cancel = true;
      clearInterval(t);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!stale) return null;
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      title="Vai atualizar sozinho assim que você parar de digitar"
      className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 animate-pulse rounded-full bg-brand px-4 py-2 text-sm font-medium text-white shadow-lg transition hover:animate-none hover:bg-brand-dark"
    >
      🔄 Nova versão disponível — clique para atualizar
    </button>
  );
}
