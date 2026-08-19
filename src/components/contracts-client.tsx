"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Card, Button, EmptyState } from "@/components/ui";
import { ContractEditor } from "@/components/contract-editor";
import { renderTemplate } from "@/lib/contract-template";
import type { ContractRow, TemplateRow } from "@/app/(app)/contratos/page";
import { createContract, sendContract, cancelContract, createTemplate, getContractForEdit, updateContract } from "@/app/(app)/contratos/actions";

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

type Signer = { name: string; email: string; document: string; phone: string };
type CampoNovo = { key: string; label: string; type: string };

/**
 * Rascunho do contrato que está sendo criado, salvo no navegador.
 *
 * Preencher um contrato tem campo que só está em outro lugar (data de
 * nascimento, número de parcelas...) — quem preenche precisa sair da tela
 * pra buscar, e sem isto voltava com o formulário inteiro vazio, tinha que
 * digitar tudo de novo. Como não é dado sensível de cliente (só o que a
 * própria pessoa está digitando, ainda não salvo), localStorage resolve sem
 * precisar de tabela nova no banco.
 */
type Rascunho = {
  title: string;
  modeloId: string;
  contentHtml: string;
  /** true assim que a pessoa mexe no editor de texto direto — a partir daí
   * o texto para de se regenerar sozinho toda vez que um campo/variável muda
   * (senão qualquer edição feita à mão seria apagada no próximo campo digitado). */
  contentDirty: boolean;
  planStart: string;
  planEnd: string;
  vars: Record<string, string>;
  signers: Signer[];
};

const RASCUNHO_KEY = "lgf_contrato_rascunho";
const SIGNER_VAZIO: Signer = { name: "", email: "", document: "", phone: "" };
const rascunhoVazio = (): Rascunho => ({
  title: "", modeloId: "", contentHtml: "", contentDirty: false, planStart: "", planEnd: "", vars: {}, signers: [{ ...SIGNER_VAZIO }],
});

/** Rascunho "vazio" (só abriu o formulário sem digitar nada) não é digno de
 * ser salvo nem restaurado — evita reabrir sozinho pra sempre um "Novo
 * contrato" clicado sem querer. */
function temConteudo(r: Rascunho): boolean {
  return !!(
    r.title.trim() || r.modeloId || r.contentHtml.trim() ||
    Object.values(r.vars).some((v) => v.trim()) ||
    r.signers.some((s) => s.name.trim() || s.email.trim())
  );
}

