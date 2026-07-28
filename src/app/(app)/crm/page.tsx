import { Scroll } from "@/components/scroll";
import { PageHeader } from "@/components/ui";
import { CrmClient } from "@/components/crm-client";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";
import type { PipelineField, PipelineAutomation } from "@/components/crm-config";

export type Pipeline = { id: string; name: string; is_default: boolean };
export type Stage = {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  position: number;
  outcome: string | null;
};
export type CrmCard = {
  id: string;
  stage_id: string | null;
  deal_value: number | null;
  closed_won: boolean | null;
  assigned_user_id: string | null;
  last_message_at: string | null;
  contacts: { id: string; name: string | null; phone: string | null } | null;
};

async function getData() {
  if (PREVIEW_MODE) return { pipelines: [], stages: [], cards: [], agents: [], fields: [], automations: [], tags: [] };
  const sb = await createClient();

  // Visibilidade do CRM por usuário: 'all' vê tudo, 'own' só o que atende,
  // 'none' não vê nada (mesma ideia do policy_scope do Chatwoot).
  const { data: auth } = await sb.auth.getUser();
  const { data: me } = await sb
    .from("profiles")
    .select("id, role, crm_visibility")
    .eq("id", auth.user?.id ?? "")
    .maybeSingle();
  const perfil = me as { id: string; role: string; crm_visibility: string } | null;
  const visibilidade = perfil?.crm_visibility ?? "all";
  const vePorUsuario =
    visibilidade === "own" && !["admin", "supervisor"].includes(perfil?.role ?? "");

  let cardsQuery = sb
    .from("conversations")
    .select("id, stage_id, deal_value, closed_won, assigned_user_id, last_message_at, contacts(id, name, phone)")
    .not("stage_id", "is", null)
    .limit(500);
  if (vePorUsuario && perfil?.id) cardsQuery = cardsQuery.eq("assigned_user_id", perfil.id);

  const [{ data: pipelines }, { data: stages }, { data: cards }, { data: agents },
         { data: fields }, { data: automations }, { data: tags }] = await Promise.all([
    sb.from("pipelines").select("id, name, is_default").order("created_at"),
    sb.from("pipeline_stages").select("id, pipeline_id, name, color, position, outcome").order("position"),
    visibilidade === "none" ? Promise.resolve({ data: [] }) : cardsQuery,
    sb.from("profiles").select("id, name").order("name"),
    sb.from("pipeline_fields").select("id, pipeline_id, name, key, field_type, required, options").order("position"),
    sb.from("pipeline_automations").select("id, pipeline_id, name, trigger_type, actions, is_active, executions_count, last_executed_at").order("created_at"),
    sb.from("tags").select("id, name").order("name"),
  ]);

  return {
    pipelines: (pipelines as Pipeline[]) ?? [],
    stages: (stages as Stage[]) ?? [],
    cards: (cards as unknown as CrmCard[]) ?? [],
    agents: (agents as { id: string; name: string | null }[]) ?? [],
    fields: (fields as (PipelineField & { pipeline_id: string })[]) ?? [],
    automations: (automations as (PipelineAutomation & { pipeline_id: string })[]) ?? [],
    tags: (tags as { id: string; name: string }[]) ?? [],
  };
}

export default async function CrmPage() {
  const { pipelines, stages, cards, agents, fields, automations, tags } = await getData();
  return (
    <Scroll>
      <PageHeader
        title="CRM"
        subtitle="Funil de vendas: arraste os cards entre estágios, acompanhe o valor e automatize o que se repete."
      />
      <CrmClient pipelines={pipelines} stages={stages} cards={cards} agents={agents}
        fields={fields} automations={automations} tags={tags} />
    </Scroll>
  );
}
