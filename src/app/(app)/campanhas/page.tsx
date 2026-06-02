import { Scroll } from "@/components/scroll";
import { PageHeader } from "@/components/ui";
import { CampaignsClient } from "@/components/campaigns-client";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";
import type { Campaign } from "@/lib/types";

async function getCampaigns(): Promise<Campaign[]> {
  if (PREVIEW_MODE)
    return [
      { id: "c1", organization_id: "preview", automation_id: null, name: "Promoção Fibra 500MB", status: "running", audience: [], scheduled_at: null, progress: 64, stats: {}, created_at: new Date().toISOString() },
      { id: "c2", organization_id: "preview", automation_id: null, name: "Aviso de manutenção", status: "done", audience: [], scheduled_at: null, progress: 100, stats: {}, created_at: new Date(Date.now() - 5 * 86400000).toISOString() },
    ];
  const sb = await createClient();
  const { data } = await sb.from("campaigns").select("*").order("created_at", { ascending: false });
  return (data as Campaign[]) ?? [];
}

export default async function CampanhasPage() {
  const campaigns = await getCampaigns();
  return (
    <Scroll>
      <PageHeader title="Gerenciar Campanhas" subtitle="Campanhas de disparo via fluxos de automação." />
      <CampaignsClient campaigns={campaigns} />
    </Scroll>
  );
}