const TIPOS_CAMPO = [
  { value: "text", label: "Texto" },
  { value: "date", label: "Data" },
  { value: "email", label: "E-mail" },
  { value: "tel", label: "Telefone" },
  { value: "number", label: "Número" },
  { value: "currency", label: "Valor (R$)" },
];

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
  const [rascunho, setRascunho] = useState<Rascunho>(rascunhoVazio);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [camposNovoModelo, setCamposNovoModelo] = useState<CampoNovo[]>([]);
  /** Contrato existente sendo editado (null = criando um novo). */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState<string | null>(null);
  /** "Ler antes de enviar" — funciona pra qualquer contrato, criando ou já salvo. */
  const [viewing, setViewing] = useState<{ title: string; html: string } | null>(null);

  // Restaura o rascunho salvo (se existir) assim que a tela abre — antes
  // disso o usuário via a lista, não o formulário, mesmo com um rascunho
  // esperando. Só pra criação nova (edição de contrato existente não usa
  // localStorage — os dados já estão salvos no próprio contrato).
  //
  // ARMADILHA REAL (Luana, 19/08): clicou em "Novo contrato" sem querer, e a
  // tela travou nisso — saiu e voltou várias vezes, fechou tudo, nada
  // adiantava. Causa: QUALQUER abertura do formulário, mesmo vazia, já
  // salvava um rascunho; e todo recarregamento/retorno reabria esse rascunho
  // salvo automaticamente. Só tinha uma saída (o botão "Cancelar"), e sem
  // achar ele a pessoa ficava presa pra sempre, mesmo sem ter digitado nada.
  // Agora só salva/restaura rascunho com conteúdo de verdade — abrir por
  // engano e não digitar nada não prende ninguém.
  useEffect(() => {
    try {
      const salvo = localStorage.getItem(RASCUNHO_KEY);
      if (!salvo) return;
      const r = JSON.parse(salvo) as Rascunho;
      if (!temConteudo(r)) { localStorage.removeItem(RASCUNHO_KEY); return; }
      setRascunho({ ...r, contentDirty: r.contentDirty ?? false });
      setCreating(true);
    } catch {
      /* rascunho corrompido — ignora e segue com um em branco */
    }
  }, []);

  // Salva a cada mudança, só enquanto o formulário está aberto E é criação
  // nova (rascunho de edição de contrato existente não precisa disto — já
  // está seguro no banco assim que ela salva). Só grava se tiver conteúdo de
  // verdade — ver comentário acima.
  useEffect(() => {
    if (!creating || editingId) return;
    try {
      if (temConteudo(rascunho)) localStorage.setItem(RASCUNHO_KEY, JSON.stringify(rascunho));
      else localStorage.removeItem(RASCUNHO_KEY);
    } catch {
      /* localStorage cheio/bloqueado — pior caso é voltar ao comportamento antigo */
    }
  }, [rascunho, creating, editingId]);

  function limparRascunho() {
    localStorage.removeItem(RASCUNHO_KEY);
    setRascunho(rascunhoVazio());
    setCreating(false);
    setEditingId(null);
    setError("");
  }

  /** Abre um rascunho já existente pra edição — mesma regra do Chatwoot: só dá pra editar enquanto está em rascunho. */
  async function abrirEdicao(id: string) {
    setLoadingEdit(id);
    setError("");
    try {
      const c = await getContractForEdit(id);
      setRascunho({
        title: c.title,
        modeloId: c.template_id ?? "",
        contentHtml: c.content_html ?? "",
        contentDirty: true, // já é conteúdo salvo/gerado antes — não regenerar por cima
        planStart: c.plan_start_date ?? "",
        planEnd: c.plan_end_date ?? "",
        vars: (c.variables as Record<string, string>) ?? {},
        signers: (c.contract_signers ?? []).map((s) => ({
          name: s.name, email: s.email, document: s.document ?? "", phone: s.phone ?? "",
        })) || [{ ...SIGNER_VAZIO }],
      });
      setEditingId(id);
      setCreating(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível abrir este contrato para edição.");
    } finally {
      setLoadingEdit(null);
    }
  }

  const modeloId = rascunho.modeloId;
  const signers = rascunho.signers;
  const setSigners = (fn: (s: Signer[]) => Signer[]) => setRascunho((r) => ({ ...r, signers: fn(r.signers) }));

  const visible = useMemo(
    () => (filter === "all" ? contracts : contracts.filter((c) => c.status === filter)),
    [contracts, filter],
  );

  /** Campos que o modelo escolhido pede — mudam quando troca o modelo. */
  const campos = useMemo(
    () => templates.find((t) => t.id === modeloId)?.variable_fields ?? [],
    [templates, modeloId],
  );

  /** Texto bruto do modelo escolhido (com os {{marcadores}} ainda por preencher). */
  const templateRaw = useMemo(
    () => templates.find((t) => t.id === modeloId)?.content_html ?? "",
    [templates, modeloId],
  );

  /**
   * Texto mostrado no editor: enquanto ninguém mexeu nele à mão, é gerado ao
   * vivo a partir do modelo + variáveis (some o marcador, entra o valor). No
   * instante em que a pessoa edita direto no editor, isto para de recalcular
   * — o texto dela é que manda, mesmo que ela volte e mude uma variável.
   */
  const previewHtml = rascunho.contentDirty || !modeloId
    ? rascunho.contentHtml
    : renderTemplate(templateRaw, rascunho.vars);

  /**
   * Achar automaticamente qual variável do modelo é "o nome de quem assina"
   * (e o e-mail, se tiver) pra oferecer o botão "usar como signatário" —
   * equivalente ao que o Chatwoot fazia com o campo fixo de contratante,
   * adaptado pro esquema de variáveis livres daqui. Olha o RÓTULO do campo,
   * não a chave, porque quem cria o modelo escreve o rótulo em português.
   */
  const nomeVar = campos.find((c) => /nome/i.test(c.label));
  const emailVar = campos.find((c) => /e-?mail/i.test(c.label));
  const nomeContratante = nomeVar ? (rascunho.vars[nomeVar.key] ?? "").trim() : "";
  const emailContratante = emailVar ? (rascunho.vars[emailVar.key] ?? "").trim() : "";

  function usarContratanteComoSignatario() {
    if (!nomeContratante) return;
    setSigners((s) => {
      // Se a primeira linha estiver vazia, preenche ali; senão acrescenta uma nova.
      if (s.length && !s[0].name && !s[0].email) {
        return [{ ...s[0], name: nomeContratante, email: emailContratante }, ...s.slice(1)];
      }
      return [{ name: nomeContratante, email: emailContratante, document: "", phone: "" }, ...s];
    });
  }

  function trocarModelo(id: string) {
    setRascunho((r) => ({ ...r, modeloId: id, contentDirty: false }));
  }

  async function onSubmit(fd: FormData) {
    setError("");
    fd.set("content_html", previewHtml);
    signers.forEach((s) => {
      if (s.name.trim() && s.email.trim()) {
        fd.append("signer_name", s.name);
        fd.append("signer_email", s.email);
        fd.append("signer_document", s.document);
        fd.append("signer_phone", s.phone);
      }
    });
    try {
      if (editingId) {
        await updateContract(editingId, fd);
      } else {
        await createContract(fd);
      }
      limparRascunho();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar o contrato.");
    }
  }

  if (creating) {
    return (
      <>
      {/* Sempre visível, mesmo rolando o formulário inteiro — a saída óbvia
          que faltava. A Luana ficou presa nesta tela: abriu "Novo contrato"
          sem querer, e nem recarregar a página nem fechar a aba adiantava
          (o rascunho ficava salvo e reabria sozinho). "Cancelar" lá embaixo
          exigia rolar até o fim pra achar. */}
      <div className="sticky top-0 z-10 -mx-4 mb-2 flex items-center gap-2 border-b border-border bg-canvas/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6">
        <button
          type="button"
          onClick={limparRascunho}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-soft hover:bg-gray-100 hover:text-ink"
        >
          ← Voltar para a lista de contratos
        </button>
      </div>
      <form action={(fd) => startTransition(() => void onSubmit(fd))} className="max-w-2xl space-y-5">
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">{editingId ? "Editar rascunho" : "Contrato"}</h3>
            {editingId && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-ink-soft">Rascunho — ainda não enviado</span>}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Título</label>
            <input name="title" placeholder="Ex.: Contrato de prestação de serviços" value={rascunho.title}
              onChange={(e) => setRascunho((r) => ({ ...r, title: e.target.value }))}
              className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Modelo</label>
            <select
              name="template_id"
              value={modeloId}
              onChange={(e) => trocarModelo(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm"
            >
              <option value="">Sem modelo (escrever no editor abaixo)</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">Início do plano</label>
              <input name="plan_start_date" type="date" value={rascunho.planStart}
                onChange={(e) => setRascunho((r) => ({ ...r, planStart: e.target.value }))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-soft">Fim do plano</label>
              <input name="plan_end_date" type="date" value={rascunho.planEnd}
                onChange={(e) => setRascunho((r) => ({ ...r, planEnd: e.target.value }))}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
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
                {rascunho.contentDirty && " Como o texto abaixo já foi editado à mão, mudar um campo aqui não altera mais o texto sozinho."}
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
                    value={rascunho.vars[c.key] ?? ""}
                    onChange={(e) => setRascunho((r) => ({ ...r, vars: { ...r.vars, [c.key]: e.target.value } }))}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Texto do contrato — o lugar que faltava pra acrescentar pontos que
            o modelo não previu, revisar e formatar antes de enviar. */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-ink">Texto do contrato</h3>
              <p className="text-xs text-ink-soft">Edite livremente — negrito, listas, links, o que precisar.</p>
            </div>
            {rascunho.contentDirty && modeloId && (
              <Button type="button" variant="ghost"
                onClick={() => setRascunho((r) => ({ ...r, contentDirty: false }))}>
                Recarregar do modelo
              </Button>
            )}
          </div>
          <ContractEditor
            value={previewHtml}
            onChange={(html) => setRascunho((r) => ({ ...r, contentHtml: html, contentDirty: true }))}
          />
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Signatários</h3>
            <Button type="button" variant="ghost"
              onClick={() => setSigners((s) => [...s, { ...SIGNER_VAZIO }])}>
              + Adicionar
            </Button>
          </div>
          <p className="text-xs text-ink-soft">
            O link de assinatura vai por e-mail sempre, e por WhatsApp também se o telefone for preenchido.
          </p>
          {/* Em vez de redigitar o nome de quem já preencheu lá em cima, um clique
              usa o que já foi informado como dados do contrato. */}
          {nomeContratante && (
            <button type="button" onClick={usarContratanteComoSignatario}
              className="w-fit rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-medium text-ink-soft hover:border-brand hover:text-brand">
              + Usar &ldquo;{nomeContratante}&rdquo; como signatário
            </button>
          )}
          {signers.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                <input placeholder="Nome" value={s.name}
                  onChange={(e) => setSigners((arr) => arr.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
                <input placeholder="E-mail" type="email" value={s.email}
                  onChange={(e) => setSigners((arr) => arr.map((x, idx) => idx === i ? { ...x, email: e.target.value } : x))}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
                <input placeholder="WhatsApp (opcional)" type="tel" value={s.phone}
                  onChange={(e) => setSigners((arr) => arr.map((x, idx) => idx === i ? { ...x, phone: e.target.value } : x))}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
                <input placeholder="CPF (opcional)" value={s.document}
                  onChange={(e) => setSigners((arr) => arr.map((x, idx) => idx === i ? { ...x, document: e.target.value } : x))}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
              </div>
              {signers.length > 1 && (
                <button type="button" onClick={() => setSigners((arr) => arr.filter((_, idx) => idx !== i))}
                  className="px-1.5 text-ink-soft hover:text-red-600" aria-label="Remover signatário">✕</button>
              )}
            </div>
          ))}
        </Card>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setViewing({ title: rascunho.title || "Contrato", html: previewHtml })}>
            Ler antes de {editingId ? "salvar" : "criar"}
          </Button>
          <Button type="button" variant="ghost" onClick={limparRascunho}>Cancelar</Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando..." : editingId ? "Salvar alterações" : "Criar contrato"}
          </Button>
        </div>
      </form>
      {viewing && <VisualizarModal title={viewing.title} html={viewing.html} onClose={() => setViewing(null)} />}
      </>
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
            <form
              action={(fd) => {
                fd.set("variable_fields", JSON.stringify(camposNovoModelo.filter((c) => c.key.trim())));
                startTransition(() => void createTemplate(fd));
                setCamposNovoModelo([]);
              }}
              className="space-y-2"
            >
              <input name="name" placeholder="Nome do modelo"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
              <textarea name="content_html" rows={5}
                placeholder="<p>Olá {{nome_aluno}}, ...</p>  — use {{variavel}} para campos dinâmicos"
                className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs" />

              {/* Cada {{variavel}} usada no texto acima precisa de um campo aqui,
                  senão ninguém consegue preencher e o contrato sai com espaço em
                  branco no lugar do marcador. */}
              <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-ink">Campos que este modelo pede ao criar um contrato</p>
                  <Button type="button" variant="ghost"
                    onClick={() => setCamposNovoModelo((c) => [...c, { key: "", label: "", type: "text" }])}>
                    + Campo
                  </Button>
                </div>
                {camposNovoModelo.length === 0 && (
                  <p className="text-xs text-ink-soft">
                    Nenhum campo ainda — se o texto tem {"{{variavel}}"}, adicione um campo com essa mesma chave.
                    Chame o campo do nome de quem assina com a palavra &ldquo;Nome&rdquo; no rótulo (ex.: &ldquo;Nome do aluno&rdquo;) pra liberar o atalho de usar como signatário.
                  </p>
                )}
                {camposNovoModelo.map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                    <input placeholder="chave (ex.: nome_aluno)" value={c.key}
                      onChange={(e) => setCamposNovoModelo((arr) => arr.map((x, idx) => idx === i ? { ...x, key: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") } : x))}
                      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 font-mono text-xs" />
                    <input placeholder="rótulo (ex.: Nome do aluno)" value={c.label}
                      onChange={(e) => setCamposNovoModelo((arr) => arr.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))}
                      className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs" />
                    <select value={c.type}
                      onChange={(e) => setCamposNovoModelo((arr) => arr.map((x, idx) => idx === i ? { ...x, type: e.target.value } : x))}
                      className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs">
                      {TIPOS_CAMPO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <button type="button" onClick={() => setCamposNovoModelo((arr) => arr.filter((_, idx) => idx !== i))}
                      className="px-1.5 text-xs text-ink-soft hover:text-red-600">✕</button>
                  </div>
                ))}
              </div>

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

          {error && <p className="text-sm text-red-600">{error}</p>}
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
                      {c.status === "draft" && (
                        <Button variant="ghost" disabled={loadingEdit === c.id} onClick={() => abrirEdicao(c.id)}>
                          {loadingEdit === c.id ? "Abrindo..." : "Editar"}
                        </Button>
                      )}
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

/** Ler o contrato (texto formatado) sem sair da tela — qualquer status, a qualquer momento. */
function VisualizarModal({ title, html, onClose }: { title: string; html: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-ink-soft hover:bg-gray-100" aria-label="Fechar">✕</button>
        </div>
        <div className="contract-doc overflow-y-auto bg-white p-8" dangerouslySetInnerHTML={{ __html: html || "<p>Nada pra mostrar ainda.</p>" }} />
      </div>
    </div>
  );
}
