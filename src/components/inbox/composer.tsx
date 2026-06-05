"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Paperclip, Mic, Square, Loader2, MapPin, UserPlus, FileUp, Smile, Sticker, X, Image as ImageIcon } from "lucide-react";
import { EmojiPicker } from "./emoji-picker";

type Mention = { name: string; phone: string };

export function Composer({
  onSend,
  onSendFile,
  onSendLocation,
  onSendContact,
  onType,
  mentionCandidates,
  disabled,
  sending,
  focusTrigger,
}: {
  onSend: (text: string, mentions?: Mention[]) => void;
  onSendFile: (file: File, asSticker?: boolean) => void;
  onSendLocation?: () => void;
  onSendContact?: () => void;
  onType?: () => void;
  mentionCandidates?: Mention[];
  disabled?: boolean;
  sending?: boolean;
  focusTrigger?: unknown;
}) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);

  // Foco automático ao mudar focusTrigger (ex.: clicar Responder).
  useEffect(() => { if (focusTrigger != null) taRef.current?.focus(); }, [focusTrigger]);

  const [attachMenu, setAttachMenu] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentions, setMentions] = useState<Mention[]>([]);

  // Preview de mídia antes de enviar (modal estilo WhatsApp Web).
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingCaption, setPendingCaption] = useState("");
  const [pendingSticker, setPendingSticker] = useState(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stickerRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const candidates = mentionCandidates ?? [];
  const filtered =
    mentionQuery != null && candidates.length
      ? candidates.filter((c) => c.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
      : [];

  // Preview URL da mídia pendente.
  const previewUrl = useMemo(
    () => (pendingFile ? URL.createObjectURL(pendingFile) : null),
    [pendingFile],
  );
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  // Foco no campo de legenda quando o modal abre.
  useEffect(() => { if (pendingFile) captionRef.current?.focus(); }, [pendingFile]);

  function stageFile(file: File, asSticker = false) {
    setPendingFile(file);
    setPendingCaption("");
    setPendingSticker(asSticker);
  }

  function confirmSend() {
    if (!pendingFile) return;
    // Se tem legenda, precisa enviar como FormData com caption — o onSendFile atual
    // não suporta caption; vamos passar o arquivo e a caption vai no body do sendMediaMessage.
    // Workaround: renomeia o arquivo adicionando a caption como propriedade custom.
    // Na verdade, o fluxo sendMediaMessage já lê "caption" do FormData — mas onSendFile(file)
    // é chamado sem caption. Vou criar um File com caption embutida no name? Não, melhor:
    // o inbox.tsx que chama handleSendFile monta o FormData. Vou passar via um hack limpo:
    // extendo File com propriedade caption.
    const f = pendingFile as File & { caption?: string };
    if (pendingCaption.trim()) {
      Object.defineProperty(f, "caption", { value: pendingCaption.trim(), writable: true });
    }
    onSendFile(f, pendingSticker);
    setPendingFile(null);
    setPendingCaption("");
  }

  function cancelPreview() {
    setPendingFile(null);
    setPendingCaption("");
  }

  function updateMentionQuery(val: string, caret: number) {
    const before = val.slice(0, caret);
    const m = before.match(/(?:^|\s)@([^\s@]{0,30})$/);
    setMentionQuery(candidates.length && m ? m[1] : null);
  }

  function pickMention(c: Mention) {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    const start = m ? caret - m[1].length - 1 : caret;
    const newText = text.slice(0, start) + `@${c.name} ` + after;
    setText(newText);
    setMentions((prev) => (prev.some((x) => x.phone === c.phone) ? prev : [...prev, c]));
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const pos = start + c.name.length + 2;
      ta?.focus();
      ta?.setSelectionRange(pos, pos);
    });
  }

  function submit() {
    const t = text.trim();
    if (!t) return;
    const used = mentions.filter((m) => t.includes(`@${m.name}`));
    onSend(t, used.length ? used : undefined);
    setText("");
    setMentions([]);
    setMentionQuery(null);
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) stageFile(f);
    e.target.value = "";
  }
  function pickStickerFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) stageFile(f, true);
    e.target.value = "";
  }

  async function toggleRecord() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => ev.data.size && chunksRef.current.push(ev.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const ext = (rec.mimeType || "audio/webm").includes("ogg") ? "ogg" : "webm";
        // Áudio gravado envia direto sem preview.
        onSendFile(new File([blob], `audio-${Date.now()}.${ext}`, { type: blob.type }));
        setRecording(false);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      alert("Não foi possível acessar o microfone.");
    }
  }

  const isImage = pendingFile?.type.startsWith("image/");
  const isVideo = pendingFile?.type.startsWith("video/");

  return (
    <>
      {/* ========== Modal de preview de mídia (estilo WhatsApp Web) ========== */}
      {pendingFile && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={cancelPreview}>
          <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <ImageIcon size={16} className="text-brand" />
                {isImage ? "Enviar imagem" : isVideo ? "Enviar vídeo" : "Enviar arquivo"}
              </div>
              <button onClick={cancelPreview} className="rounded-full p-1 text-ink-soft hover:bg-gray-100 hover:text-ink">
                <X size={18} />
              </button>
            </div>

            {/* Preview */}
            <div className="flex items-center justify-center bg-gray-900/5 p-6" style={{ minHeight: 240 }}>
              {isImage && previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="Preview" className="max-h-80 max-w-full rounded-lg object-contain" />
              ) : isVideo && previewUrl ? (
                <video src={previewUrl} controls className="max-h-80 max-w-full rounded-lg" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-ink-soft">
                  <FileUp size={40} />
                  <p className="text-sm font-medium">{pendingFile.name}</p>
                  <p className="text-xs">{(pendingFile.size / 1024).toFixed(0)} KB</p>
                </div>
              )}
            </div>

            {/* Caption + enviar */}
            <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-3">
              <input
                ref={captionRef}
                value={pendingCaption}
                onChange={(e) => setPendingCaption(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); confirmSend(); }
                  if (e.key === "Escape") cancelPreview();
                }}
                placeholder="Adicionar legenda..."
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand"
              />
              <button
                onClick={confirmSend}
                disabled={sending}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white transition hover:bg-brand-dark disabled:opacity-40"
                title="Enviar"
              >
                {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== Composer ========== */}
      <div className="relative flex items-end gap-2 border-t border-gray-100 bg-surface p-3">
        <input ref={fileRef} type="file" className="hidden" onChange={pickFile} />
        <input ref={stickerRef} type="file" accept="image/*" className="hidden" onChange={pickStickerFile} />

        {/* Dropdown de menções */}
        {filtered.length > 0 && (
          <div className="absolute bottom-16 left-3 z-30 w-64 overflow-hidden rounded-lg border border-gray-100 bg-surface py-1 shadow-xl">
            <p className="px-3 py-1 text-[10px] font-semibold uppercase text-ink-soft">Mencionar</p>
            {filtered.map((c) => (
              <button
                key={c.phone}
                onClick={() => pickMention(c)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-gray-50"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-light text-[10px] font-semibold text-brand">
                  {c.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="truncate">{c.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="relative">
          <button
            onClick={() => { setEmojiOpen((v) => !v); setAttachMenu(false); }}
            disabled={disabled || sending}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-gray-100 text-ink-soft transition hover:bg-gray-200 disabled:opacity-40"
            title="Emojis"
          >
            <Smile size={18} />
          </button>
          {emojiOpen && <EmojiPicker onPick={(e) => setText((t) => t + e)} onClose={() => setEmojiOpen(false)} />}
        </div>
        <div className="relative">
          <button
            onClick={() => setAttachMenu((v) => !v)}
            disabled={disabled || sending}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-gray-100 text-ink-soft transition hover:bg-gray-200 disabled:opacity-40"
            title="Anexar"
          >
            <Paperclip size={18} />
          </button>
          {attachMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setAttachMenu(false)} />
              <div className="absolute bottom-12 left-0 z-20 w-44 overflow-hidden rounded-lg border border-gray-100 bg-surface py-1 text-sm shadow-xl">
                <button onClick={() => { setAttachMenu(false); fileRef.current?.click(); }} className="flex w-full items-center gap-2 px-3 py-2 text-ink hover:bg-gray-50">
                  <FileUp size={15} /> Arquivo / mídia
                </button>
                <button onClick={() => { setAttachMenu(false); stickerRef.current?.click(); }} className="flex w-full items-center gap-2 px-3 py-2 text-ink hover:bg-gray-50">
                  <Sticker size={15} /> Figurinha
                </button>
                {onSendLocation && (
                  <button onClick={() => { setAttachMenu(false); onSendLocation(); }} className="flex w-full items-center gap-2 px-3 py-2 text-ink hover:bg-gray-50">
                    <MapPin size={15} /> Localização
                  </button>
                )}
                {onSendContact && (
                  <button onClick={() => { setAttachMenu(false); onSendContact(); }} className="flex w-full items-center gap-2 px-3 py-2 text-ink hover:bg-gray-50">
                    <UserPlus size={15} /> Contato
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            if (!text.trim() && v.trim()) onType?.();
            setText(v);
            updateMentionQuery(v, e.target.selectionStart ?? v.length);
          }}
          onClick={(e) => updateMentionQuery(text, (e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of Array.from(items)) {
              if (item.type.startsWith("image/") || item.type.startsWith("video/")) {
                e.preventDefault();
                const blob = item.getAsFile();
                if (blob) {
                  const ext = item.type.split("/")[1] ?? "png";
                  stageFile(new File([blob], `paste-${Date.now()}.${ext}`, { type: item.type }));
                }
                return;
              }
            }
          }}
          onDrop={(e) => {
            const files = e.dataTransfer?.files;
            if (files?.length) {
              e.preventDefault();
              stageFile(files[0]);
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (filtered.length > 0 && (e.key === "Enter" || e.key === "Tab")) {
              e.preventDefault();
              pickMention(filtered[0]);
              return;
            }
            if (e.key === "Enter" && (e.ctrlKey || e.shiftKey)) return;
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") setMentionQuery(null);
          }}
          rows={1}
          placeholder={recording ? "Gravando áudio..." : "Digite uma mensagem..."}
          disabled={disabled || recording}
          style={{ height: "auto" }}
          onInput={(e) => {
            const ta = e.currentTarget;
            ta.style.height = "auto";
            ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
          }}
          className="min-h-[42px] max-h-[200px] flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-gray-50"
        />

        {text.trim() ? (
          <button
            onClick={submit}
            disabled={disabled || sending}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-brand text-white transition hover:bg-brand-dark disabled:opacity-40"
            title="Enviar"
          >
            {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        ) : (
          <button
            onClick={toggleRecord}
            disabled={disabled || sending}
            className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-white transition disabled:opacity-40 ${
              recording ? "animate-pulse bg-danger hover:bg-red-600" : "bg-brand hover:bg-brand-dark"
            }`}
            title={recording ? "Parar e enviar" : "Gravar áudio"}
          >
            {recording ? <Square size={16} /> : <Mic size={18} />}
          </button>
        )}
      </div>
    </>
  );
}
