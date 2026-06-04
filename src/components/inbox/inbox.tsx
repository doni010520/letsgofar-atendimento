"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { ConversationList } from "./conversation-list";
import { ChatThread } from "./chat-thread";
import { ContactPanel } from "./contact-panel";
import { createClient } from "@/lib/supabase/client";

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
  sendMediaMessage,
  sendLocationMessage,
  sendContactMessage,
  reactToMessage,
  editMessageAction,
  deleteMessageAction,
  markConversationRead,
  assignToMe,
  closeConversation,
  toggleMute,
  fetchMessages,
  fetchConversations,
  openDirectConversation,
  resolveDirectContact,
} from "@/app/(app)/atendimento/actions";
import type { ConversationOverview, Message } from "@/lib/types";

export function Inbox({
  initialConversations,
  initialSelectedId,
  initialMessages,
  userId,
  live,
}: {
  initialConversations: ConversationOverview[];
  initialSelectedId: string | null;
  initialMessages: Message[];
  userId: string | null;
  live: boolean;
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, Message[]>>(
    initialSelectedId ? { [initialSelectedId]: initialMessages } : {},
  );
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  // Conversa-rascunho transitória (ao clicar num participante): só persiste ao digitar/enviar.
  const [draft, setDraft] = useState<ConversationOverview | null>(null);
  const [draftRealId, setDraftRealId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
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
    if (!messagesByConv[id]) {
      const msgs = await fetchMessages(id);
      setMessagesByConv((prev) => ({ ...prev, [id]: msgs }));
    }
    if (live) markConversationRead(id).catch(() => {});
  }

  // Polling de segurança: atualiza a inbox a cada 5s (independe do Realtime).
  useEffect(() => {
    if (!live) return;
    let cancel = false;
    const tick = async () => {
      try {
        const convs = await fetchConversations();
        if (!cancel && Array.isArray(convs)) {
          setConversations(convs);
          maybePing(convs);
        }
        if (!cancel && selectedId) {
          const msgs = await fetchMessages(selectedId);
          setMessagesByConv((prev) => {
            const cur = prev[selectedId] ?? [];
            const lastCur = cur[cur.length - 1];
            const lastNew = msgs[msgs.length - 1];
            if (cur.length === msgs.length && lastCur?.id === lastNew?.id && lastCur?.status === lastNew?.status) return prev;
            return { ...prev, [selectedId]: msgs };
          });
        }
      } catch {
        /* silencioso */
      }
    };
    tick(); // primeira atualização imediata
    const t = setInterval(tick, 4000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
  }, [live, selectedId]);

  // Realtime: mensagens recebidas (apenas direção "in"; as enviadas são otimistas).
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
      .subscribe();

    return () => {
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
        startTransition(async () => {
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
    startTransition(async () => {
      await sendContactMessage(convId, name, phone);
      await refetch(convId);
    });
  }

  function handleOpenDirect(m: Message) {
    if (!selected) return;
    startDirect(selected, { phone: m.author_phone ?? undefined, lid: m.author_lid ?? undefined, name: m.author_name ?? undefined });
  }

  function handleOpenContact(phone: string, name?: string) {
    if (!selected) return;
    startDirect(selected, { phone, name });
  }

  function startDirect(grp: ConversationOverview, opts: { phone?: string; lid?: string; name?: string }) {
    startTransition(async () => {
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
      startTransition(async () => {
        await materializeDraft();
      });
    }
  }

  function handleReact(m: Message, emoji: string) {
    if (!selectedId) return;
    const convId = selectedId;
    startTransition(async () => {
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
    startTransition(async () => {
      await editMessageAction(convId, id, text);
      const msgs = await fetchMessages(convId);
      setMessagesByConv((prev) => ({ ...prev, [convId]: msgs }));
    });
  }

  function handleDelete(m: Message) {
    if (!selectedId) return;
    const convId = selectedId;
    if (!window.confirm("Apagar esta mensagem para todos?")) return;
    startTransition(async () => {
      await deleteMessageAction(convId, m.id);
      const msgs = await fetchMessages(convId);
      setMessagesByConv((prev) => ({ ...prev, [convId]: msgs }));
    });
  }

  function handleSend(text: string, replyId?: string, mentions?: { name: string; phone: string }[]) {
    if (!selectedId) return;
    // Rascunho: cria a conversa de verdade agora e envia nela.
    if (selectedId === DRAFT_ID) {
      startTransition(async () => {
        const realId = await materializeDraft();
        if (!realId) return;
        await sendMessage(realId, text, replyId, mentions);
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
      body: text,
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
      const updated = { ...prev[idx], last_message_body: text, last_message_at: optimistic.created_at, last_message_direction: "out" as const };
      return [updated, ...prev.filter((_, i) => i !== idx)];
    });

    startTransition(async () => {
      await sendMessage(selectedId, text, replyId, mentions);
      if (live) {
        const msgs = await fetchMessages(selectedId);
        setMessagesByConv((prev) => ({ ...prev, [selectedId]: msgs }));
      }
    });
  }

  function handleSendFile(file: File, asSticker?: boolean) {
    if (!selectedId) return;
    const convId = selectedId;
    const fd = new FormData();
    fd.set("conversationId", convId);
    fd.set("file", file);
    if (asSticker) fd.set("kind", "sticker");
    startTransition(async () => {
      await sendMediaMessage(fd);
      const msgs = await fetchMessages(convId);
      setMessagesByConv((prev) => ({ ...prev, [convId]: msgs }));
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === convId);
        if (idx < 0) return prev;
        const updated = { ...prev[idx], last_message_at: new Date().toISOString(), last_message_direction: "out" as const };
        return [updated, ...prev.filter((_, i) => i !== idx)];
      });
    });
  }

  function handleAssign() {
    if (!selectedId) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, status: "open", assigned_user_id: userId } : c)),
    );
    startTransition(() => assignToMe(selectedId));
  }

  function handleClose() {
    if (!selectedId) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, status: "closed" } : c)),
    );
    startTransition(() => closeConversation(selectedId));
  }

  function handleToggleMute() {
    if (!selectedId) return;
    const next = !selected?.is_muted;
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, is_muted: next } : c)),
    );
    startTransition(() => toggleMute(selectedId, next).then(() => undefined));
  }

  return (
    <div className="flex h-full">
      <ConversationList
        conversations={conversations}
        selectedId={selectedId}
        onSelect={selectConversation}
      />
      {selected ? (
        <ChatThread
          conversation={selected}
          messages={messages}
          onSend={handleSend}
          onSendFile={handleSendFile}
          onSendLocation={handleSendLocation}
          onSendContact={handleSendContact}
          onReact={handleReact}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onAuthorClick={handleOpenDirect}
          onOpenPanel={() => setPanelOpen(true)}
          onType={handleDraftType}
          onAssign={handleAssign}
          onClose={handleClose}
          onToggleMute={handleToggleMute}
          pending={isPending}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-soft">
          Selecione uma conversa para começar.
        </div>
      )}

      {selected && panelOpen && (
        <ContactPanel
          key={selected.id}
          conversation={selected}
          onClose={() => setPanelOpen(false)}
          onOpenContact={handleOpenContact}
        />
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
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand"
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
  );
}
