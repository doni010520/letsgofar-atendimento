"use client";

import { useRef, useState } from "react";
import { Send, Paperclip, Mic, Square, Loader2, MapPin, UserPlus, FileUp } from "lucide-react";

export function Composer({
  onSend,
  onSendFile,
  onSendLocation,
  onSendContact,
  disabled,
  sending,
}: {
  onSend: (text: string) => void;
  onSendFile: (file: File) => void;
  onSendLocation?: () => void;
  onSendContact?: () => void;
  disabled?: boolean;
  sending?: boolean;
}) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  function submit() {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) onSendFile(f);
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
    <div className="flex items-end gap-2 border-t border-gray-100 bg-surface p-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*,audio/*,video/*,application/pdf"
        className="hidden"
        onChange={pickFile}
      />
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
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder={recording ? "Gravando áudio..." : "Digite uma mensagem..."}
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
