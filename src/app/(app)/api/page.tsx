import { Scroll } from "@/components/scroll";
import { PageHeader } from "@/components/ui";
import { ApiKeysClient } from "@/components/api-keys-client";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";

async function getKeys() {
  if (PREVIEW_MODE)
    return [{ id: "k1", name: "Integração n8n", created_at: new Date().toISOString(), last_used_at: null }];
  const sb = await createClient();
  const { data } = await sb.from("api_keys").select("id, name, created_at, last_used_at").order("created_at", { ascending: false });
  return data ?? [];
}

export default async function ApiKeysPage() {
  const keys = await getKeys();
  return (
    <Scroll>
      <PageHeader title="Chaves de API" subtitle="Gere chaves para integrar sistemas externos ao MVF." />
      <ApiKeysClient keys={keys} />
    </Scroll>
  );
}
