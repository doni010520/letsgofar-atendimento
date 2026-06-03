"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChannelCard } from "@/components/channel-card";
import { QrConnectModal } from "@/components/qr-connect-modal";
import type { Channel } from "@/lib/types";

export function ChannelsList({ channels }: { channels: Channel[] }) {
  const router = useRouter();
  const [connect, setConnect] = useState<{ id: string; phone?: string } | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {channels.map((c) => {
          const isMeta = c.type === "meta_cloud";
          const clickable = !isMeta; // UAZAPI: clicar reabre conexão (QR/código)
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => clickable && setConnect({ id: c.id, phone: c.phone ?? undefined })}
              disabled={!clickable}
              className={clickable ? "text-left transition hover:opacity-90 focus:outline-none" : "text-left"}
              title={clickable ? (c.status === "connected" ? "Ver conexão" : "Conectar / ler QR ou código") : undefined}
            >
              <ChannelCard channel={c} />
            </button>
          );
        })}
      </div>

      {connect && (
        <QrConnectModal
          channelId={connect.id}
          initialPhone={connect.phone}
          onClose={() => {
            setConnect(null);
            router.refresh();
          }}
          onConnected={() => {
            setConnect(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
