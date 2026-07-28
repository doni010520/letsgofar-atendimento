-- =====================================================================
-- CRM / Kanban  (migrado do Chatwoot: kanban_*)
-- Funil de vendas em cima de conversas e contatos.
-- =====================================================================

create table if not exists public.pipelines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  description     text,
  kind            text not null default 'both' check (kind in ('conversations','contacts','both')),
  is_default      boolean not null default false,
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.pipeline_stages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  pipeline_id     uuid not null references pipelines (id) on delete cascade,
  name            text not null,
  color           text not null default '#6366F1',
  position        int not null default 0,
  -- estágio terminal marca ganho/perdido automaticamente
  outcome         text check (outcome in ('won','lost')),
  created_at      timestamptz not null default now(),
  unique (pipeline_id, name)
);

create index if not exists idx_pipeline_stages_pipeline on public.pipeline_stages(pipeline_id, position);

-- Campos de CRM direto na conversa (C13/C14 do inventário)
alter table public.conversations
  add column if not exists stage_id    uuid references pipeline_stages (id) on delete set null,
  add column if not exists deal_value  numeric(12,2),
  add column if not exists closed_at   timestamptz,
  add column if not exists closed_won  boolean;

-- Contato também entra no funil (herança conversa ← contato)
alter table public.contacts
  add column if not exists stage_id    uuid references pipeline_stages (id) on delete set null,
  add column if not exists deal_value  numeric(12,2);

create index if not exists idx_conversations_stage on public.conversations(stage_id) where stage_id is not null;
create index if not exists idx_contacts_stage on public.contacts(stage_id) where stage_id is not null;

-- ── Campos personalizados por pipeline ───────────────────────────────
create table if not exists public.pipeline_fields (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  pipeline_id     uuid not null references pipelines (id) on delete cascade,
  name            text not null,
  key             text not null,
  field_type      text not null default 'text'
                    check (field_type in ('text','number','date','select','checkbox','link')),
  options         jsonb not null default '[]',
  required        boolean not null default false,
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  unique (pipeline_id, key)
);

create table if not exists public.pipeline_field_values (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  field_id        uuid not null references pipeline_fields (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete cascade,
  contact_id      uuid references contacts (id) on delete cascade,
  value           text,
  updated_at      timestamptz not null default now(),
  check (conversation_id is not null or contact_id is not null)
);

create index if not exists idx_field_values_conv on public.pipeline_field_values(conversation_id);
create index if not exists idx_field_values_contact on public.pipeline_field_values(contact_id);

-- ── Atividades / timeline do CRM ─────────────────────────────────────
create table if not exists public.crm_activities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete cascade,
  contact_id      uuid references contacts (id) on delete cascade,
  profile_id      uuid references profiles (id) on delete set null,
  kind            text not null,   -- stage_changed, value_changed, won, lost, task_created...
  title           text,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create index if not exists idx_crm_activities_conv on public.crm_activities(conversation_id, created_at desc);

-- ── Motor de automações do funil ─────────────────────────────────────
create table if not exists public.pipeline_automations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  pipeline_id     uuid not null references pipelines (id) on delete cascade,
  name            text not null,
  trigger_type    text not null check (trigger_type in (
                    'stage_changed','deal_won','deal_lost','deal_value_changed',
                    'conversation_added','task_overdue','task_completed','lead_stale')),
  trigger_config  jsonb not null default '{}',
  conditions      jsonb not null default '[]',   -- [{field, operator, value}]
  actions         jsonb not null default '[]',   -- [{type, config}]
  is_active       boolean not null default true,
  execution_order int not null default 0,
  executions_count int not null default 0,
  last_executed_at timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_pipeline_automations_trigger
  on public.pipeline_automations(pipeline_id, trigger_type) where is_active;

create table if not exists public.pipeline_automation_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  automation_id   uuid not null references pipeline_automations (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete set null,
  status          text not null default 'success' check (status in ('success','failed','skipped')),
  result          jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

-- ── Permissões de CRM por usuário ────────────────────────────────────
alter table public.profiles
  add column if not exists crm_visibility text not null default 'all'
    check (crm_visibility in ('all','own','team','none'));

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.pipeline_fields enable row level security;
alter table public.pipeline_field_values enable row level security;
alter table public.crm_activities enable row level security;
alter table public.pipeline_automations enable row level security;
alter table public.pipeline_automation_logs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['pipelines','pipeline_stages','pipeline_fields','pipeline_field_values',
                           'crm_activities','pipeline_automations','pipeline_automation_logs']
  loop
    execute format('drop policy if exists %1$s_org on public.%1$I', t);
    execute format(
      'create policy %1$s_org on public.%1$I for all
         using (organization_id = current_org_id())
         with check (organization_id = current_org_id())', t);
  end loop;
end $$;
