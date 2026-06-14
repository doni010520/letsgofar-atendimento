-- Módulo Financeiro: faturas da organização (assinatura/cobranças).
create table if not exists invoices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  description     text not null,
  amount          numeric(12,2) not null default 0,
  due_date        date,
  status          text not null default 'open' check (status in ('open','paid','overdue','cancelled')),
  paid_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists invoices_org_idx on invoices (organization_id, status);

alter table invoices enable row level security;

drop policy if exists invoices_all on invoices;
create policy invoices_all on invoices
  for all
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());
