"use client";

import { useRef, useState } from "react";
import { Send, Paperclip, Mic, Square, Loader2 } from "lucide-react";

export function Composer({
  onSend,
  onSendFile,
  disabled,
  sending,
}: {
  onSend: (text: string) => void;
  onSendFile: (file: File) => void;
  disabled?: boolean;
  sending?: boolean;
}) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
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
      <button
        onClick={() => fileRef.current?.click()}
        disabled={disabled || sending}
        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-gray-100 text-ink-soft transition hover:bg-gray-200 disabled:opacity-40"
        title="Anexar arquivo"
      >
        <Paperclip size={18} />
      </button>

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
