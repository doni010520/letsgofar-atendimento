"use client";

import { useMemo, useState } from "react";
import { Search, Users, BellOff, BotOff, Bot, SlidersHorizontal, X, Trash2, Check, PenSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationOverview, ConversationStatus, Department, Profile } from "@/lib/types";
import { closeConversationsBulk } from "@/app/(app)/atendimento/actions";

/* ─── Abas principais (topo) ──────────────────────────────────────────
 * Substitui o antigo cruzamento "de quem é" (Minhas/Sem responsável/Todas)
 * × "status" (Em espera/Em andamento/Encerrados) — 12 combinações possíveis
 * e ninguém sabia onde olhar. Volta ao modelo do Chatwoot que a equipe já
 * conhecia: Minhas / Em andamento / Encerradas, só isso. "Sem responsável"
 * deixa de ser uma aba — com o roteamento automático fechando o buraco, isso
 * devia ser raro, e quando acontece aparece como etiqueta discreta dentro do
 * próprio departamento (ver renderização da linha), não como categoria à
 * parte pra ninguém checar. */
type MainTab = "minhas" | "andamento" | "encerradas";
const MAIN_TABS: { key: MainTab; label: string }[] = [
  { key: "minhas", label: "Minhas" },
  { key: "andamento", label: "Em andamento" },
  { key: "encerradas", label: "Encerradas" },
];

/** Formata hora de forma determinística (sem toLocaleTimeString que causa hydration mismatch). */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const STATUS_DOT: Record<ConversationStatus, string> = {
  bot: "bg-violet-500",
  queued: "bg-amber-500",
  open: "bg-green-500",
  closed: "bg-gray-400",
};

/* ─── Período: Todas / Hoje / Ontem / Não lidas ─── */
type PeriodKey = "all" | "today" | "yesterday" | "unread";
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "unread", label: "Não lidas" },
];

function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

