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

/** Campo que o modelo pede para preencher (vem dos marcadores do HTML). */
export type CampoModelo = { key: string; label: string; type: string };
export type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  content_html: string;
  variable_fields: CampoModelo[] | null;
};

async function getData() {
  if (PREVIEW_MODE) return { contracts: [
    { id: "d582f5d0-a884-4288-9aa7-45e04435f98b", number: "CTR-2026-00035", title: "CONTRATO DE AULAS EM GRUPO", status: "pending", plan_start_date: "2026-08-27", plan_end_date: "2027-02-27", created_at: "2026-08-18T23:52:11Z", contract_signers: [{ id: "61507101-5300-4eab-8bed-1420ac4961b0", name: "LUCAS LUIZ DA SILVA", email: "lucas@example.com", status: "pending", sign_token: "fdd38ea1-6d5f-4030-9690-f00bf0c4f7bd" }] },
    { id: "2ccddd24-b398-4f98-b74d-6869bc115956", number: "CTR-2026-00036", title: "EXECUTIVE CLASS", status: "draft", plan_start_date: null, plan_end_date: null, created_at: "2026-08-19T23:42:49Z", contract_signers: [] },
  ] as ContractRow[], templates: [] };
  const sb = await createClient();
  const [{ data: contracts }, { data: templates }] = await Promise.all([
    sb
      .from("contracts")
      .select("id, number, title, status, plan_start_date, plan_end_date, created_at, contract_signers(id, name, email, status, sign_token)")
      .order("created_at", { ascending: false }),
    sb.from("contract_templates").select("id, name, description, content_html, variable_fields").eq("is_active", true).order("name"),
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
