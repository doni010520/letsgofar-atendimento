"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import type { Channel } from "@/lib/types";
import { saveAiAgent } from "@/app/(app)/ajustes/ia/actions";

export interface AiAgentRow {
  id: string;
  name: string;
  prompt: string | null;
  model: string;
  channel_id: string | null;
  active: boolean;
  config: { temperature?: number; knowledge?: string };
}

const MODELS = [
  { id: "gpt-4o-mini", label: "GPT-4o mini (rápido e barato)" },
  { id: "gpt-4o", label: "GPT-4o (mais capaz)" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  { id: "gpt-4.1", label: "GPT-4.1" },
];

const inputCls = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand";
const labelCls = "mb-1 block text-xs font-medium text-ink-soft";

export function AiAgentForm({ agent, channels }: { agent: AiAgentRow | null; channels: Channel[] }) {
  const [temperature, setTemperature] = useState(agent?.config?.temperature ?? 0.4);
  const [active, setActive] = useState(agent?.active ?? false);

  return (
    <form action={saveAiAgent} className="space-y-5">
      {agent && <input type="hidden" name="id" value={agent.id} />}

      <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-ink">Agente ativo</p>
          <p className="text-xs text-ink-soft">Quando ativo, o agente atende automaticamente os nós de IA dos fluxos.</p>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            name="active"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="peer sr-only"
          />
          <div className="h-6 w-11 rounded-full bg-gray-300 transition peer-checked:bg-brand" />
          <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-5" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Nome do agente</label>
          <input name="name" defaultValue={agent?.name ?? "Agente de IA"} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Modelo</label>
          <select name="model" defaultValue={agent?.model ?? "gpt-4o-mini"} className={inputCls}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Canal (opcional)</label>
        <select name="channel_id" defaultValue={agent?.channel_id ?? ""} className={inputCls}>
          <option value="">Todos os canais</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls}>
          Temperatura — <span className="font-mono text-brand">{temperature.toFixed(1)}</span>
          <span className="ml-1 text-ink-soft">(0 = objetivo, 2 = criativo)</span>
        </label>
        <input
          type="range"
          name="temperature"
          min={0}
          max={1.5}
          step={0.1}
          value={temperature}
          onChange={(e) => setTemperature(Number(e.target.value))}
          className="w-full accent-brand"
        />
      </div>

      <div>
        <label className={labelCls}>Instruções do agente (prompt do sistema)</label>
        <textarea
          name="prompt"
          rows={6}
          defaultValue={agent?.prompt ?? ""}
          placeholder="Ex.: Você é o assistente virtual da MVF NET, um provedor de internet. Seja cordial e objetivo. Ajude o cliente a consultar faturas, gerar 2ª via/PIX, liberar acesso por confiança e abrir chamados de suporte. Transfira para um humano quando não conseguir resolver."
          className={`${inputCls} resize-none font-mono`}
        />
      </div>

      <div>
        <label className={labelCls}>Base de conhecimento (opcional)</label>
        <textarea
          name="knowledge"
          rows={5}
          defaultValue={agent?.config?.knowledge ?? ""}
          placeholder="Informações fixas que o agente deve conhecer: horários, planos, políticas, perguntas frequentes…"
          className={`${inputCls} resize-none`}
        />
      </div>

      <Button type="submit">Salvar configuração</Button>
    </form>
  );
}
