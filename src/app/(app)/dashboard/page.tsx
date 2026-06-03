import Link from "next/link";
import { Plus, Radio } from "lucide-react";
import { getChannels } from "@/lib/data/channels";
import { ChannelsList } from "@/components/channels-list";
import { Scroll } from "@/components/scroll";

export default async function DashboardPage() {
  const channels = await getChannels();

  return (
    <Scroll>
      <header className="py-8 text-center">
        <h1 className="text-3xl font-bold text-brand">Olá! Bem-vindo 👋</h1>
        <p className="mt-2 text-ink-soft">
          Aqui você está no controle. Use o menu lateral para navegar entre as funcionalidades.
        </p>
      </header>

      <section className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Gerencie os canais</h2>
          <Link
            href="/canais"
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
          >
            <Plus size={16} /> Conectar canal
          </Link>
        </div>

        {channels.length === 0 ? (
          <Link
            href="/canais"
            className="flex flex-col items-center justify-center rounded-card border border-dashed border-gray-300 bg-surface/50 py-16 text-center transition hover:border-brand hover:bg-brand-light/40"
          >
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-light text-brand">
              <Radio size={22} />
            </div>
            <p className="text-sm font-medium text-ink">Nenhum canal conectado ainda</p>
            <p className="mt-1 max-w-sm text-xs text-ink-soft">
              Conecte um número de WhatsApp (QR Code via UAZAPI ou API Oficial da Meta) para começar a atender.
            </p>
            <span className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
              <Plus size={16} /> Conectar agora
            </span>
          </Link>
        ) : (
          <ChannelsList channels={channels} />
        )}
      </section>
    </Scroll>
  );
}
