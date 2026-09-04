"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { ConversationList } from "./conversation-list";
import { ChatThread } from "./chat-thread";
import { ContactPanel } from "./contact-panel";
import { createClient } from "@/lib/supabase/client";
import { JANELA_MENSAGENS } from "@/lib/inbox-config";

/**
 * Teto de espera para uma Server Action, do lado do NAVEGADOR.
 *
 * A trava de ontem era o SERVIDOR esperando a uazapi para sempre — corrigida
 * com timeout lá. Esta é uma camada diferente: o CELULAR esperando o
 * SERVIDOR para sempre, numa rede 4G que engasgou no meio do caminho. Nesse
 * caso a mensagem nem chega a ser registrada (a linha "pending" que o
 * servidor cria antes de tudo nunca existiu) — a conexão morreu antes da
 * ida e volta terminar, e nada do lado do servidor resolve isso.
 *
 * Não cancela a chamada de verdade (ela pode até completar depois, em
 * segundo plano) — só impede que a TELA fique presa esperando para sempre.
 */
function comTeto<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("SEM_RESPOSTA")), ms);
    promessa.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Mesma ideia do `comTeto` acima, mas para o `startTransition` inteiro — não
 * só o envio de mensagem. O botão de enviar mostra o MESMO `isPending`
 * (compartilhado, único `useTransition` do componente) que qualquer outra
 * ação: atribuir, transferir, reagir, editar, encerrar, enviar modelo etc.
 * Sem este teto aqui também, uma dessas ações travando numa rede ruim
 * prendia o `isPending` pra sempre — e o usuário via isso como "o botão de
 * enviar girando eternamente", mesmo sem ter apertado enviar.
 */
function startTransitionComTeto(startTransition: (fn: () => void | Promise<void>) => void, fn: () => Promise<void>, ms = 35000) {
  startTransition(async () => {
    try {
      await comTeto(fn(), ms);
    } catch (e) {
      if (e instanceof Error && e.message === "SEM_RESPOSTA") {
        toast("Sem resposta do servidor — confira antes de tentar de novo.", "error");
      }
    }
  });
}

/**
 * Une o que já está na tela com o lote que chegou do servidor, sem encolher.
 *
 * A caixa carrega só as 60 mensagens mais recentes; quem clica em "carregar
 * mais" fica com 120, 180... Se o tique de reconciliação simplesmente trocasse
 * a lista pelo que voltou, o histórico que a pessoa acabou de abrir sumiria
 * embaixo dela e o scroll saltaria. Então: união por id, com o lote novo
 * vencendo nos campos (é ele que traz status/edição/reação atualizados).
 *
 * Exclusão é lógica (`is_deleted`), não sumiço de linha — por isso a união
 * nunca deixa passar mensagem apagada como se ainda existisse.
 */
