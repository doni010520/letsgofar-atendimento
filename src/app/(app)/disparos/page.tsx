import { Scroll } from "@/components/scroll";
import { PageHeader } from "@/components/ui";
import { BroadcastsClient } from "@/components/broadcasts-client";
import { createClient } from "@/lib/supabase/server";
import { getChannels } from "@/lib/data/channels";
import { PREVIEW_MODE } from "@/lib/mock";
import type { Channel } from "@/lib/types";

export type BroadcastRow = {
  id: string;
  title: string;
  message_template: string;
  status: string;
  channel_id: string | null;
  assigned_to: string | null;
  min_interval: number;
  max_interval: number;
  window_start: number;
  window_end: number;
  daily_cap: number;
  total_count: number;
  sent_count: number;
  failed_count: number;
  next_run_at: string | null;
  created_at: string;
};

async function getBroadcasts(): Promise<BroadcastRow[]> {
  if (PREVIEW_MODE) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("broadcasts")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as BroadcastRow[]) ?? [];
}

async function getAgents(): Promise<{ id: string; name: string | null }[]> {
  if (PREVIEW_MODE) return [];
  const sb = await createClient();
  const { data } = await sb.from("profiles").select("id, name").order("name");
  return (data as { id: string; name: string | null }[]) ?? [];
}

export default async function DisparosPage() {
  const [broadcasts, channels, agents]: [BroadcastRow[], Channel[], { id: string; name: string | null }[]] =
    await Promise.all([getBroadcasts(), getChannels(), getAgents()]);

  return (
    <Scroll>
      <PageHeader
        title="Disparos"
        subtitle="Envio em massa com espaçamento entre mensagens, personalização e acompanhamento de entrega."
      />
      <BroadcastsClient broadcasts={broadcasts} channels={channels} agents={agents} />
    </Scroll>
  );
}
