-- =====================================================================
-- Tarefas (migrado do Chatwoot: agent_tasks)
-- Checklist, comentários, anexos, recorrência, vínculo com CRM.
-- =====================================================================

create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  created_by      uuid references profiles (id) on delete set null,
  assigned_to     uuid references profiles (id) on delete set null,

  -- vínculos opcionais
  contact_id      uuid references contacts (id) on delete set null,
  conversation_id uuid references conversations (id) on delete set null,
  pipeline_id     uuid references pipelines (id) on delete set null,

  title           text not null,
  description     text,
  priority        text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status          text not null default 'pending'
                    check (status in ('pending','in_progress','completed','cancelled')),
  due_date        date,
  due_time        time,
  reminder_at     timestamptz,

  -- recorrência
  recurrence_type   text not null default 'none'
                      check (recurrence_type in ('none','daily','weekly','monthly','custom')),
  recurrence_config jsonb not null default '{}',   -- {days:[1,3,5]}

  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_tasks_org_status on public.tasks(organization_id, status);
create index if not exists idx_tasks_assigned on public.tasks(assigned_to, status);
create index if not exists idx_tasks_due on public.tasks(due_date) where status in ('pending','in_progress');
create index if not exists idx_tasks_conversation on public.tasks(conversation_id);

-- Checklist
create table if not exists public.task_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  task_id         uuid not null references tasks (id) on delete cascade,
  title           text not null,
  completed       boolean not null default false,
  position        int not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists idx_task_items_task on public.task_items(task_id, position);

-- Comentários
create table if not exists public.task_comments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  task_id         uuid not null references tasks (id) on delete cascade,
  profile_id      uuid references profiles (id) on delete set null,
  content         text not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_task_comments_task on public.task_comments(task_id, created_at);

-- Etiquetas (reusa a tabela tags existente do mvf)
create table if not exists public.task_tags (
  task_id         uuid not null references tasks (id) on delete cascade,
  tag_id          uuid not null references tags (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  primary key (task_id, tag_id)
);

-- Anexos (arquivos no storage)
create table if not exists public.task_files (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  task_id         uuid not null references tasks (id) on delete cascade,
  path            text not null,
  filename        text not null,
  content_type    text,
  byte_size       bigint,
  created_at      timestamptz not null default now()
);

-- Preferência de alerta sonoro (B9)
alter table public.profiles
  add column if not exists task_audio_alert boolean not null default true;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.tasks enable row level security;
alter table public.task_items enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_tags enable row level security;
alter table public.task_files enable row level security;

do $$
declare t text;
begin
  foreach t in array array['tasks','task_items','task_comments','task_tags','task_files']
  loop
    execute format('drop policy if exists %1$s_org on public.%1$I', t);
    execute format(
      'create policy %1$s_org on public.%1$I for all
         using (organization_id = current_org_id())
         with check (organization_id = current_org_id())', t);
  end loop;
end $$;

-- Realtime para o sino de tarefas (C20)
alter publication supabase_realtime add table public.tasks;
