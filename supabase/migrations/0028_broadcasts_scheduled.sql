-- =====================================================================
-- Disparos (broadcast) + Mensagens Agendadas
-- Migrado do Chatwoot: broadcast_campaigns / scheduled_messages.
-- Inclui as lições aprendidas: pacing anti-ban, janela, teto diário e
-- prova de entrega (sem id do provedor = NÃO entregue).
-- =====================================================================

create table if not exists public.broadcasts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  created_by      uuid references profiles (id) on delete set null,
  channel_id      uuid references channels (id) on delete set null,
  -- conversas criadas pelo disparo já nascem atribuídas a essa pessoa
  assigned_to     uuid references profiles (id) on delete set null,

  title            text not null,
  message_template text not null,          -- suporta {primeiro_nome} e spintax {a|b}

  status          text not null default 'draft'
                    check (status in ('draft','running','paused','completed','cancelled')),

  -- ritmo (anti-bloqueio)
  min_interval    int not null default 300,   -- segundos
  max_interval    int not null default 360,
  window_start    int not null default 9,     -- hora local 0-23
  window_end      int not null default 18,
  daily_cap       int not null default 50,
  timezone        text not null default 'America/Sao_Paulo',

  sent_today      int not null default 0,
  sent_today_on   date,

  total_count     int not null default 0,
  sent_count      int not null default 0,
  failed_count    int not null default 0,

  next_run_at     timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  check (max_interval >= min_interval)
);

create index if not exists idx_broadcasts_org_status on public.broadcasts(organization_id, status);
create index if not exists idx_broadcasts_due on public.broadcasts(next_run_at) where status = 'running';

create table if not exists public.broadcast_recipients (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  broadcast_id    uuid not null references broadcasts (id) on delete cascade,
  contact_id      uuid references contacts (id) on delete set null,

  phone           text not null,            -- só dígitos, com DDI
  name            text,
  merge_fields    jsonb not null default '{}',

  status          text not null default 'pending'
                    check (status in ('pending','sent','failed','skipped')),
  personalized_message text,
  conversation_id uuid references conversations (id) on delete set null,
  external_id     text,                     -- id do provedor = prova de entrega
  error           text,
  position        int not null default 0,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_broadcast_recipients_next
  on public.broadcast_recipients(broadcast_id, status, position);

-- ── Mensagens agendadas ──────────────────────────────────────────────
create table if not exists public.scheduled_messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  created_by      uuid references profiles (id) on delete set null,
  conversation_id uuid not null references conversations (id) on delete cascade,
  contact_id      uuid references contacts (id) on delete set null,

  content         text not null,
  attachments     jsonb not null default '[]',
  scheduled_at    timestamptz not null,
  status          text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_scheduled_messages_due
  on public.scheduled_messages(scheduled_at) where status = 'pending';

-- ── Vigia de entregas: mensagens de saída sem confirmação ────────────
-- (mensagem sem external_id do provedor após X min = não entregue)
alter table public.messages
  add column if not exists delivery_checked_at timestamptz;

create index if not exists idx_messages_delivery_watch
  on public.messages(created_at)
  where direction = 'out' and external_id is null;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;
alter table public.scheduled_messages enable row level security;

do $$
declare t text;
begin
  foreach t in array array['broadcasts','broadcast_recipients','scheduled_messages']
  loop
    execute format('drop policy if exists %1$s_org on public.%1$I', t);
    execute format(
      'create policy %1$s_org on public.%1$I for all
         using (organization_id = current_org_id())
         with check (organization_id = current_org_id())', t);
  end loop;
end $$;
