-- =====================================================================
-- Contratos com assinatura eletrônica (migrado do Chatwoot: contracts)
-- Base legal: MP 2.200-2/2001 e Lei 14.063/2020 (assinatura simples).
-- =====================================================================

create table if not exists public.contract_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  created_by      uuid references profiles (id) on delete set null,
  name            text not null,
  description     text,
  content_html    text not null,
  variable_fields jsonb not null default '[]',   -- [{key,label,type}]
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.contracts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  created_by      uuid references profiles (id) on delete set null,
  template_id     uuid references contract_templates (id) on delete set null,
  contact_id      uuid references contacts (id) on delete set null,

  number          text not null,
  title           text not null,
  content_html    text not null,
  variables       jsonb not null default '{}',

  status          text not null default 'draft'
                    check (status in ('draft','pending','partially_signed','signed',
                                      'refused','expired','cancelled')),
  document_hash   text,

  plan_start_date date,
  plan_end_date   date,

  sent_at         timestamptz,
  signed_at       timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, number)
);

create index if not exists idx_contracts_org_status on public.contracts(organization_id, status);
create index if not exists idx_contracts_plan_end on public.contracts(plan_end_date);

create table if not exists public.contract_signers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  contract_id     uuid not null references contracts (id) on delete cascade,
  name            text not null,
  email           text not null,
  phone           text,
  document        text,                      -- CPF
  role            text not null default 'contractor' check (role in ('contractor','company','witness')),
  sign_token      text not null unique,
  status          text not null default 'pending' check (status in ('pending','signed','refused')),
  sign_order      int not null default 1,
  auto_sign       boolean not null default false,
  viewed_at       timestamptz,
  signed_at       timestamptz,
  refused_at      timestamptz,
  refusal_reason  text,
  created_at      timestamptz not null default now(),
  unique (contract_id, email)
);

create index if not exists idx_contract_signers_token on public.contract_signers(sign_token);

-- Evidências da assinatura (o que dá validade jurídica)
create table if not exists public.contract_signatures (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations (id) on delete cascade,
  signer_id         uuid not null references contract_signers (id) on delete cascade,
  ip_address        text,
  user_agent        text,
  geolocation       jsonb not null default '{}',
  browser_fingerprint text,
  confirmation_name text,
  confirmation_document text,
  signature_hash    text,
  signed_at         timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create table if not exists public.contract_activities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  contract_id     uuid not null references contracts (id) on delete cascade,
  signer_id       uuid references contract_signers (id) on delete set null,
  profile_id      uuid references profiles (id) on delete set null,
  kind            text not null,       -- created, sent, viewed, signed, refused, completed...
  metadata        jsonb not null default '{}',
  ip_address      text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_contract_activities_contract
  on public.contract_activities(contract_id, created_at desc);

-- Numeração sequencial por organização: CTR-2026-00001
create or replace function next_contract_number(org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  y text := to_char(now(), 'YYYY');
  seq int;
begin
  perform pg_advisory_xact_lock(hashtext(org::text || y));
  select coalesce(max(split_part(number, '-', 3)::int), 0) + 1
    into seq
    from contracts
   where organization_id = org and number like 'CTR-' || y || '-%';
  return 'CTR-' || y || '-' || lpad(seq::text, 5, '0');
end;
$$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.contract_templates enable row level security;
alter table public.contracts enable row level security;
alter table public.contract_signers enable row level security;
alter table public.contract_signatures enable row level security;
alter table public.contract_activities enable row level security;

do $$
declare t text;
begin
  foreach t in array array['contract_templates','contracts','contract_signers',
                           'contract_signatures','contract_activities']
  loop
    execute format('drop policy if exists %1$s_org on public.%1$I', t);
    execute format(
      'create policy %1$s_org on public.%1$I for all
         using (organization_id = current_org_id())
         with check (organization_id = current_org_id())', t);
  end loop;
end $$;

-- A página pública de assinatura acessa por token via service role
-- (server-side), então não é preciso policy anônima aqui.