/* ─── Componente auxiliar: multi-select dropdown inline ─── */
function MultiSelect({
  label,
  placeholder,
  options,
  selected,
  onChange,
}: {
  label: string;
  placeholder: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-sm text-ink-soft hover:border-gray-300"
      >
        <span className="truncate">
          {selected.length === 0
            ? placeholder
            : `${selected.length} selecionado${selected.length > 1 ? "s" : ""}`}
        </span>
        <SlidersHorizontal size={14} className="shrink-0" />
      </button>
      {open && (
        <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-white shadow-lg">
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs text-ink-soft">Nenhuma opção.</p>
          )}
          {options.map((o) => {
            const checked = selected.includes(o.value);
            return (
              <button
                key={o.value}
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    checked ? "border-brand bg-brand text-white" : "border-gray-300",
                  )}
                >
                  {checked && <Check size={10} />}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Componente principal ─── */
export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onPauseAi,
  onNewConversation,
  onBulkClosed,
  userId = null,
  isAdmin = false,
  departments = [],
  agents = [],
}: {
  conversations: ConversationOverview[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPauseAi?: (id: string) => void;
  onNewConversation?: () => void;
  /** Avisa a caixa para recarregar depois de um encerramento em lote. */
  onBulkClosed?: (ids: string[]) => void;
  userId?: string | null;
  /** Só o admin vê os filtros de departamento/atendente — pra equipe, o time inteiro já é "Em andamento". */
  isAdmin?: boolean;
  departments?: Department[];
  /** Lista de atendentes pra admin filtrar por dono do atendimento (pedido da Ianka: "eu como admin conseguir filtrar por atendente"). */
  agents?: Profile[];
}) {
  const [tab, setTab] = useState<MainTab>("minhas");
  /** Filtro de departamento (só admin) — "" = todos. */
  const [dept, setDept] = useState<string>("");
  /** Filtro de atendente (só admin) — "" = todos. Combina em AND com o de departamento. */
  const [agentId, setAgentId] = useState<string>("");
  /**
   * Modo seleção: marcar várias conversas e encerrar de uma vez.
   *
   * A Luana tem 525 atendimentos abertos e fechar um a um, com o formulário de
   * resumo em cada, é meio dia de trabalho. Encerrar não avisa o cliente.
   */
  const [selecionando, setSelecionando] = useState(false);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [encerrando, setEncerrando] = useState(false);
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  // Filtros do modal (estado aplicado)
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [channelIds, setChannelIds] = useState<string[]>([]);

  // Filtros pendentes (dentro do modal, antes de "Aplicar")
  const [draftPeriod, setDraftPeriod] = useState<PeriodKey>("all");
  const [draftChannels, setDraftChannels] = useState<string[]>([]);

  const hasActiveFilters = period !== "all" || channelIds.length > 0;

  // Extrair opções únicas de canal
  const channelOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of conversations) {
      if (c.channel_id && c.channel_name) map.set(c.channel_id, c.channel_name);
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [conversations]);

  // Filtragem
  const filtered = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const yesterdayStart = startOfDay(new Date(now.getTime() - 86400000));
    return conversations.filter((c) => {
      // Aba principal
      if (tab === "encerradas" && c.status !== "closed") return false;
      if (tab !== "encerradas" && c.status === "closed") return false;
      // BUSCA IGNORA A ABA. "Pesquisei e não encontrei" foi exatamente o que
      // aconteceu com a Luana: a conversa existia noutra aba e a busca só
      // olhava dentro da atual. Quem digita um nome quer achar a pessoa.
      if (!query) {
        if (tab === "minhas" && userId && c.assigned_user_id !== userId) return false;
      }
      // Departamento (só admin filtra por aqui)
      if (isAdmin && dept && c.department_id !== dept) return false;
      // Atendente (só admin) — combina em AND com o departamento, pra achar
      // ex. "só o que é da Luana dentro do Comercial".
      if (isAdmin && agentId && c.assigned_user_id !== agentId) return false;
      // Busca textual
      if (query) {
        const q = query.toLowerCase();
        if (
          !(c.contact_name ?? "").toLowerCase().includes(q) &&
          !c.contact_phone.includes(q) &&
          !(c.channel_name ?? "").toLowerCase().includes(q)
        )
          return false;
      }
      // Período
      if (period === "unread") {
        if ((c.unread_count ?? 0) === 0) return false;
      } else if (period === "today" || period === "yesterday") {
        const ts = c.last_message_at ? new Date(c.last_message_at) : null;
        if (!ts) return false;
        if (period === "today" && ts < todayStart) return false;
        if (period === "yesterday" && (ts < yesterdayStart || ts >= todayStart)) return false;
      }
      // Canal
      if (channelIds.length > 0 && !channelIds.includes(c.channel_id)) return false;
      return true;
    });
  }, [conversations, tab, userId, isAdmin, dept, agentId, query, period, channelIds]);

  // Contagens das 3 abas, respeitando os filtros de departamento e atendente
  // do admin — é o que diz de cara se vale a pena olhar cada uma antes de clicar.
  const contagem = useMemo(() => {
    const base = isAdmin
      ? conversations.filter(
          (c) => (!dept || c.department_id === dept) && (!agentId || c.assigned_user_id === agentId),
        )
      : conversations;
    return {
      minhas: userId ? base.filter((c) => c.status !== "closed" && c.assigned_user_id === userId).length : 0,
      andamento: base.filter((c) => c.status !== "closed").length,
      encerradas: base.filter((c) => c.status === "closed").length,
    };
  }, [conversations, isAdmin, dept, agentId, userId]);

  function alternarMarca(id: string) {
    setMarcadas((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  /** Encerra o que estiver marcado. Nada disso chega ao cliente. */
  async function encerrarSelecionadas() {
    const ids = [...marcadas];
    if (!ids.length) return;
    // Confirmação explícita: é uma ação em massa e o número importa.
    if (!confirm(`Encerrar ${ids.length} atendimento(s)? O cliente NÃO recebe nenhuma mensagem.`)) return;
    setEncerrando(true);
    try {
      const r = await closeConversationsBulk(ids);
      if (r.ok) {
        onBulkClosed?.(ids.slice(0, r.total === ids.length ? ids.length : ids.length));
        setMarcadas(new Set());
        setSelecionando(false);
      } else {
        alert(r.error ?? "Não foi possível encerrar.");
      }
    } catch {
      alert("Não foi possível encerrar. Tente de novo.");
    } finally {
      setEncerrando(false);
    }
  }

  function openModal() {
    setDraftPeriod(period);
    setDraftChannels([...channelIds]);
    setModalOpen(true);
  }
  function applyFilters() {
    setPeriod(draftPeriod);
    setChannelIds(draftChannels);
    setModalOpen(false);
  }
  function clearFilters() {
    setDraftPeriod("all");
    setDraftChannels([]);
  }

  return (
    <div className="flex h-full w-full shrink-0 flex-col border-r border-border bg-surface md:w-80">
      {/* ─── Header: busca + abas + filtro ─── */}
      <div className="border-b border-border p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar conversa..."
              className="w-full rounded-lg border border-border py-2 pl-9 pr-3 text-sm outline-none focus:border-brand"
            />
          </div>
          {onNewConversation && (
            <button
              onClick={onNewConversation}
              title="Novo atendimento"
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-brand text-white transition hover:bg-brand-dark"
            >
              <PenSquare size={16} />
            </button>
          )}
        </div>

        {/* Minhas / Em andamento / Encerradas — as três únicas abas. */}
        <div className="mt-2 flex items-center gap-1">
          <div className="flex flex-1 gap-1">
            {MAIN_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-medium transition",
                  tab === t.key
                    ? "bg-brand text-white"
                    : "text-ink-soft hover:bg-gray-100",
                )}
              >
                {t.label}
                <span className={cn("ml-1 tabular-nums", tab === t.key ? "opacity-70" : "opacity-50")}>
                  {contagem[t.key]}
                </span>
              </button>
            ))}
          </div>
          <button
            onClick={openModal}
            title="Filtros avançados"
            className={cn(
              "relative shrink-0 rounded-lg p-1.5 transition",
              hasActiveFilters
                ? "bg-brand text-white hover:bg-brand/90"
                : "text-ink-soft hover:bg-gray-100",
            )}
          >
            <SlidersHorizontal size={16} />
            {hasActiveFilters && (
              <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[8px] font-bold text-white">
                !
              </span>
            )}
          </button>
        </div>

        {/* Departamento — só o admin vê. É a visão de dono de negócio, pra
            checar a fila de uma equipe específica sem se misturar no "Minhas"
            de ninguém. */}
        {isAdmin && departments.length > 0 && (
          <div className="mt-2 flex gap-1 overflow-x-auto">
            <button
              onClick={() => setDept("")}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                dept === "" ? "bg-brand/10 text-brand ring-1 ring-brand/30" : "bg-gray-100 text-ink-soft hover:bg-gray-200",
              )}
            >
              Todos
            </button>
            {departments.map((d) => (
              <button
                key={d.id}
                onClick={() => setDept(d.id)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                  dept === d.id ? "bg-brand/10 text-brand ring-1 ring-brand/30" : "bg-gray-100 text-ink-soft hover:bg-gray-200",
                )}
              >
                {d.name}
              </button>
            ))}
          </div>
        )}

        {/* Atendente — mesma ideia do chip de departamento, mas pra achar
            direto os atendimentos de uma pessoa específica (ex.: a Ianka quer
            ver o que é da Luana sem misturar com o que é dela mesma). Combina
            em AND com o departamento acima. */}
        {isAdmin && agents.length > 0 && (
          <div className="mt-2 flex gap-1 overflow-x-auto">
            <button
              onClick={() => setAgentId("")}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                agentId === "" ? "bg-brand/10 text-brand ring-1 ring-brand/30" : "bg-gray-100 text-ink-soft hover:bg-gray-200",
              )}
            >
              Todo mundo
            </button>
            {agents.map((a) => (
              <button
                key={a.id}
                onClick={() => setAgentId(a.id)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                  agentId === a.id ? "bg-brand/10 text-brand ring-1 ring-brand/30" : "bg-gray-100 text-ink-soft hover:bg-gray-200",
                )}
              >
                {a.name.split(" ")[0]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ─── Encerrar em lote ─── */}
      {selecionando ? (
        <div className="flex items-center gap-2 border-b border-border bg-amber-50 px-3 py-2">
          <span className="text-xs font-medium text-amber-900">
            {marcadas.size} selecionada{marcadas.size === 1 ? "" : "s"}
          </span>
          <button
            onClick={() => setMarcadas(new Set(filtered.map((c) => c.id)))}
            className="rounded-lg border border-amber-300 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
          >
            Marcar as {filtered.length} da lista
          </button>
          <button
            onClick={encerrarSelecionadas}
            disabled={!marcadas.size || encerrando}
            className="ml-auto rounded-lg bg-danger px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
          >
            {encerrando ? "Encerrando..." : `Encerrar (${marcadas.size})`}
          </button>
          <button
            onClick={() => { setSelecionando(false); setMarcadas(new Set()); }}
            className="rounded-lg px-2 py-1 text-[11px] font-medium text-ink-soft hover:bg-amber-100"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          onClick={() => setSelecionando(true)}
          className="border-b border-border px-3 py-1.5 text-left text-[11px] font-medium text-ink-soft hover:bg-gray-50"
        >
          Selecionar várias para encerrar
        </button>
      )}

      {/* ─── Lista de conversas ─── */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="p-6 text-center text-xs text-ink-soft">Nenhuma conversa.</p>
        )}
        {filtered.map((c) => {
          const isGroup = !!c.is_group;
          const title = c.contact_name ?? (isGroup ? "Grupo" : c.contact_phone);
          const initials = title
            .split(" ")
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase())
            .join("");
          const time = c.last_message_at ? fmtTime(c.last_message_at) : "";
          const mediaLabel: Record<string, string> = {
            image: "📷 Foto",
            video: "🎥 Vídeo",
            audio: "🎵 Áudio",
            document: "📄 Documento",
            sticker: "🏷️ Figurinha",
            location: "📍 Localização",
            contact: "👤 Contato",
            template: "📋 Template",
          };
          const bodyOrMedia =
            c.last_message_body ||
            (c.last_message_type
              ? mediaLabel[c.last_message_type] ?? `[${c.last_message_type}]`
              : "—");
          const preview =
            isGroup && c.last_message_author && c.last_message_direction === "in"
              ? `${c.last_message_author.split(" ")[0]}: ${bodyOrMedia}`
              : bodyOrMedia;
          const unread = (c.unread_count ?? 0) > 0;
          const aiActive = c.status === "bot" && c.ai_enabled !== false;
          // Transferida há pouco e ninguém abriu ainda — destaca pra quem
          // recebeu não perder, já que o "lido" sozinho não avisava nada.
          const transferida = !!c.transferred_at;
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => (selecionando ? alternarMarca(c.id) : onSelect(c.id))}
              onKeyDown={(e) =>
                (e.key === "Enter" || e.key === " ") &&
                (selecionando ? alternarMarca(c.id) : onSelect(c.id))
              }
              className={cn(
                "group flex w-full cursor-pointer items-center gap-3 border-b border-border px-3 py-3 text-left transition hover:bg-gray-50",
                selectedId === c.id && "bg-brand-light hover:bg-brand-light",
                transferida && selectedId !== c.id && "bg-amber-50 hover:bg-amber-100",
              )}
            >
              {selecionando && (
                <input
                  type="checkbox"
                  checked={marcadas.has(c.id)}
                  onChange={() => alternarMarca(c.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-5 w-5 shrink-0 rounded border-border"
                  aria-label={`Selecionar conversa com ${title}`}
                />
              )}
              <div className="relative h-10 w-10 shrink-0">
                {c.contact_avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.contact_avatar}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold",
                      isGroup
                        ? "bg-brand-light text-brand"
                        : "bg-gray-200 text-gray-600",
                    )}
                  >
                    {isGroup ? <Users size={18} /> : initials || "?"}
                  </div>
                )}
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white",
                    STATUS_DOT[c.status],
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      "flex min-w-0 items-center gap-1 truncate text-sm",
                      unread ? "font-bold text-ink" : "font-medium text-ink",
                    )}
                  >
                    <span className="truncate">{title}</span>
                    {aiActive && (
                      <Bot
                        size={12}
                        className="shrink-0 text-violet-500"
                        aria-label="Atendida pela IA"
                      />
                    )}
                    {c.is_muted && (
                      <BellOff size={12} className="shrink-0 text-ink-soft" />
                    )}
                  </p>
                  <div className="flex shrink-0 items-center gap-1">
                    {aiActive && onPauseAi && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onPauseAi(c.id);
                        }}
                        title="Pausar IA e atribuir a mim"
                        className="rounded p-0.5 text-ink-soft opacity-0 transition hover:bg-violet-100 hover:text-violet-700 group-hover:opacity-100"
                      >
                        <BotOff size={14} />
                      </button>
                    )}
                    <span
                      className={cn(
                        "text-[10px]",
                        unread
                          ? "font-semibold text-green-600"
                          : "text-ink-soft",
                      )}
                    >
                      {time}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <p
                    className={cn(
                      "min-w-0 flex-1 truncate text-xs",
                      unread ? "font-semibold text-ink" : "text-ink-soft",
                    )}
                  >
                    {preview}
                  </p>
                  {unread && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-green-500 px-1 text-[10px] font-bold text-white">
                      {c.unread_count! > 99 ? "99+" : c.unread_count}
                    </span>
                  )}
                </div>
                {/* Dono e departamento sempre visíveis — sem isto ninguém sabia
                    com quem tava a conversa sem abrir uma por uma. */}
                <div className="mt-0.5 flex items-center gap-1 overflow-hidden">
                  {transferida && (
                    <span className="shrink-0 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-amber-950">
                      transferida agora
                    </span>
                  )}
                  {c.assigned_name ? (
                    tab !== "minhas" && (
                      <span className="shrink-0 truncate rounded-full bg-brand-light px-1.5 py-0.5 text-[9px] font-medium text-brand">
                        com {c.assigned_name.split(" ")[0]}
                      </span>
                    )
                  ) : c.status !== "closed" ? (
                    <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-ink-soft">
                      sem atendente
                    </span>
                  ) : null}
                  {c.department_name && (
                    <span className="shrink-0 truncate text-[9px] text-ink-soft/70">
                      {c.department_name}
                    </span>
                  )}
                  <span className="truncate text-[9px] text-ink-soft/50">
                    {c.department_name ? "· " : ""}{c.channel_name}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Modal de filtros avançados ─── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={(e) => e.target === e.currentTarget && setModalOpen(false)}
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-ink">Filtrar atendimentos</h3>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-ink-soft hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            {/* Período */}
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-ink">
                Conversas
              </label>
              <p className="mb-2 text-xs text-ink-soft">
                Por período (última mensagem) ou não lidas
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PERIODS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setDraftPeriod(p.key)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition",
                      draftPeriod === p.key
                        ? "bg-brand text-white"
                        : "bg-gray-100 text-ink-soft hover:bg-gray-200",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Canais */}
            <div className="mb-6">
              <MultiSelect
                label="Canais"
                placeholder="Filtre por canais"
                options={channelOptions}
                selected={draftChannels}
                onChange={setDraftChannels}
              />
            </div>

            {/* Ações */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => setModalOpen(false)}
                className="text-sm text-ink-soft hover:text-ink"
              >
                Cancelar
              </button>
              <div className="flex gap-2">
                <button
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-gray-50"
                >
                  <Trash2 size={12} /> Limpar filtros
                </button>
                <button
                  onClick={applyFilters}
                  className="inline-flex items-center gap-1 rounded-lg bg-brand px-4 py-1.5 text-xs font-medium text-white hover:bg-brand/90"
                >
                  <SlidersHorizontal size={12} /> Aplicar filtros
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
