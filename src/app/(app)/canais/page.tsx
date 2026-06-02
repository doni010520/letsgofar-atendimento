import { getChannels } from "@/lib/data/channels";
import { ChannelCard } from "@/components/channel-card";
import { PageHeader, EmptyState } from "@/components/ui";
import { NewChannelDialog } from "@/components/new-channel-dialog";
import { Scroll } from "@/components/scroll";

export default async function CanaisPage() {
  const channels = await getChannels();

  return (
    <Scroll>
      <PageHeader
        title="Canais"
        subtitle={`Gerencie todas as fontes de atendimento. ${channels.length} canal(is) cadastrado(s).`}
        action={<NewChannelDialog />}
      />

      {channels.length === 0 ? (
        <EmptyState
          title="Nenhum canal cadastrado"
          hint="Clique em Cadastrar para conectar um WhatsApp (UAZAPI por QR Code ou API Oficial da Meta)."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {channels.map((c) => (
            <ChannelCard key={c.id} channel={c} />
          ))}
        </div>
      )}
    </Scroll>
  );
}
