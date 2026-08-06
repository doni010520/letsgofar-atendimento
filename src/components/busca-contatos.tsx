"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

/**
 * Busca da lista de contatos.
 *
 * Espera a pessoa parar de digitar antes de consultar: sem isso cada tecla
 * viraria uma consulta ao banco em cima de mil contatos. Ela vive na URL para
 * que a busca sobreviva ao voltar do navegador e possa ser mandada por link.
 */
export function BuscaContatos({ termoInicial = "" }: { termoInicial?: string }) {
  const router = useRouter();
  const [termo, setTermo] = useState(termoInicial);

  useEffect(() => {
    if (termo === termoInicial) return;
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (termo.trim()) p.set("q", termo.trim());
      router.push(`/clientes${p.toString() ? `?${p}` : ""}`);
    }, 350);
    return () => clearTimeout(t);
  }, [termo, termoInicial, router]);

  return (
    <div className="relative w-full max-w-sm">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
      <input
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder="Buscar por nome, telefone ou e-mail"
        className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-ink outline-none transition focus:border-brand"
      />
    </div>
  );
}
