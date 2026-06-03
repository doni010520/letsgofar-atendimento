"use client";

import { useEffect, useState, useCallback } from "react";
import { X, CheckCircle2, RefreshCw, QrCode, KeyRound } from "lucide-react";
import { syncChannelStatus, refreshChannelConnection } from "@/app/(app)/canais/actions";
import { cn } from "@/lib/utils";
import type { Channel } from "@/lib/types";

function toDataUrl(qr?: string) {
  if (!qr) return undefined;
  return qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`;
}

export function QrConnectModal({
  channelId,
  initialQr,
  initialPhone,
  onClose,
  onConnected,
}: {
  channelId: string;
  initialQr?: string;
  initialPhone?: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [mode, setMode] = useState<"qr" | "code">("qr");
  const [qr, setQr] = useState<string | undefined>(initialQr);
  const [pairCode, setPairCode] = useState<string | undefined>();
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [status, setStatus] = useState<Channel["status"]>("connecting");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dbg, setDbg] = useState<string | null>(null);

  const connected = status === "connected";

  const refreshQr = useCallback(async () => {
    setBusy(true);
    try {
      const r = await refreshChannelConnection(channelId);
      setQr(r.qrCode);
      setStatus(r.status);
    } finally {
      setBusy(false);
    }
  }, [channelId]);

  async function genCode() {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setErr("Informe o número completo: DDI + DDD + número.");
      return;
    }
    setBusy(true);
    setErr(null);
    setDbg(null);
    setPairCode(undefined);
    try {
      let r = await refreshChannelConnection(channelId, digits);
      // UAZAPI às vezes retorna vazio na 1ª chamada — tenta de novo.
      if (!r.pairCode && r.status !== "connected") {
        await new Promise((res) => setTimeout(res, 1800));
        r = await refreshChannelConnection(channelId, digits);
      }
      setStatus(r.status);
      setDbg(r.debug ?? null);
      if (r.pairCode) setPairCode(r.pairCode);
      else if (r.status !== "connected")
        setErr(
          "Não consegui gerar o código agora. Verifique se o número está completo (DDI+DDD+9 dígitos) e tente de novo em alguns segundos — o WhatsApp limita a geração de códigos seguidos.",
        );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao gerar o código.");
    } finally {
      setBusy(false);
    }
  }

  // Ao abrir sem QR (canal existente), busca um QR na hora.
  useEffect(() => {
    if (!initialQr) refreshQr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling de status.
  useEffect(() => {
    const t = setInterval(async () => {
      const { status } = await syncChannelStatus(channelId);
      setStatus(status);
      if (status === "connected") {
        clearInterval(t);
        onConnected();
      }
    }, 4000);
    return () => clearInterval(t);
  }, [channelId, onConnected]);

  // Renova o QR a cada 25s (somente no modo QR).
  useEffect(() => {
    if (connected || mode !== "qr") return;
    const t = setInterval(refreshQr, 25000);
    return () => clearInterval(t);
  }, [refreshQr, connected, mode]);

  const img = toDataUrl(qr);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-card bg-surface p-6 text-center shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Conectar WhatsApp</h2>
          <button onClick={onClose} className="text-ink-soft hover:text-ink"><X size={18} /></button>
        </div>

        {connected ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle2 size={56} className="text-green-500" />
            <p className="font-medium text-ink">Conectado!</p>
            <button onClick={onConnected} className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              Concluir
            </button>
          </div>
        ) : (
          <>
            {/* Abas QR / Código */}
            <div className="mb-4 flex rounded-lg bg-gray-100 p-1 text-sm">
              <button
                onClick={() => setMode("qr")}
                className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition", mode === "qr" ? "bg-surface text-brand shadow-sm" : "text-ink-soft")}
              >
                <QrCode size={15} /> QR Code
              </button>
              <button
                onClick={() => setMode("code")}
                className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition", mode === "code" ? "bg-surface text-brand shadow-sm" : "text-ink-soft")}
              >
                <KeyRound size={15} /> Código
              </button>
            </div>

            {mode === "qr" ? (
              <>
                <p className="mb-3 text-xs text-ink-soft">
                  WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> e escaneie:
                </p>
                <div className="mx-auto flex h-56 w-56 items-center justify-center rounded-lg border border-gray-200 bg-white">
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt="QR Code" className="h-52 w-52" />
                  ) : (
                    <span className="text-xs text-ink-soft">Gerando QR Code...</span>
                  )}
                </div>
                <button onClick={refreshQr} disabled={busy} className="mx-auto mt-4 flex items-center gap-1 text-xs font-medium text-brand hover:underline disabled:opacity-50">
                  <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> Gerar novo código
                </button>
              </>
            ) : (
              <>
                <p className="mb-3 text-xs text-ink-soft">
                  No WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar com número de telefone</b>. Informe o número abaixo e digite o código gerado.
                </p>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="DDI + DDD + número (ex: 5573999998888)"
                  className="mb-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand"
                />
                {(() => {
                  const d = phone.replace(/\D/g, "");
                  if (d.startsWith("55") && d.length > 0 && d.length !== 13)
                    return (
                      <p className="mb-2 text-[11px] text-amber-600">
                        Número brasileiro tem 13 dígitos (55 + DDD + 9 dígitos). Você digitou {d.length}.
                      </p>
                    );
                  return <div className="mb-2" />;
                })()}
                {pairCode ? (
                  <div className="rounded-lg border border-brand/30 bg-brand-light py-4">
                    <p className="text-[11px] text-ink-soft">Digite este código no WhatsApp:</p>
                    <p className="mt-1 font-mono text-3xl font-bold tracking-[0.2em] text-brand">{pairCode}</p>
                  </div>
                ) : null}
                <button
                  onClick={genCode}
                  disabled={busy || phone.replace(/\D/g, "").length < 10}
                  className="mx-auto mt-4 flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> {busy ? "Gerando..." : pairCode ? "Gerar novo código" : "Gerar código"}
                </button>
                {err && <p className="mt-2 text-xs text-danger">{err}</p>}
                {err && dbg && <p className="mt-2 break-all text-[10px] font-mono text-ink-soft/70">{dbg}</p>}
              </>
            )}
            <p className="mt-3 text-[11px] text-ink-soft">Aguardando leitura...</p>
          </>
        )}
      </div>
    </div>
  );
}
