"use client";

import { useState, useTransition } from "react";
import { Card, Button, EmptyState } from "@/components/ui";
import type { Channel } from "@/lib/types";
import type { BroadcastRow } from "@/app/(app)/disparos/page";
import {
  createBroadcast,
  uploadRecipientsCsv,
  startBroadcast,
  pauseBroadcast,
  cancelBroadcast,
} from "@/app/(app)/disparos/actions";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Rascunho", cls: "bg-gray-100 text-gray-600" },
  running: { label: "Enviando", cls: "bg-blue-100 text-blue-700" },
  paused: { label: "Pausado", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "Concluído", cls: "bg-success-bg text-green-700" },
  cancelled: { label: "Cancelado", cls: "bg-gray-100 text-gray-600" },
};

const CSV_MODELO =
  "telefone,nome,merge1,merge2\n5511999998888,Maria Silva,inglês para carreira,agosto\n";

function progress(b: BroadcastRow) {
  if (!b.total_count) return 0;
  return Math.round(((b.sent_count + b.failed_count) / b.total_count) * 100);
}

export function BroadcastsClient({
  broadcasts,
  channels,
  agents,
}: {
  broadcasts: BroadcastRow[];
  channels: Channel[];
  agents: { id: string; name: string | null }[];
}) {
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [contactCount, setContactCount] = useState(0);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function insertVar(token: string) {
    setMessage((m) => m + token);
  }

  function baixarModelo() {
    const blob = new Blob(["﻿" + CSV_MODELO], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-disparo.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? "");
      setCsv(text);
      setContactCount(Math.max(0, text.split(/\r?\n/).filter((l) => l.trim()).length - 1));
    };
    reader.readAsText(file);
  }

  async function onSubmit(fd: FormData) {
    setError("");
    if (!String(fd.get("title") || "").trim() || !message.trim()) {
      setError("Preencha o nome e a mensagem.");
      return;
    }
    if (!csv) {
      setError("Envie a planilha CSV de contatos.");
      return;
    }
    fd.set("message_template", message);
    try {
      const id = await createBroadcast(fd);
      if (id) await uploadRecipientsCsv(id, csv);
      setCreating(false);
      setMessage("");
      setCsv("");
      setFileName("");
      setContactCount(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar o disparo.");
    }
  }

  if (creating) {
    return (
      <form action={(fd) => startTransition(() => void onSubmit(fd))} className="mt-6 max-w-2xl space-y-5">
        <Card className="space-y-5">
          <h3 className="text-sm font-semibold text-ink">Conteúdo</h3>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Nome do disparo</label>
            <input
              name="title"
              placeholder="Ex.: Retomada agosto"
              className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Atribuir conversas a</label>
            <select name="assigned_to" className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm">
              <option value="">Você (quem criou)</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name ?? "Sem nome"}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Canal</label>
            <select name="channel_id" className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm">
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Mensagem</label>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-ink-soft">Inserir variável:</span>
              {["{primeiro_nome}", "{nome}", "{merge1}", "{merge2}"].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => insertVar(t)}
                  className="rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-xs text-ink-soft hover:text-ink"
                >
                  {t}
                </button>
              ))}
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={7}
              placeholder="Oi {primeiro_nome}! {Tudo bem?|Como você está?} Aqui é a Luana, da Let's Go Far..."
              className="w-full resize-y rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-relaxed"
            />
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">
              Use <code className="rounded bg-gray-100 px-1">{"{primeiro_nome}"}</code> para o nome. Para variar sem
              mudar o sentido, escreva alternativas entre chaves separadas por barra —{" "}
              <code className="rounded bg-gray-100 px-1">{"{Oi|Olá}"}</code> — e cada contato recebe uma combinação.
            </p>
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Contatos</h3>
            <Button type="button" variant="ghost" onClick={baixarModelo}>
              Baixar modelo
            </Button>
          </div>

          <label
            className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-8 text-center ${
              fileName ? "border-blue-400 bg-blue-50/40" : "border-gray-300"
            }`}
          >
            {fileName ? (
              <>
                <span className="text-sm font-medium text-ink">{fileName}</span>
                <span className="text-xs font-medium text-blue-700">
                  {contactCount} {contactCount === 1 ? "contato detectado" : "contatos detectados"}
                </span>
                <span className="text-xs text-ink-soft underline">trocar arquivo</span>
              </>
            ) : (
              <>
                <span className="text-sm font-medium text-ink-soft">Clique para enviar a planilha CSV</span>
                <span className="text-xs text-ink-soft">
                  Colunas: telefone (com DDI 55), nome, e opcionalmente merge1, merge2
                </span>
              </>
            )}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          </label>
        </Card>

        <Card className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">Ritmo e limites</h3>
            <p className="mt-0.5 text-xs text-ink-soft">
              Espaçamento entre mensagens e janela de envio (proteção anti-bloqueio).
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { name: "min_minutes", label: "Intervalo mín. (min)", def: 5 },
              { name: "max_minutes", label: "Intervalo máx. (min)", def: 6 },
              { name: "window_start", label: "Janela início", def: 9 },
              { name: "window_end", label: "Janela fim", def: 18 },
              { name: "daily_cap", label: "Teto por dia", def: 50 },
            ].map((f) => (
              <div key={f.name}>
                <label className="mb-1.5 block text-xs font-medium text-ink-soft">{f.label}</label>
                <input
                  name={f.name}
                  type="number"
                  defaultValue={f.def}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>
        </Card>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ink-soft">O envio começa na próxima etapa, depois de você revisar a lista.</p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Continuar"}
            </Button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>+ Novo disparo</Button>
      </div>

      {!broadcasts.length && (
        <EmptyState title="Nenhum disparo ainda" hint="Clique em “Novo disparo” para começar." />
      )}

      {broadcasts.map((b) => {
        const s = STATUS[b.status] ?? { label: b.status, cls: "bg-gray-100 text-gray-600" };
        return (
          <Card key={b.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-ink">{b.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${s.cls}`}>{s.label}</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                  <div className="h-full bg-blue-600" style={{ width: `${progress(b)}%` }} />
                </div>
                <p className="mt-2 text-xs text-ink-soft">
                  {b.sent_count}/{b.total_count} enviados
                  {b.failed_count > 0 && ` · ${b.failed_count} falhas`}
                </p>
              </div>

              <div className="flex shrink-0 gap-2">
                {(b.status === "draft" || b.status === "paused") && (
                  <Button onClick={() => startTransition(() => void startBroadcast(b.id))}>
                    {b.status === "paused" ? "Retomar" : "Iniciar disparo"}
                  </Button>
                )}
                {b.status === "running" && (
                  <Button variant="ghost" onClick={() => startTransition(() => void pauseBroadcast(b.id))}>
                    Pausar
                  </Button>
                )}
                {["draft", "running", "paused"].includes(b.status) && (
                  <Button variant="danger" onClick={() => startTransition(() => void cancelBroadcast(b.id))}>
                    Cancelar
                  </Button>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
