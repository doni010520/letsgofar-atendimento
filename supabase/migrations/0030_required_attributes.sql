-- =====================================================================
-- Atributos obrigatórios ao encerrar a conversa (B6)
-- Migrado do fork: o atendente só resolve depois de preencher os campos
-- que a operação exige (ex.: origem do lead, motivo do contato).
-- =====================================================================

create table if not exists public.required_attributes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  key             text not null,
  label           text not null,
  attribute_type  text not null default 'text'
                    check (attribute_type in ('text','number','link','date','list','checkbox')),
  options         jsonb not null default '[]',   -- para 'list'
  required        boolean not null default true,
  position        int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, key)
);

-- Valores preenchidos no encerramento
alter table public.conversations
  add column if not exists resolution_attributes jsonb not null default '{}';

alter table public.required_attributes enable row level security;

drop policy if exists required_attributes_org on public.required_attributes;
create policy required_attributes_org on public.required_attributes for all
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());
