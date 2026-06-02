"use client";

import { useEffect, useState, useCallback } from "react";
import { X, CheckCircle2, RefreshCw } from "lucide-react";
import { syncChannelStatus, refreshChannelConnection } from "@/app/(app)/canais/actions";
import type { Channel } from "@/lib/types";

function toDataUrl(qr?: string) {
  if (!qr) return undefined;
  return qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`;
}

export function QrConnectModal({
  channelId,
  initialQr,
  onClose,
  onConnected,
}: {
  channelId: string;
  initialQr?: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [qr, setQr] = useState<string | undefined>(initialQr);
  const [status, setStatus] = useState<Channel["status"]>("connecting");
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await refreshChannelConnection(channelId);
      setQr(r.qrCode);
      setStatus(r.status);
    } finally {
      setRefreshing(false);
    }
  }, [channelId]);

  // Polling de status a cada 4s.
  useEffect(() => {
    let active = true;
    const t = setInterval(async () => {
      const { status } = await syncChannelStatus(channelId);
      if (!active) return;
      setStatus(status);
      if (status === "connected") {
        clearInterval(t);
        onConnected();
      }
    }, 4000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [channelId, onConnected]);

  // Renova o QR a cada 25s (o QR da UAZAPI expira).
  useEffect(() => {
    if (status === "connected") return;
    const t = setInterval(refresh, 25000);
    return () => clearInterval(t);
  }, [refresh, status]);

  const img = toDataUrl(qr);
  const connected = status === "connected";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-card bg-surface p-6 text-center shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Conectar WhatsApp</h2>
          <button onClick={onClose} className="text-ink-soft hover:text-ink">
            <X size={18} />
          </button>
        </div>

        {connected ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle2 size={56} className="text-green-500" />
            <p className="font-medium text-ink">Conectado!</p>
            <button
              onClick={onConnected}
              className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              Concluir
            </button>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-ink-soft">
              Abra o WhatsApp no celular → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> e
              escaneie o código abaixo.
            </p>
            <div className="mx-auto flex h-56 w-56 items-center justify-center rounded-lg border border-gray-200 bg-white">
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img} alt="QR Code" className="h-52 w-52" />
              ) : (
                <span className="text-xs text-ink-soft">Gerando QR Code...</span>
              )}
            </div>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="mx-auto mt-4 flex items-center gap-1 text-xs font-medium text-brand hover:underline disabled:opacity-50"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Gerar novo código
            </button>
            <p className="mt-3 text-[11px] text-ink-soft">Aguardando leitura...</p>
          </>
        )}
      </div>
    </div>
  );
}