function mergeMessages(atuais: Message[], lote: Message[]): Message[] {
  if (!atuais.length) return lote;
  const porId = new Map(atuais.map((m) => [m.id, m]));
  for (const m of lote) {
    const anterior = porId.get(m.id);
    // Mantém o MESMO objeto quando nada mudou. Sem isto, todo tique produziria
    // 60 objetos novos e o React re-renderizaria a conversa inteira à toa —
    // trocaria egress por trabalho de tela, que é o que a equipe sente.
    porId.set(m.id, anterior && JSON.stringify(anterior) === JSON.stringify(m) ? anterior : { ...anterior, ...m });
  }
  return [...porId.values()].sort((a, b) => {
    const d = Date.parse(a.created_at) - Date.parse(b.created_at);
    return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Toca um bip curto de notificação via Web Audio (sem precisar de arquivo). */
let audioCtx: AudioContext | null = null;
function playPing() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx ?? new Ctx();
    const ctx = audioCtx;
    const now = ctx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  } catch {
    /* silencioso */
  }
}
import {
  sendMessage,
  sendLocationMessage,
  sendContactMessage,
  reactToMessage,
  editMessageAction,
  deleteMessageAction,
  markConversationRead,
  assignToMe,
  addInternalNote,
  sendInternalMessage,
  markMentionsRead,
  closeConversation,
  transferConversation,
  toggleMute,
  setConversationAi,
  toggleIdentifyAgent,
  fetchMessages,
  fetchConversations,
  fetchChannelStatuses,
  openDirectConversation,
  resolveDirectContact,
  getGroupInfo,
  sendTemplateMessage,
} from "@/app/(app)/atendimento/actions";
import { CloseModal, TransferModal } from "./attendance-modals";
import { toast } from "@/components/toast";
import type { ConversationOverview, Message, Tag, Profile, Department, Channel } from "@/lib/types";

type TemplateOpt = { name: string; language: string; bodyText: string; varCount: number };

export function Inbox({
  initialConversations,
  initialSelectedId,
  initialMessages,
  userId,
  hideAi = false,
  isAdmin = false,
  identifyAgentEnabled: identifyAgentEnabledInitial = false,
  tags,
  agents,
  departments,
  channels,
  quickReplies,
  templates,
  live,
}: {
  initialConversations: ConversationOverview[];
  initialSelectedId: string | null;
  initialMessages: Message[];
  userId: string | null;
  hideAi?: boolean;
  isAdmin?: boolean;
  identifyAgentEnabled?: boolean;
  tags: Tag[];
  agents: Profile[];
  departments: Department[];
  channels?: Channel[];
  quickReplies?: { title: string; content: string; shortcut: string | null }[];
  templates?: TemplateOpt[];
  live: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState(initialConversations);
  /**
   * No CELULAR a caixa abre na LISTA, não dentro de uma conversa.
   *
   * O servidor escolhe a primeira conversa para já mostrar algo — o que faz
   * sentido no computador, onde lista e conversa aparecem lado a lado. No
   * telefone a lista some quando há conversa aberta, então a pessoa caía
   * dentro de um atendimento aleatório e precisava voltar para trabalhar.
   * Link direto (?c=...) continua abrindo a conversa pedida.
   */
  const [selectedId, setSelectedId] = useState(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      const pedida = new URLSearchParams(window.location.search).get("c");
      return pedida ?? null;
    }
    return initialSelectedId;
  });
  const [messagesByConv, setMessagesByConv] = useState<Record<string, Message[]>>(
    initialSelectedId ? { [initialSelectedId]: initialMessages } : {},
  );
  const [isPending, startTransition] = useTransition();
  // Vale pra organização inteira, não só a conversa aberta — por isso não vive
  // no objeto `conversation` como os outros toggles (mudo, IA etc.).
  const [identifyAgentEnabled, setIdentifyAgentEnabled] = useState(identifyAgentEnabledInitial);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Message | null>(null);
  // Conversa-rascunho transitória (ao clicar num participante): só persiste ao digitar/enviar.
  const [draft, setDraft] = useState<ConversationOverview | null>(null);
  const [draftRealId, setDraftRealId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [noting, setNoting] = useState(false);
  const [noteText, setNoteText] = useState("");
  // Modal "novo atendimento" (outbound).
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [ncChannel, setNcChannel] = useState("");
  const [ncPhone, setNcPhone] = useState("");
  const [ncName, setNcName] = useState("");
  const [groupParticipants, setGroupParticipants] = useState<{ name: string; phone: string }[]>([]);
  // Mensagem do grupo que será citada como quote na conversa privada (reply private).
  const [privateReplyMsg, setPrivateReplyMsg] = useState<Message | null>(null);
  // Status dos canais (para banner de desconectado).
  const [disconnectedChannels, setDisconnectedChannels] = useState<{ id: string; name: string }[]>([]);
  const DRAFT_ID = "__draft__";

  // Notificação sonora: guarda o timestamp da mensagem recebida mais recente já "ouvida".
  const maxInbound = (convs: ConversationOverview[]) =>
    convs.reduce((mx, c) => {
      if (c.last_message_direction === "in" && !c.is_muted && c.last_message_at) {
        const t = Date.parse(c.last_message_at);
        if (t > mx) return t;
      }
      return mx;
    }, 0);
  const lastPingRef = useRef<number>(maxInbound(initialConversations));

  // Espelho da lista para ler dentro de callbacks do realtime (que fecham sobre
  // o estado antigo). Usado só para saber se a conversa está silenciada antes
  // de tocar o aviso sonoro.
  const conversationsRef = useRef(conversations);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  // "Carregar mais" do histórico. `semMais` guarda as conversas que já chegaram
  // ao começo — o servidor devolveu menos que a janela, então não há mais nada
  // atrás e o botão some.
  const [loadingMore, setLoadingMore] = useState(false);
  const [semMais, setSemMais] = useState<Record<string, boolean>>({});

  async function handleLoadMore() {
    if (!selectedId || loadingMore) return;
    const convId = selectedId;
    // Só as que existem no servidor: o balão otimista (`tmp-...`) ainda não
    // está lá, e contá-lo deslocaria a janela em uma posição — o lote anterior
    // viria com um buraco no meio do histórico.
    const carregadas = (messagesByConv[convId] ?? []).filter((m) => !m.id.startsWith("tmp-")).length;
    setLoadingMore(true);
    try {
      const antigas = await fetchMessages(convId, { skip: carregadas });
      if (antigas.length < JANELA_MENSAGENS) setSemMais((p) => ({ ...p, [convId]: true }));
      if (antigas.length) {
        setMessagesByConv((prev) => ({ ...prev, [convId]: mergeMessages(prev[convId] ?? [], antigas) }));
      }
    } catch {
      /* silencioso: o botão continua lá para tentar de novo */
    } finally {
      setLoadingMore(false);
    }
  }

  function maybePing(convs: ConversationOverview[]) {
    const newest = maxInbound(convs);
    if (lastPingRef.current && newest > lastPingRef.current) playPing();
    if (newest > lastPingRef.current) lastPingRef.current = newest;
  }

  const selected =
    conversations.find((c) => c.id === selectedId) ?? (selectedId === DRAFT_ID ? draft : null);
  const messages = selectedId ? messagesByConv[selectedId] ?? [] : [];

  // Carrega mensagens ao selecionar (se ainda não estiverem em cache) e marca como lida.
  async function selectConversation(id: string) {
    setSelectedId(id);
    // Limpa reply-private quando o usuário muda de conversa manualmente
    setPrivateReplyMsg(null);
    if (!messagesByConv[id]) {
      const msgs = await fetchMessages(id);
      setMessagesByConv((prev) => ({ ...prev, [id]: msgs }));
    }
    if (live) markConversationRead(id).catch(() => {});
    if (live) markMentionsRead(id).catch(() => {});
    // Se grupo, carrega participantes reais para menções.
    const conv = conversations.find((c) => c.id === id);
    if (conv?.is_group) {
      getGroupInfo(id).then((g) => {
        if (g?.participants) {
          setGroupParticipants(g.participants.map((p) => ({ name: p.name ?? p.phone, phone: p.phone })));
        }
      }).catch(() => {});
    } else {
      setGroupParticipants([]);
    }
  }

  // Deep-link: ?c=<convId> (ex.: clicar numa menção no sino) seleciona a conversa.
  useEffect(() => {
    const c = searchParams.get("c");
    if (c && c !== selectedId) selectConversation(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Aba em segundo plano não precisa de dado fresco — e era ela que sobrava de
  // conta pra pagar. O polling não parava quando a janela perdia o foco: uma
  // aba esquecida aberta baixava 392 KB a cada 20s a noite toda e no fim de
  // semana (~1,7 GB/dia sem ninguém olhando, contra ~560 MB num dia de trabalho
  // de 8h). Quando a cota de egress satura, os requests falham, o middleware
  // não confirma a sessão e a atendente é jogada no /login "do nada".
  const [abaVisivel, setAbaVisivel] = useState(true);
  useEffect(() => {
    const sync = () => setAbaVisivel(!document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  // Porta única dos relógios: aba oculta congela o polling e volta sozinho
  // (o efeito remonta e dispara o tique imediato) quando a aba reaparece.
  const ativo = live && abaVisivel;

  // Polling rápido: lista de conversas a cada 2.5s + status dos canais a cada 15s.
  //
  // Só busca as NÃO encerradas aqui — ver o comentário em getConversations().
  // Encerrada não muda mais sozinha, então mantém as que já estavam no estado
  // (carregadas na abertura da página, ou na última vez que uma ação destas
  // trouxe a lista inteira) em vez de buscar de novo 24×/min.
  useEffect(() => {
    if (!ativo) return;
    let cancel = false;
    let channelTick = 0;
    const tick = async () => {
      try {
        const ativas = await fetchConversations({ includeClosed: false });
        if (!cancel && Array.isArray(ativas)) {
          maybePing(ativas); // encerrada não recebe mensagem nova, não precisa entrar aqui
          setConversations((prev) => [...ativas, ...prev.filter((c) => c.status === "closed")]);
        }
      } catch { /* silencioso */ }
      // Checa canais a cada ~60s (3 ticks × 20s)
      if (channelTick++ % 3 === 0) {
        try {
          const chs = await fetchChannelStatuses();
          if (!cancel) setDisconnectedChannels(chs.filter((c) => c.status !== "connected"));
        } catch { /* silencioso */ }
      }
    };
    tick();
    // 20s, não 2,5s. Cada tique custa ~377 KB (252 conversas ativas na view com
    // os dois LATERAL JOIN): a 2,5s era 9 MB/min por aba, ~4,3 GB num dia de
    // trabalho — foi o que estourou a cota de egress e derrubou o login de todo
    // mundo. Quem entrega tempo real é o realtime (INSERT e UPDATE já tratados
    // logo abaixo); este relógio é rede de segurança para quando o WebSocket
    // cai, mais o refetch ao voltar o foco na aba.
    const t = setInterval(tick, 20000);
    return () => { cancel = true; clearInterval(t); };
  }, [ativo]);

  // Ao voltar o foco na aba (atendente deixou em segundo plano), atualiza na
  // hora — navegadores estrangulam timers/WebSocket em abas ocultas, o que
  // fazia parecer que "precisa dar F5" pra ver mensagens novas.
  useEffect(() => {
    if (!live) return;
    const onVisible = () => {
      if (document.hidden) return;
      // MESMO RECORTE DO TIQUE: só as NÃO encerradas. Medido em produção hoje,
      // com 1.086 conversas (259 ativas): a lista inteira custa 1.442.552 bytes
      // e as ativas 392.266 — eram 1,44 MB baixados TODA vez que a atendente
      // voltava pra aba, pra quase sempre reencontrar o mesmo dado. Encerrada
      // não muda mais sozinha, então mantém as que já estão no estado em vez de
      // rebuscá-las.
      fetchConversations({ includeClosed: false })
        .then((ativas) => {
          if (!Array.isArray(ativas)) return;
          setConversations((prev) => [...ativas, ...prev.filter((c) => c.status === "closed")]);
        })
        .catch(() => {});
      if (selectedId) fetchMessages(selectedId).then((m) => setMessagesByConv((prev) => ({ ...prev, [selectedId]: m }))).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, [live, selectedId]);

  // Polling de mensagens da conversa aberta a cada 3s.
  useEffect(() => {
    if (!ativo || !selectedId) return;
    let cancel = false;
    const tick = async () => {
      try {
        const msgs = await fetchMessages(selectedId);
        if (!cancel) {
          setMessagesByConv((prev) => {
            const cur = prev[selectedId] ?? [];
            const unido = mergeMessages(cur, msgs);
            // Sem mudança de conteúdo: devolve o objeto anterior para não
            // re-renderizar a conversa inteira a cada 30s.
            if (unido.length === cur.length && unido.every((m, i) => m === cur[i])) return prev;
            return { ...prev, [selectedId]: unido };
          });
        }
      } catch (e) {
        console.warn("[poll:msgs]", e);
      }
    };
    tick();
    // 30s, não 3s: as mensagens novas chegam pelo realtime (INSERT) e as
    // mudanças de status pelo UPDATE. Este tique só reconcilia o que o
    // WebSocket tenha perdido.
    const t = setInterval(tick, 30000);
    return () => { cancel = true; clearInterval(t); };
  }, [ativo, selectedId]);

  // Realtime: mensagens recebidas (apenas direção "in"; as enviadas são otimistas).
  //
  // DE PROPÓSITO fora do `ativo`, e aqui é onde esta caixa diverge da Corrêa:
  // lá o `playPing` só sai do polling, então derrubar a assinatura com a aba
  // oculta não custa nada. Aqui o aviso sonoro mora no handler de INSERT logo
  // abaixo (foi movido pra cá quando o tique subiu pra 20s) — derrubar o
  // WebSocket calaria a atendente com a caixa em aba de fundo, que é justamente
  // quando ela precisa ser avisada.
  //
  // E não é isso que gasta cota. Medido: assinatura ociosa = 1.012 bytes em 90s
  // (~40 KB/h, ~1 MB/dia), contra os ~1,86 GB/dia que a mesma aba esquecida
  // gastava de polling. Congelar os relógios resolve 99,9% do problema; matar
  // o WebSocket junto compraria ~1 MB/dia ao preço do aviso de mensagem nova.
  useEffect(() => {
    if (!live) return;
    const supabase = createClient();
    const channel = supabase
      .channel("inbox-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.new as Message;

          // Aviso sonoro AQUI, e não só no polling: o tique da lista subiu de
          // 2,5s para 20s, e o som de mensagem nova não pode esperar o relógio.
          // Conversa desconhecida (recém-criada) toca — não existe silenciada
          // que a lista ainda não tenha.
          if (m.direction === "in") {
            const conv = conversationsRef.current.find((c) => c.id === m.conversation_id);
            const t = Date.parse(m.created_at);
            if (!conv?.is_muted && t > lastPingRef.current) {
              playPing();
              lastPingRef.current = t;
            }
          }

          setMessagesByConv((prev) => {
            const list = prev[m.conversation_id];
            if (!list) return prev;
            // Evita duplicar mensagens já presentes (ex.: otimista app-enviada).
            if (list.some((x) => x.id === m.id || (m.external_id && x.external_id === m.external_id))) return prev;
            return { ...prev, [m.conversation_id]: [...list, m] };
          });

          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === m.conversation_id);
            if (idx < 0) {
              router.refresh();
              return prev;
            }
            const updated: ConversationOverview = {
              ...prev[idx],
              last_message_body: m.body,
              last_message_at: m.created_at,
              last_message_direction: m.direction,
              last_message_author: m.author_name ?? null,
            };
            return [updated, ...prev.filter((_, i) => i !== idx)];
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.new as Message;
          setMessagesByConv((prev) =>
            prev[m.conversation_id]
              ? { ...prev, [m.conversation_id]: prev[m.conversation_id].map((x) => (x.id === m.id ? { ...x, ...m } : x)) }
              : prev,
          );
        },
      )
      .subscribe((status) => {
        // Se o canal cair (rede/token expirado), re-sincroniza pelo polling na
        // hora — evita ficar "surdo" sem perceber (o "precisa dar F5").
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          fetchConversations().then((c) => Array.isArray(c) && setConversations(c)).catch(() => {});
        }
      });

    // Mantém o WebSocket do realtime AUTENTICADO quando o token do navegador é
    // renovado (~a cada 1h). Sem isto, depois de um tempo o realtime para de
    // entregar mensagens novas sem erro visível — a causa clássica do "só vejo
    // mensagem nova dando F5".
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }
    });

    return () => {
      authSub.subscription.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [live, router]);

  function refetch(convId: string) {
    return fetchMessages(convId).then((msgs) => setMessagesByConv((prev) => ({ ...prev, [convId]: msgs })));
  }

  function handleSendLocation() {
    if (!selectedId) return;
    const convId = selectedId;
    if (!navigator.geolocation) {
      alert("Geolocalização não disponível neste dispositivo.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        startTransitionComTeto(startTransition, async () => {
          await sendLocationMessage(convId, { latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          await refetch(convId);
        });
      },
      () => alert("Não foi possível obter a localização."),
    );
  }

  function handleSendContact() {
    if (!selectedId) return;
    const convId = selectedId;
    const name = window.prompt("Nome do contato:");
    if (!name) return;
    const phone = window.prompt("Telefone (com DDI+DDD, só números):");
    if (!phone) return;
    startTransitionComTeto(startTransition, async () => {
      await sendContactMessage(convId, name, phone);
      await refetch(convId);
    });
  }

  function handleOpenDirect(m: Message) {
    if (!selected) return;
    startDirect(selected, { phone: m.author_phone ?? undefined, lid: m.author_lid ?? undefined, name: m.author_name ?? undefined });
  }

  /** "Responder no privado": abre o 1:1 com a mensagem do grupo como citação pré-preenchida. */
  function handleReplyPrivate(m: Message) {
    if (!selected) return;
    setPrivateReplyMsg(m);
    startDirect(selected, { phone: m.author_phone ?? undefined, lid: m.author_lid ?? undefined, name: m.author_name ?? undefined });
  }

  function handleOpenContact(phone: string, name?: string) {
    if (!selected) return;
    startDirect(selected, { phone, name });
  }

  function startDirect(grp: ConversationOverview, opts: { phone?: string; lid?: string; name?: string }) {
    startTransitionComTeto(startTransition, async () => {
      const r = await resolveDirectContact(grp.channel_id, {
        ...opts,
        groupJid: grp.contact_jid ?? undefined,
      });
      if (!r.phone) {
        alert("Não consegui identificar o número deste participante.");
        return;
      }
      // Já existe conversa? Abre a real.
      if (r.existingId) {
        const convs = await fetchConversations();
        setConversations(convs);
        setSelectedId(r.existingId);
        const msgs = await fetchMessages(r.existingId);
        setMessagesByConv((prev) => ({ ...prev, [r.existingId!]: msgs }));
        return;
      }
      // Conversa-rascunho TRANSITÓRIA (não persiste até digitar/enviar).
      setDraft({
        ...grp,
        id: DRAFT_ID,
        contact_id: "",
        contact_name: r.name,
        contact_phone: r.phone,
        contact_avatar: null,
        is_group: false,
        contact_jid: null,
        status: "open",
        last_message_at: null,
        last_message_body: null,
        last_message_direction: null,
        last_message_author: null,
      });
      setDraftRealId(null);
      setMessagesByConv((prev) => ({ ...prev, [DRAFT_ID]: [] }));
      setSelectedId(DRAFT_ID);
    });
  }

  // Cria de fato a conversa do rascunho (ao digitar ou enviar). Retorna o id real.
  async function materializeDraft(): Promise<string | null> {
    if (!draft) return null;
    if (draftRealId) return draftRealId;
    const { id } = await openDirectConversation(draft.channel_id, {
      phone: draft.contact_phone,
      name: draft.contact_name ?? undefined,
    });
    if (id) {
      setDraftRealId(id);
      const convs = await fetchConversations();
      setConversations(convs);
    }
    return id;
  }

  function handleDraftType() {
    if (selectedId === DRAFT_ID && !draftRealId) {
      startTransitionComTeto(startTransition, async () => {
        await materializeDraft();
      });
    }
  }

  function handleReact(m: Message, emoji: string) {
    if (!selectedId) return;
    const convId = selectedId;
    startTransitionComTeto(startTransition, async () => {
      await reactToMessage(convId, m.id, emoji);
      const msgs = await fetchMessages(convId);
      setMessagesByConv((prev) => ({ ...prev, [convId]: msgs }));
    });
  }

  function handleEdit(m: Message) {
    setEditing({ id: m.id, text: m.body ?? "" });
  }

  function saveEdit() {
    if (!selectedId || !editing) return;
    const convId = selectedId;
    const { id, text } = editing;
    setEditing(null);
    startTransitionComTeto(startTransition, async () => {
      await editMessageAction(convId, id, text);
      const msgs = await fetchMessages(convId);
      setMessagesByConv((prev) => ({ ...prev, [convId]: msgs }));
    });
  }

  // Abre o modal próprio (centralizado) em vez do confirm() nativo do navegador.
  function handleDelete(m: Message) {
    if (!selectedId) return;
    setDeleteTarget(m);
  }

  function confirmDelete(scope: "me" | "everyone") {
    const m = deleteTarget;
    setDeleteTarget(null);
    if (!m || !selectedId) return;
    const convId = selectedId;
    startTransitionComTeto(startTransition, async () => {
      await deleteMessageAction(convId, m.id, scope);
      const msgs = await fetchMessages(convId);
      setMessagesByConv((prev) => ({ ...prev, [convId]: msgs }));
    });
  }

  function handleSend(text: string, replyId?: string, mentions?: { name: string; phone: string }[]) {
    if (!selectedId) return;

    // "Responder no privado": a mensagem do grupo não pode ser citada via replyId
    // (cross-chat), então prefixamos o texto com a citação e enviamos sem replyId.
    let finalText = text;
    let finalReplyId = replyId;
    if (privateReplyMsg && replyId === privateReplyMsg.external_id) {
      const author = privateReplyMsg.author_name ?? "Participante";
      const excerpt = (privateReplyMsg.body ?? `[${privateReplyMsg.content_type}]`).slice(0, 200);
      finalText = `> *${author}:*\n> ${excerpt.split("\n").join("\n> ")}\n\n${text}`;
      finalReplyId = undefined;
      setPrivateReplyMsg(null);
    }

    // Rascunho: cria a conversa de verdade agora e envia nela.
    if (selectedId === DRAFT_ID) {
      startTransitionComTeto(startTransition, async () => {
        const realId = await materializeDraft();
        if (!realId) return;
        await sendMessage(realId, finalText, finalReplyId, mentions);
        const convs = await fetchConversations();
        setConversations(convs);
        setSelectedId(realId);
        const msgs = await fetchMessages(realId);
        setMessagesByConv((prev) => ({ ...prev, [realId]: msgs }));
        setDraft(null);
        setDraftRealId(null);
      });
      return;
    }
    const optimistic: Message = {
      id: `tmp-${Date.now()}`,
      organization_id: "",
      conversation_id: selectedId,
      direction: "out",
      sender_type: "agent",
      sender_id: userId,
      content_type: "text",
      body: finalText,
      media_url: null,
      status: "pending",
      external_id: null,
      created_at: new Date().toISOString(),
    };
    setMessagesByConv((prev) => ({
      ...prev,
      [selectedId]: [...(prev[selectedId] ?? []), optimistic],
    }));
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === selectedId);
      if (idx < 0) return prev;
      const updated = { ...prev[idx], last_message_body: finalText, last_message_at: optimistic.created_at, last_message_direction: "out" as const };
      return [updated, ...prev.filter((_, i) => i !== idx)];
    });

    startTransition(async () => {
      // Se a ação EXPLODE (queda de rede, servidor reiniciando, sessão
      // expirada), o `await` rejeita e o resto nem roda: sem aviso, sem
      // recarregar. O balão otimista ficava na tela como se tivesse ido —
      // e a mensagem nunca saiu. Foi o que a Luana chamou de "algumas não
      // enviam": a tela dizia que sim. Aqui ela passa a dizer a verdade.
      const falhou = (aviso: string) => {
        setMessagesByConv((prev) => ({
          ...prev,
          [selectedId]: (prev[selectedId] ?? []).map((m) =>
            m.id === optimistic.id ? { ...m, status: "failed" as const } : m,
          ),
        }));
        toast(aviso, "error");
      };
      try {
        // 35s: folgado acima do teto de 25s que o servidor já aplica na
        // uazapi, para não desistir bem na hora em que o servidor ia
        // responder. Fecha a camada que aquele teto não cobre: a ida e volta
        // entre ESTE celular e o servidor, que pode travar numa rede ruim
        // sem o servidor ter culpa nenhuma.
        const r = await comTeto(sendMessage(selectedId, finalText, finalReplyId, mentions), 35000);
        if (r && r.ok === false) falhou(r.error ?? "Mensagem não entregue.");
      } catch (e) {
        falhou(
          e instanceof Error && e.message === "SEM_RESPOSTA"
            ? "Sem resposta do servidor — confira se a mensagem foi enviada antes de tentar de novo."
            : e instanceof Error && /fetch|network|Failed/i.test(e.message)
              ? "Sem conexão — a mensagem NÃO foi enviada. Tente de novo."
              : "A mensagem NÃO foi enviada. Tente de novo.",
        );
        return; // não recarrega por cima: o balão vermelho precisa ficar visível
      }
      // Recarrega SEMPRE, não só no modo ao vivo: é o que troca o balão
      // otimista pela mensagem de verdade, com recibo.
      const msgs = await fetchMessages(selectedId).catch(() => null);
      if (msgs) setMessagesByConv((prev) => ({ ...prev, [selectedId]: msgs }));
    });
  }

  function handleSendInternal(text: string, mentions: { id: string; name: string }[]) {
    if (!selectedId || selectedId === DRAFT_ID) return;
    const convId = selectedId;
    const myName = agents.find((a) => a.id === userId)?.name ?? "Você";
    const optimistic: Message = {
      id: `tmp-int-${Date.now()}`,
      organization_id: "",
      conversation_id: convId,
      direction: "out",
      sender_type: "agent",
      sender_id: userId,
      content_type: "text",
      body: text,
      media_url: null,
      status: "sent",
      external_id: null,
      is_internal: true,
      author_name: myName,
      mentions,
      created_at: new Date().toISOString(),
    };
    setMessagesByConv((prev) => ({ ...prev, [convId]: [...(prev[convId] ?? []), optimistic] }));
    startTransition(async () => {
      // Mesma proteção do envio ao cliente: sem isto, uma trava aqui deixava
      // a nota "pendurada" na tela sem nenhum aviso — pior que o envio ao
      // cliente, que ao menos já tinha tratamento de erro.
      try {
        await comTeto(sendInternalMessage(convId, text, mentions), 35000);
      } catch (e) {
        setMessagesByConv((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) => (m.id === optimistic.id ? { ...m, status: "failed" as const } : m)),
        }));
        toast(
          e instanceof Error && e.message === "SEM_RESPOSTA"
            ? "Sem resposta do servidor — confira se a nota foi salva."
            : "Não foi possível salvar a nota. Tente de novo.",
          "error",
        );
        return;
      }
      if (live) {
        const msgs = await fetchMessages(convId);
        setMessagesByConv((prev) => ({ ...prev, [convId]: msgs }));
      }
    });
  }

  function handleSendTemplate(name: string, language: string, params: string[]) {
    if (!selectedId || selectedId === DRAFT_ID) return;
    const convId = selectedId;
    startTransitionComTeto(startTransition, async () => {
      const r = await sendTemplateMessage(convId, name, language, params);
      if (r?.ok) toast("Modelo enviado.");
      else toast(r?.error ?? "Falha ao enviar o modelo.", "error");
      const msgs = await fetchMessages(convId);
      setMessagesByConv((prev) => ({ ...prev, [convId]: msgs }));
    });
  }

  function handleSendFile(file: File, asSticker?: boolean) {
    if (!selectedId) return;
    const convId = selectedId;
    // Legenda vinda do modal de preview (propriedade custom no File).
    const caption = (file as File & { caption?: string }).caption;
    // O upload em si já tem o próprio teto (AbortSignal 90s, logo abaixo).
    // Mas o botão de gravar/enviar fica preso no MESMO isPending até a
    // função toda terminar — inclusive o fetchMessages() de recarregar a
    // tela DEPOIS do upload já ter dado certo. Sem este teto aqui, uma
    // trava nesse recarregamento (áudio já enviado, mas a tela não volta a
    // liberar o microfone) obrigava a sair e voltar da conversa pra
    // destravar — era exatamente a queixa "o botão de gravar fica cinza
    // mesmo o áudio já tendo sido enviado". 95s: um pouco acima do teto do
    // upload, pra deixar o aviso mais específico dele aparecer primeiro.
    startTransitionComTeto(startTransition, async () => {
      // Arquivo cru no corpo e dados na URL: multipart quebrava ao ser lido no
      // servidor ("Failed to parse body as FormData"). Ver a rota.
      try {
        const q = new URLSearchParams({
          conversationId: convId,
          nome: file.name || "arquivo",
          ...(caption ? { caption } : {}),
          ...(asSticker ? { kind: "sticker" } : {}),
        });
        const r = await fetch(`/api/atendimento/enviar-midia?${q}`, {
          method: "POST",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: file,
          // Teto do lado do navegador — o mesmo problema do envio de texto
          // (celular travado esperando o servidor numa rede ruim), só que
          // aqui dá para usar o abort nativo do fetch. 90s: arquivo grande
          // demora mais que uma mensagem de texto para subir.
          signal: AbortSignal.timeout(90000),
        });
        const dados = await r.json().catch(() => ({}) as { error?: string });
        if (!r.ok || dados.ok === false) {
          toast(
            `Não foi possível enviar "${file.name}". ${dados.error ?? `HTTP ${r.status}`}`,
            "error",
          );
          return;
        }
      } catch (e) {
        const semResposta = e instanceof Error && e.name === "TimeoutError";
        toast(
          semResposta
            ? `Sem resposta do servidor ao enviar "${file.name}" — confira antes de tentar de novo.`
            : `Não foi possível enviar "${file.name}". ${(e as Error)?.message ?? ""}`.trim(),
          "error",
        );
        return;
      }
      const msgs = await fetchMessages(convId);
      setMessagesByConv((prev) => ({ ...prev, [convId]: msgs }));
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === convId);
        if (idx < 0) return prev;
        const ml: Record<string, string> = { "image/": "📷 Foto", "video/": "🎥 Vídeo", "audio/": "🎵 Áudio" };
        const mediaPreview = Object.entries(ml).find(([k]) => file.type.startsWith(k))?.[1] ?? "📄 Documento";
        const cap = (file as File & { caption?: string }).caption;
        const updated = { ...prev[idx], last_message_body: cap || mediaPreview, last_message_at: new Date().toISOString(), last_message_direction: "out" as const };
        return [updated, ...prev.filter((_, i) => i !== idx)];
      });
    }, 95000);
  }

  function handleAssign() {
    if (!selectedId) return;
    const antes = conversations.find((c) => c.id === selectedId);
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, status: "open", assigned_user_id: userId } : c)),
    );
    startTransitionComTeto(startTransition, async () => {
      // Confirma de verdade em vez de "atire e esqueça": sem isto, uma falha
      // silenciosa fazia a otimista aparecer por um instante e sumir sozinha
      // no próximo ciclo de 2,5s — dava a sensação exata de "tentei e não
      // consegui", sem nenhum aviso do que deu errado.
      const r = await assignToMe(selectedId).catch(() => ({ ok: false as const, error: "Não foi possível atribuir." }));
      if (r && "ok" in r && !r.ok) {
        setConversations((prev) => prev.map((c) => (c.id === selectedId ? (antes ?? c) : c)));
        toast(r.error ?? "Não foi possível atribuir.", "error");
      } else {
        // Confirmação explícita — sem isto a tela mudava (ou nem mudava, se o
        // pai ainda não tinha revalidado) sem nenhum aviso de que funcionou.
        toast("Atendimento atribuído a você.", "success");
      }
    });
  }

  function handleClose() {
    if (!selectedId || selectedId === DRAFT_ID) return;
    setClosing(true);
  }

  function confirmClose(opts: { reason: string; solution: string; forwardings: string; pending: string; tagIds: string[]; sendSurvey: boolean }) {
    if (!selectedId) return;
    const id = selectedId;
    setClosing(false);
    startTransitionComTeto(startTransition, async () => {
      const res = await closeConversation(id, opts);
      if (res && "ok" in res && res.ok === false) {
        // Bloqueado por campos obrigatórios: nada de marcar como encerrada.
        await refetch(id);
        return;
      }
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, status: "closed" } : c)));
      await refetch(id);
    });
  }

  function handleTransfer() {
    if (!selectedId || selectedId === DRAFT_ID) return;
    setTransferring(true);
  }

  function handleAddNote() {
    if (!selectedId || selectedId === DRAFT_ID) return;
    setNoteText("");
    setNoting(true);
  }

  function openNewConversation() {
    const list = channels ?? [];
    setNcChannel(list[0]?.id ?? "");
    setNcPhone("");
    setNcName("");
    setNewConvOpen(true);
  }

  function confirmNewConversation() {
    const phone = ncPhone.replace(/\D/g, "");
    if (!ncChannel || !phone) return;
    setNewConvOpen(false);
    startTransitionComTeto(startTransition, async () => {
      const { id } = await openDirectConversation(ncChannel, { phone, name: ncName.trim() || undefined });
      if (!id) {
        alert("Não foi possível abrir o atendimento.");
        return;
      }
      const convs = await fetchConversations();
      setConversations(convs);
      setSelectedId(id);
      const msgs = await fetchMessages(id);
      setMessagesByConv((prev) => ({ ...prev, [id]: msgs }));
    });
  }

  function confirmNote() {
    if (!selectedId) return;
    const id = selectedId;
    const text = noteText.trim();
    if (!text) return;
    setNoting(false);
    startTransitionComTeto(startTransition, async () => {
      await addInternalNote(id, text);
      await refetch(id);
    });
  }

  function confirmTransfer(opts: {
    toUserId: string | null;
    toDepartmentId: string | null;
    internalNote: string;
    customerMessage: string;
  }) {
    if (!selectedId) return;
    const id = selectedId;
    setTransferring(false);
    startTransitionComTeto(startTransition, async () => {
      await transferConversation(id, opts);
      const convs = await fetchConversations();
      setConversations(convs);
      await refetch(id);
    });
  }

  function handleToggleMute() {
    if (!selectedId) return;
    const next = !selected?.is_muted;
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, is_muted: next } : c)),
    );
    startTransitionComTeto(startTransition, () => toggleMute(selectedId, next).then(() => undefined));
  }

  function handleToggleAi() {
    if (!selectedId || selectedId === DRAFT_ID) return;
    // "IA conduzindo" = ai_enabled e status bot. Se está conduzindo → pausa (false);
    // se é humano atendendo (open) → devolve para a IA (true).
    const aiHandling = selected?.ai_enabled !== false && selected?.status === "bot";
    const next = !aiHandling;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? { ...c, ai_enabled: next, status: next ? "bot" : "open", assigned_user_id: next ? c.assigned_user_id : userId }
          : c,
      ),
    );
    startTransitionComTeto(startTransition, async () => {
      await setConversationAi(selectedId, next);
      await refetch(selectedId);
    });
  }

  function handleToggleIdentifyAgent() {
    const next = !identifyAgentEnabled;
    setIdentifyAgentEnabled(next);
    startTransitionComTeto(startTransition, async () => {
      const r = await toggleIdentifyAgent(next).catch(() => ({ enabled: !next, error: "Não foi possível salvar." }));
      if ("error" in r && r.error) {
        setIdentifyAgentEnabled(!next);
        toast(r.error, "error");
      } else {
        toast(next ? "Assinatura ativada nas suas mensagens." : "Assinatura desativada nas suas mensagens.");
      }
    });
  }

  // Atalho da lista: pausa a IA de uma conversa sem precisar abri-la.
  function handlePauseAiQuick(id: string) {
    if (id === DRAFT_ID) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ai_enabled: false, status: "open", assigned_user_id: userId } : c)),
    );
    startTransitionComTeto(startTransition, async () => {
      await setConversationAi(id, false);
      if (id === selectedId) await refetch(id);
    });
  }

  // Conversas filtradas: esconde só as de canais desconectados. Quem vê o quê
  // é decidido pela aba Minhas/Sem responsável/Todas da lista — atendente
  // deixou de ser impedido de abrir a conversa de outro, como era no Chatwoot.
  const disconnectedIds = new Set(disconnectedChannels.map((c) => c.id));
  const visibleConversations = disconnectedIds.size > 0
    ? conversations.filter((c) => !disconnectedIds.has(c.channel_id))
    : conversations;
  const allDisconnected = disconnectedChannels.length > 0 && visibleConversations.length === 0 && conversations.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Banner de canais desconectados */}
      {disconnectedChannels.length > 0 && (
        <div className={`flex items-center gap-2 px-4 py-2 text-sm ${allDisconnected ? "bg-red-500 text-white" : "bg-amber-50 text-amber-800 border-b border-amber-100"}`}>
          <span className="text-lg">{allDisconnected ? "🔌" : "⚠️"}</span>
          <span className="flex-1">
            {allDisconnected
              ? "Todos os números estão desconectados. Acesse Canais para reconectar."
              : `${disconnectedChannels.length} canal(is) desconectado(s): ${disconnectedChannels.map((c) => c.name).join(", ")}`}
          </span>
          <a href="/canais" className={`shrink-0 rounded-lg px-3 py-1 text-xs font-medium ${allDisconnected ? "bg-white text-red-600 hover:bg-red-50" : "bg-amber-100 text-amber-800 hover:bg-amber-200"}`}>
            Reconectar
          </a>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
      {/* Com conversa aberta, a lista some abaixo de lg para o painel de contato
          caber dockado (chat + painel). Em lg+ mostra lista + chat + painel. */}
      <div className={`${selectedId ? "hidden lg:flex" : "flex"} h-full w-full lg:w-auto`}>
        <ConversationList
          conversations={visibleConversations}
          selectedId={selectedId}
          onSelect={selectConversation}
          onPauseAi={handlePauseAiQuick}
          onNewConversation={(channels?.length ?? 0) > 0 ? openNewConversation : undefined}
          onBulkClosed={(ids) => {
            // Some da lista na hora; o servidor já gravou.
            const fechadas = new Set(ids);
            setConversations((prev) =>
              prev.map((c) => (fechadas.has(c.id) ? { ...c, status: "closed" as const } : c)),
            );
            toast(`${ids.length} atendimento(s) encerrado(s).`, "success");
          }}
          userId={userId}
          isAdmin={isAdmin}
          departments={departments}
          agents={agents}
        />
      </div>
      {selected ? (
        <ChatThread
          onBack={() => setSelectedId(null)}
          conversation={selected}
          messages={messages}
          onLoadMore={handleLoadMore}
          hasMore={!semMais[selectedId ?? ""] && messages.length >= JANELA_MENSAGENS}
          loadingMore={loadingMore}
          groupParticipants={groupParticipants}
          onSend={handleSend}
          onSendInternal={handleSendInternal}
          agents={agents.map((a) => ({ id: a.id, name: a.name ?? "Atendente", avatar_url: a.avatar_url }))}
          currentUserId={userId}
          hideAi={hideAi}
          isAdmin={isAdmin}
          identifyAgentEnabled={identifyAgentEnabled}
          onToggleIdentifyAgent={handleToggleIdentifyAgent}
          onSendFile={handleSendFile}
          onSendLocation={handleSendLocation}
          onSendContact={handleSendContact}
          onReact={handleReact}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onAuthorClick={handleOpenDirect}
          onReplyPrivate={selected.is_group ? handleReplyPrivate : undefined}
          onOpenPanel={() => setPanelOpen(true)}
          onType={handleDraftType}
          onAssign={handleAssign}
          onClose={handleClose}
          onTransfer={handleTransfer}
          onAddNote={handleAddNote}
          onToggleMute={handleToggleMute}
          onToggleAi={handleToggleAi}
          initialReplyTo={!selected.is_group && privateReplyMsg ? privateReplyMsg : undefined}
          quickReplies={quickReplies}
          templates={templates}
          onSendTemplate={handleSendTemplate}
          pending={isPending}
        />
      ) : (
        <div className="hidden flex-1 items-center justify-center text-sm text-ink-soft md:flex">
          Selecione uma conversa para começar.
        </div>
      )}

      {selected && (
        <>
          {/* Backdrop apenas no modo gaveta (abaixo de md = celular), quando aberta. */}
          {panelOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/40 md:hidden"
              onClick={() => setPanelOpen(false)}
            />
          )}
          {/*
            md+: coluna fixa (dockada), SEMPRE visível ao LADO da conversa — reflui o chat.
            < md (celular): gaveta que desliza da direita, só quando panelOpen.
          */}
          <div
            className={
              "shrink-0 transition-transform duration-200 " +
              "max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-50 max-md:shadow-2xl " +
              (panelOpen ? "max-md:translate-x-0" : "max-md:translate-x-full") +
              " md:static md:z-auto md:translate-x-0 md:shadow-none"
            }
          >
            <ContactPanel
              key={selected.id}
              conversation={selected}
              onClose={() => setPanelOpen(false)}
              onOpenContact={handleOpenContact}
            />
          </div>
        </>
      )}

      {closing && selected && (
        <CloseModal
          tags={tags}
          protocol={selected.protocol}
          onConfirm={confirmClose}
          onCancel={() => setClosing(false)}
          pending={isPending}
        />
      )}

      {transferring && selected && (
        <TransferModal
          agents={agents}
          departments={departments}
          currentUserId={userId}
          onConfirm={confirmTransfer}
          onCancel={() => setTransferring(false)}
          pending={isPending}
        />
      )}

      {newConvOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setNewConvOpen(false)}>
          <div className="w-full max-w-md rounded-card bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Novo atendimento</h2>
              <button onClick={() => setNewConvOpen(false)} className="text-ink-soft hover:text-ink"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">Canal</label>
                <select
                  value={ncChannel}
                  onChange={(e) => setNcChannel(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
                >
                  {(channels ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">Telefone (com código do país)</label>
                <input
                  value={ncPhone}
                  onChange={(e) => setNcPhone(e.target.value)}
                  placeholder="5573999998888"
                  inputMode="numeric"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
                />
                {/* Sem completar sozinho o "55" de um número sem código de país
                    já causou entrega falhando sempre pra quem foi cadastrado
                    assim (número digitado sem o 55 nunca bate com o que o
                    WhatsApp manda de verdade). Só completa quando são 10-11
                    dígitos — por isso o aviso pra sempre incluir o código de
                    quem é de fora, senão o sistema entende como Brasil. */}
                <p className="mt-1 text-[11px] text-ink-soft">
                  Brasil: DDD + número, com ou sem o 55 (completa sozinho) — ex.: 73999998888.
                  De outro país: sempre com o código do país na frente — ex.: 1212… (EUA), 351934… (Portugal).
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-soft">Nome (opcional)</label>
                <input
                  value={ncName}
                  onChange={(e) => setNcName(e.target.value)}
                  placeholder="Nome do contato"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
                />
              </div>
              {(channels ?? []).find((c) => c.id === ncChannel)?.type === "meta_cloud" && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  Canal Meta oficial: fora da janela de 24h, só mensagens de template (HSM) são entregues.
                </p>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setNewConvOpen(false)} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-ink hover:bg-gray-200">
                Cancelar
              </button>
              <button onClick={confirmNewConversation} disabled={!ncChannel || !ncPhone.replace(/\D/g, "")} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40">
                Abrir atendimento
              </button>
            </div>
          </div>
        </div>
      )}

      {noting && selected && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setNoting(false)}>
          <div className="w-full max-w-md rounded-card bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Nota interna</h2>
              <button onClick={() => setNoting(false)} className="text-ink-soft hover:text-ink"><X size={18} /></button>
            </div>
            <p className="mb-2 text-xs text-ink-soft">Visível apenas para a equipe — não é enviada ao cliente.</p>
            <textarea
              autoFocus
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); confirmNote(); }
                if (e.key === "Escape") setNoting(false);
              }}
              rows={3}
              placeholder="Anotação sobre o atendimento..."
              className="w-full resize-none rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setNoting(false)} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-ink hover:bg-gray-200">
                Cancelar
              </button>
              <button onClick={confirmNote} disabled={!noteText.trim()} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40">
                Adicionar nota
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm rounded-card bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Apagar mensagem</h2>
              <button onClick={() => setDeleteTarget(null)} className="text-ink-soft hover:text-ink"><X size={18} /></button>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => confirmDelete("everyone")}
                className="w-full rounded-lg bg-danger px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-600"
              >
                Apagar para todos
              </button>
              <button
                onClick={() => confirmDelete("me")}
                className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-gray-50"
              >
                Apagar para mim
              </button>
              <button
                onClick={() => setDeleteTarget(null)}
                className="w-full rounded-lg px-4 py-2 text-sm font-medium text-ink-soft transition hover:bg-gray-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-card bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Editar mensagem</h2>
              <button onClick={() => setEditing(null)} className="text-ink-soft hover:text-ink"><X size={18} /></button>
            </div>
            <textarea
              autoFocus
              value={editing.text}
              onChange={(e) => setEditing((s) => (s ? { ...s, text: e.target.value } : s))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                if (e.key === "Escape") setEditing(null);
              }}
              rows={3}
              className="w-full resize-none rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-ink hover:bg-gray-200">
                Cancelar
              </button>
              <button onClick={saveEdit} disabled={!editing.text.trim()} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
