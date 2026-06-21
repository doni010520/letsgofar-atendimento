import { getChannels } from "@/lib/data/channels";
import { ChannelsList } from "@/components/channels-list";
import { PageHeader, EmptyState } from "@/components/ui";
import { NewChannelDialog } from "@/components/new-channel-dialog";
import { Scroll } from "@/components/scroll";
import { SHOW_UAZAPI } from "@/lib/flags";

export default async function CanaisPage() {
  const all = await getChannels();
  // Durante o App Review da Meta, escondemos canais não-oficiais (UAZAPI) da UI.
  const channels = SHOW_UAZAPI ? all : all.filter((c) => c.type === "meta_cloud");

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
          hint={SHOW_UAZAPI
            ? "Clique em Cadastrar para conectar um WhatsApp (UAZAPI por QR Code ou API Oficial da Meta)."
            : "Clique em Cadastrar para conectar um WhatsApp pela API Oficial da Meta."}
        />
      ) : (
        <ChannelsList channels={channels} />
      )}
    </Scroll>
  );
}
