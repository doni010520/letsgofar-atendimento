"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { criarBotTriagem } from "@/app/(app)/automacoes/triagem-actions";

/**
 * Cria o bot de triagem a partir dos departamentos cadastrados.
 * Avisa se algum setor ficou sem departamento correspondente.
 */
export function TriagemButton() {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              const semDepto = await criarBotTriagem();
              setMsg(
                semDepto.length
                  ? `Criado. Sem departamento para: ${semDepto.join(", ")} — ajuste no editor.`
                  : "Bot de triagem criado (desligado). Revise os textos e ative.",
              );
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "Não foi possível criar.");
            }
          })
        }
      >
        {pending ? "Criando..." : "Criar bot de triagem"}
      </Button>
      {msg && <p className="max-w-xs text-right text-xs text-ink-soft">{msg}</p>}
    </div>
  );
}
