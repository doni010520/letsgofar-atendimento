import { getChannels } from "@/lib/data/channels";
import { ChannelsList } from "@/components/channels-list";
import { PageHeader, EmptyState } from "@/components/ui";
import { NewChannelDialog } from "@/components/new-channel-dialog";
import { Scroll } from "@/components/scroll";
import { SHOW_UAZAPI } from "@/lib/flags";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";

export default async function CanaisPage() {
  const all = await getChannels();
  // Esconde o canal não-oficial (UAZAPI): por flag global OU por usuário (profiles.hide_uazapi,
  // ex.: conta de teste do revisor da Meta durante o App Review).
  let hideUazapi = !SHOW_UAZAPI;
  if (!PREVIEW_MODE && !hideUazapi) {
    const session = await getSession();
    if (session?.userId) {
      const sb = await createClient();
      const { data: me } = await sb.from("profiles").select("hide_uazapi").eq("id", session.userId).maybeSingle();
      if ((me as { hide_uazapi?: boolean } | null)?.hide_uazapi) hideUazapi = true;
    }
  }
  const channels = hideUazapi ? all.filter((c) => c.type === "meta_cloud") : all;

  return (
    <Scroll>
      <PageHeader
        title="Canais"
        subtitle={`Gerencie todas as fontes de atendimento. ${channels.length} canal(is) cadastrado(s).`}
        action={<NewChannelDialog hideUazapi={hideUazapi} />}
      />

      {channels.length === 0 ? (
        <EmptyState
          title="Nenhum canal cadastrado"
          hint={hideUazapi
            ? "Clique em Cadastrar para conectar um WhatsApp pela API Oficial da Meta."
            : "Clique em Cadastrar para conectar um WhatsApp (UAZAPI por QR Code ou API Oficial da Meta)."}
        />
      ) : (
        <ChannelsList channels={channels} />
      )}
    </Scroll>
  );
}
