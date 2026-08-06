"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, Button, EmptyState } from "@/components/ui";
import type { ContractRow, TemplateRow } from "@/app/(app)/contratos/page";
import { createContract, sendContract, cancelContract, createTemplate } from "@/app/(app)/contratos/actions";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Rascunho", cls: "bg-gray-100 text-gray-600" },
  pending: { label: "Aguardando assinatura", cls: "bg-amber-100 text-amber-700" },
  partially_signed: { label: "Parcialmente assinado", cls: "bg-blue-100 text-blue-700" },
  signed: { label: "Assinado", cls: "bg-success-bg text-green-700" },
  refused: { label: "Recusado", cls: "bg-red-100 text-red-700" },
  expired: { label: "Expirado", cls: "bg-orange-100 text-orange-700" },
  cancelled: { label: "Cancelado", cls: "bg-gray-100 text-gray-600" },
};

const FILTERS = [
  { key: "all", label: "Todos" },
  { key: "draft", label: "Rascunhos" },
  { key: "pending", label: "Aguardando" },
  { key: "signed", label: "Assinados" },
  { key: "refused", label: "Recusados" },
] as const;

type Signer = { name: string; email: string; document: string };

export function ContractsClient({
  contracts,
  templates,
}: {
  contracts: ContractRow[];
  templates: TemplateRow[];
}) {
  const [tab, setTab] = useState<"contracts" | "templates">("contracts");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [creating, setCreating] = useState(false);
  const [modeloId, setModeloId] = useState("");
  const [signers, setSigners] = useState<Signer[]>([{ name: "", email: "", document: "" }]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const visible = useMemo(
    () => (filter === "all" ? contracts : contracts.filter((c) => c.status === filter)),
    [contracts, filter],
  );

  /** Campos que o modelo escolhido pede — mudam quando troca o modelo. */
  const campos = useMemo(
    () => templates.find((t) => t.id === modeloId)?.variable_fields ?? [],
    [templates, modeloId],
  );

  async function onCreate(fd: FormData) {
    setError("");
    signers.forEach((s) => {
      if (s.name.trim() && s.email.trim()) {
        fd.append("signer_name", s.name);
        fd.append("signer_email", s.email);
        fd.append("signer_document", s.document);
      }
    });
    try {
      await createContract(fd);
      setCreating(false);
      setSigners([{ name: "", email: "", document: "" }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar o contrato.");
    }
  }

  if (creating) {
    return (
      <form action={(fd) => startTransition(() => void onCreate(fd))} className="mt-6 max-w-2xl space-y-5">
        <Card className="space-y-4">
          <h3 className="text-sm font-semibold text-ink">Contrato</h3>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Título</label>
            <input name="title" placeholder="Ex.: Contrato de prestação de serviços"
              className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Modelo</label>
            <select
              name="template_id"
              value={modeloId}
              onChange={(e) => setModeloId(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm"
            >
              <option value="">Sem modelo (escrever abaixo)</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          {!modeloId && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">Conteúdo (se não usar modelo)</label>
              <textarea name="content_html" rows={6} placeholder="<p>Texto do contrato…</p>"
                className="w-full resize-y rounded-lg border border-border bg-surface px-3.5 py-2.5 font-mono text-xs" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">Início do plano</label>
              <input name="plan_start_date" type="date" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">Fim do plano</label>
              <input name="plan_end_date" type="date" className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
            </div>
          </div>
        </Card>

        {/* Dados do contrato: cada campo é um marcador do modelo ({{...}}) e
            entra no texto na hora de gerar. Sem isto o contrato saía com o
            texto do modelo e os espaços em branco, sem como preencher. */}
        {campos.length > 0 && (
          <Card className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-ink">Dados do contrato</h3>
              <p className="text-xs text-ink-soft">
                {campos.length} campos deste modelo. O que ficar vazio sai em branco no documento.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {campos.map((c) => (
                <div key={c.key}>
                  <label className="mb-1 block text-xs font-medium text-ink-soft">{c.label}</label>
                  <input
                    name={`var_${c.key}`}
                    type={c.type === "date" ? "date" : c.type === "email" ? "email" : c.type === "tel" ? "tel" : "text"}
                    inputMode={c.type === "number" || c.type === "currency" ? "decimal" : undefined}
                    placeholder={c.type === "currency" ? "0,00" : undefined}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Signatários</h3>
            <Button type="button" variant="ghost"
              onClick={() => setSigners((s) => [...s, { name: "", email: "", document: "" }])}>
              + Adicionar
            </Button>
          </div>
          {signers.map((s, i) => (
            <div key={i} className="grid grid-cols-3 gap-2">
              <input placeholder="Nome" value={s.name}
                onChange={(e) => setSigners((arr) => arr.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
              <input placeholder="E-mail" type="email" value={s.email}
                onChange={(e) => setSigners((arr) => arr.map((x, idx) => idx === i ? { ...x, email: e.target.value } : x))}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
              <input placeholder="CPF (opcional)" value={s.document}
                onChange={(e) => setSigners((arr) => arr.map((x, idx) => idx === i ? { ...x, document: e.target.value } : x))}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
            </div>
          ))}
        </Card>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button>
          <Button type="submit" disabled={pending}>{pending ? "Salvando..." : "Criar contrato"}</Button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-gray-100 p-1">
          {(["contracts", "templates"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${tab === t ? "bg-surface text-ink shadow-sm" : "text-ink-soft"}`}>
              {t === "contracts" ? "Contratos" : "Modelos"}
            </button>
          ))}
        </div>
        {tab === "contracts" && <Button onClick={() => setCreating(true)}>+ Novo contrato</Button>}
      </div>

      {tab === "templates" ? (
        <div className="space-y-3">
          <Card className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Novo modelo</h3>
            <form action={(fd) => startTransition(() => void createTemplate(fd))} className="space-y-2">
              <input name="name" placeholder="Nome do modelo"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
              <textarea name="content_html" rows={5}
                placeholder="<p>Olá {{nome_aluno}}, ...</p>  — use {{variavel}} para campos dinâmicos"
                className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs" />
              <Button type="submit" disabled={pending}>Salvar modelo</Button>
            </form>
          </Card>
          {templates.map((t) => (
            <Card key={t.id}>
              <p className="font-medium text-ink">{t.name}</p>
              {t.description && <p className="mt-1 text-sm text-ink-soft">{t.description}</p>}
            </Card>
          ))}
          {!templates.length && <EmptyState title="Nenhum modelo ainda" hint="Crie um modelo para gerar contratos mais rápido." />}
        </div>
      ) : (
        <>
          <div className="inline-flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${filter === f.key ? "bg-surface text-ink shadow-sm" : "text-ink-soft"}`}>
                {f.label}
              </button>
            ))}
          </div>

          {!visible.length && <EmptyState title="Nenhum contrato aqui" hint="Crie um contrato ou troque o filtro." />}

          <div className="space-y-2">
            {visible.map((c) => {
              const s = STATUS[c.status] ?? { label: c.status, cls: "bg-gray-100 text-gray-600" };
              const signers = c.contract_signers ?? [];
              const signed = signers.filter((x) => x.status === "signed").length;
              return (
                <Card key={c.id}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-ink-soft">{c.number}</span>
                        <span className="font-medium text-ink">{c.title}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${s.cls}`}>{s.label}</span>
                      </div>
                      <p className="mt-1 text-xs text-ink-soft">
                        {signed}/{signers.length} assinaram
                        {c.plan_end_date && ` · plano até ${new Date(`${c.plan_end_date}T12:00:00`).toLocaleDateString("pt-BR")}`}
                      </p>
                      {c.status === "pending" && signers.some((x) => x.status === "pending") && (
                        <div className="mt-2 space-y-1">
                          {signers.filter((x) => x.status === "pending").map((x) => (
                            <p key={x.id} className="truncate text-[11px] text-ink-soft">
                              {x.name}: <code className="rounded bg-gray-100 px-1">/assinar/{x.sign_token}</code>
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <a
                        href={`/contratos/${c.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-border px-3 py-2 text-sm text-ink-soft hover:text-ink"
                      >
                        PDF
                      </a>
                      {c.status === "draft" && (
                        <Button onClick={() => startTransition(() => void sendContract(c.id))}>
                          Enviar para assinatura
                        </Button>
                      )}
                      {["draft", "pending", "partially_signed"].includes(c.status) && (
                        <Button variant="danger" onClick={() => startTransition(() => void cancelContract(c.id))}>
                          Cancelar
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
