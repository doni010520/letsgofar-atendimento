import { getChannels } from "@/lib/data/channels";
import { ChannelCard } from "@/components/channel-card";
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
        <h2 className="mb-4 text-lg font-semibold text-ink">Gerencie os canais</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {channels.map((c) => (
            <ChannelCard key={c.id} channel={c} />
          ))}
        </div>
      </section>
    </Scroll>
  );
}
