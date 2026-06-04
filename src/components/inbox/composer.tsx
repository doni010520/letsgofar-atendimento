"use client";

import { useRef, useState } from "react";
import { Send, Paperclip, Mic, Square, Loader2, MapPin, UserPlus, FileUp, Smile, Sticker } from "lucide-react";
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
}: {
  onSend: (text: string, mentions?: Mention[]) => void;
  onSendFile: (file: File, asSticker?: boolean) => void;
  onSendLocation?: () => void;
  onSendContact?: () => void;
  onType?: () => void;
  mentionCandidates?: Mention[];
  disabled?: boolean;
  sending?: boolean;
}) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stickerRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const candidates = mentionCandidates ?? [];
  const filtered =
    mentionQuery != null && candidates.length
      ? candidates.filter((c) => c.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
      : [];

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
    if (f) onSendFile(f);
    e.target.value = "";
  }
  function pickSticker(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) onSendFile(f, true);
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

  return (
    <div className="relative flex items-end gap-2 border-t border-gray-100 bg-surface p-3">
      <input ref={fileRef} type="file" accept="image/*,audio/*,video/*,application/pdf" className="hidden" onChange={pickFile} />
      <input ref={stickerRef} type="file" accept="image/*" className="hidden" onChange={pickSticker} />

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
          if (!text.trim() && v.trim()) onType?.(); // primeiro caractere → materializa rascunho
          setText(v);
          updateMentionQuery(v, e.target.selectionStart ?? v.length);
        }}
        onClick={(e) => updateMentionQuery(text, (e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (filtered.length > 0 && (e.key === "Enter" || e.key === "Tab")) {
            e.preventDefault();
            pickMention(filtered[0]);
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") setMentionQuery(null);
        }}
        rows={1}
        placeholder={recording ? "Gravando áudio..." : "Digite uma mensagem... ( @ menciona em grupos )"}
        disabled={disabled || recording}
        className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-gray-50"
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
  );
}
