import { Scroll } from "@/components/scroll";
import { PageHeader } from "@/components/ui";
import { ContractsClient } from "@/components/contracts-client";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";

export type ContractRow = {
  id: string;
  number: string;
  title: string;
  status: string;
  plan_start_date: string | null;
  plan_end_date: string | null;
  created_at: string;
  contract_signers?: { id: string; name: string; email: string; status: string; sign_token: string }[];
};

export type TemplateRow = { id: string; name: string; description: string | null; content_html: string };

async function getData() {
  if (PREVIEW_MODE) return { contracts: [], templates: [] };
  const sb = await createClient();
  const [{ data: contracts }, { data: templates }] = await Promise.all([
    sb
      .from("contracts")
      .select("id, number, title, status, plan_start_date, plan_end_date, created_at, contract_signers(id, name, email, status, sign_token)")
      .order("created_at", { ascending: false }),
    sb.from("contract_templates").select("id, name, description, content_html").eq("is_active", true).order("name"),
  ]);
  return {
    contracts: (contracts as ContractRow[]) ?? [],
    templates: (templates as TemplateRow[]) ?? [],
  };
}

export default async function ContratosPage() {
  const { contracts, templates } = await getData();
  return (
    <Scroll>
      <PageHeader
        title="Contratos"
        subtitle="Gere contratos a partir de modelos e colete a assinatura eletrônica com registro de evidências."
      />
      <ContractsClient contracts={contracts} templates={templates} />
    </Scroll>
  );
}
