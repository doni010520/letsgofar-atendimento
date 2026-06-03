"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Power, Trash2, Plug } from "lucide-react";
import { ChannelCard } from "@/components/channel-card";
import { QrConnectModal } from "@/components/qr-connect-modal";
import { disconnectChannel, deleteChannel } from "@/app/(app)/canais/actions";
import type { Channel } from "@/lib/types";

export function ChannelsList({ channels }: { channels: Channel[] }) {
  const router = useRouter();
  const [connect, setConnect] = useState<{ id: string; phone?: string } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function onDisconnect(id: string) {
    setMenu(null);
    setBusy(id);
    try { await disconnectChannel(id); router.refresh(); } finally { setBusy(null); }
  }
  async function onDelete(c: Channel) {
    setMenu(null);
    if (!confirm(`Excluir o canal "${c.name}"? Isso remove a conexão e o histórico vinculado.`)) return;
    setBusy(c.id);
    try { await deleteChannel(c.id); router.refresh(); } finally { setBusy(null); }
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {channels.map((c) => {
          const clickable = c.type !== "meta_cloud"; // UAZAPI: clicar reabre conexão (QR/código)
          return (
            <div key={c.id} className="relative">
              <button
                type="button"
                onClick={() => clickable && setConnect({ id: c.id, phone: c.phone ?? undefined })}
                disabled={!clickable || busy === c.id}
                className={clickable ? "block w-full cursor-pointer text-left transition hover:opacity-90 focus:outline-none" : "block w-full cursor-default text-left"}
                title={clickable ? (c.status === "connected" ? "Ver conexão" : "Conectar / ler QR ou código") : undefined}
              >
                <ChannelCard channel={c} />
              </button>

              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMenu(menu === c.id ? null : c.id); }}
                className="absolute right-3 top-3 rounded-lg p-1.5 text-ink-soft hover:bg-gray-100 hover:text-ink"
                title="Ações"
              >
                <MoreVertical size={18} />
              </button>

              {menu === c.id && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />
                  <div className="absolute right-3 top-11 z-20 w-44 overflow-hidden rounded-lg border border-gray-100 bg-surface py-1 shadow-xl">
                    {clickable && (
                      <button onClick={() => { setMenu(null); setConnect({ id: c.id, phone: c.phone ?? undefined }); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-gray-50">
                        <Plug size={14} /> Conectar
                      </button>
                    )}
                    <button onClick={() => onDisconnect(c.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-gray-50">
                      <Power size={14} /> Desconectar
                    </button>
                    <button onClick={() => onDelete(c)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-red-50">
                      <Trash2 size={14} /> Excluir canal
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {connect && (
        <QrConnectModal
          channelId={connect.id}
          initialPhone={connect.phone}
          onClose={() => { setConnect(null); router.refresh(); }}
          onConnected={() => { setConnect(null); router.refresh(); }}
        />
      )}
    </>
  );
}
