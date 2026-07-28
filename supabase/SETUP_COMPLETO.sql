-- =====================================================================
-- LET'S GO FAR ATENDIMENTO — todas as migrations na ordem (0001 → 0030)
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- Idempotente: pode rodar de novo sem quebrar (usa IF NOT EXISTS).
-- =====================================================================


-- ======================================================================
-- 0001_init.sql
-- ======================================================================

-- =====================================================================
-- Chatmix clone — schema inicial (multi-tenant + RLS)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Organizações (inquilinos / tenants)
-- ---------------------------------------------------------------------
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  document    text,                       -- CNPJ
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Perfis (atendentes / usuários) — 1:1 com auth.users
-- ---------------------------------------------------------------------
create table profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid references organizations (id) on delete cascade,
  name            text not null default '',
  email           text,
  role            text not null default 'agent' check (role in ('admin','supervisor','agent')),
  department_id   uuid,
  avatar_url      text,
  status          text not null default 'offline' check (status in ('online','away','offline')),
  whatsapp        text,
  notify          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- Função helper: org do usuário autenticado (SECURITY DEFINER evita recursão de RLS).
create or replace function current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from profiles where id = auth.uid();
$$;

create or replace function current_role_is(target text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = target);
$$;

-- ---------------------------------------------------------------------
-- Departamentos
-- ---------------------------------------------------------------------
create table departments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  color           text default '#00a8ff',
  created_at      timestamptz not null default now()
);
alter table profiles
  add constraint profiles_department_fk
  foreign key (department_id) references departments (id) on delete set null;

-- ---------------------------------------------------------------------
-- Canais (conexões WhatsApp)
-- ---------------------------------------------------------------------
create table channels (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  type            text not null check (type in ('meta_cloud','uazapi')),
  phone           text,
  status          text not null default 'pending'
                    check (status in ('pending','connecting','connected','disconnected','error')),
  external_id     text,                    -- phone_number_id (Meta) ou instance (UAZAPI)
  credentials     jsonb not null default '{}',  -- tokens/segredos (criptografar em camada de app)
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Contatos (clientes)
-- ---------------------------------------------------------------------
create table contacts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text,
  phone           text not null,
  avatar_url      text,
  custom_fields   jsonb not null default '{}',
  notes           text,
  created_at      timestamptz not null default now(),
  unique (organization_id, phone)
);

-- ---------------------------------------------------------------------
-- Conversas (atendimentos)
-- ---------------------------------------------------------------------
create table conversations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  channel_id       uuid not null references channels (id) on delete cascade,
  contact_id       uuid not null references contacts (id) on delete cascade,
  status           text not null default 'queued'
                     check (status in ('bot','queued','open','closed')),
  assigned_user_id uuid references profiles (id) on delete set null,
  department_id    uuid references departments (id) on delete set null,
  protocol         text,
  last_message_at  timestamptz,
  opened_at        timestamptz default now(),
  closed_at        timestamptz,
  satisfaction     int,
  created_at       timestamptz not null default now()
);
create index on conversations (organization_id, status, last_message_at desc);

-- ---------------------------------------------------------------------
-- Mensagens
-- ---------------------------------------------------------------------
create table messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  direction       text not null check (direction in ('in','out')),
  sender_type     text not null check (sender_type in ('contact','agent','bot','system')),
  sender_id       uuid,                    -- profile id se agente
  content_type    text not null default 'text'
                    check (content_type in ('text','image','audio','video','document','location','contact','template','sticker')),
  body            text,
  media_url       text,
  status          text not null default 'sent'
                    check (status in ('pending','sent','delivered','read','failed')),
  external_id     text,                    -- id da mensagem no provedor
  created_at      timestamptz not null default now()
);
create index on messages (conversation_id, created_at);

-- ---------------------------------------------------------------------
-- Tags / classificações (atendimento, cliente, status)
-- ---------------------------------------------------------------------
create table tags (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  color           text default '#00a8ff',
  scope           text not null default 'conversation'
                    check (scope in ('conversation','contact','status')),
  created_at      timestamptz not null default now()
);
create table conversation_tags (
  conversation_id uuid not null references conversations (id) on delete cascade,
  tag_id          uuid not null references tags (id) on delete cascade,
  primary key (conversation_id, tag_id)
);
create table contact_tags (
  contact_id uuid not null references contacts (id) on delete cascade,
  tag_id     uuid not null references tags (id) on delete cascade,
  primary key (contact_id, tag_id)
);

-- ---------------------------------------------------------------------
-- Mensagens rápidas / modelos / macros
-- ---------------------------------------------------------------------
create table quick_replies (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  title           text not null,
  content         text not null,
  shortcut        text,
  kind            text not null default 'model' check (kind in ('model','macro','auto')),
  created_at      timestamptz not null default now()
);

-- Templates Meta (HSM)
create table wa_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  channel_id      uuid references channels (id) on delete cascade,
  name            text not null,
  language        text not null default 'pt_BR',
  category        text,
  status          text default 'pending',
  components      jsonb not null default '[]',
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Automações (fluxos de chatbot) e campanhas
-- ---------------------------------------------------------------------
create table automations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  channel_id      uuid references channels (id) on delete set null,
  name            text not null,
  trigger         text,
  flow            jsonb not null default '{"nodes":[],"edges":[]}',
  active          boolean not null default false,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create table campaigns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  automation_id   uuid references automations (id) on delete set null,
  name            text not null,
  status          text not null default 'draft'
                    check (status in ('draft','scheduled','running','paused','done','failed')),
  audience        jsonb not null default '[]',
  scheduled_at    timestamptz,
  progress        int not null default 0,
  stats           jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Planos de serviço (do provedor), API keys, integrações, IA, logs
-- ---------------------------------------------------------------------
create table plans (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  price           numeric(12,2),
  description     text,
  created_at      timestamptz not null default now()
);
create table api_keys (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  key_hash        text not null,
  scopes          text[] not null default '{}',
  last_used_at    timestamptz,
  created_at      timestamptz not null default now()
);
create table integrations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  type            text not null,           -- ex: 'sgp'
  config          jsonb not null default '{}',
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create table ai_agents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  channel_id      uuid references channels (id) on delete set null,
  name            text not null,
  prompt          text,
  model           text default 'claude-sonnet-4-6',
  config          jsonb not null default '{}',
  active          boolean not null default false,
  created_at      timestamptz not null default now()
);
create table audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id         uuid references profiles (id) on delete set null,
  action          text not null,
  entity          text,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);


-- ======================================================================
-- 0002_rls.sql
-- ======================================================================

-- =====================================================================
-- RLS + onboarding
-- =====================================================================

-- Cria automaticamente um profile quando um usuário se cadastra no Auth.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Onboarding: cria a organização e vincula o usuário atual como admin.
create or replace function create_organization(org_name text, org_document text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org uuid;
begin
  if (select organization_id from profiles where id = auth.uid()) is not null then
    raise exception 'Usuário já pertence a uma organização';
  end if;

  insert into organizations (name, document) values (org_name, org_document)
  returning id into new_org;

  update profiles
     set organization_id = new_org, role = 'admin'
   where id = auth.uid();

  return new_org;
end;
$$;

-- ---------------------------------------------------------------------
-- Habilita RLS e aplica políticas por organização.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  org_tables text[] := array[
    'organizations','profiles','departments','channels','contacts','conversations',
    'messages','tags','quick_replies','wa_templates','automations','campaigns',
    'plans','api_keys','integrations','ai_agents','audit_logs'
  ];
begin
  foreach t in array org_tables loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- organizations: o usuário enxerga/edita a própria org.
create policy org_select on organizations for select using (id = current_org_id());
create policy org_update on organizations for update using (id = current_org_id() and current_role_is('admin'));

-- profiles: enxerga colegas da mesma org; edita o próprio (admin edita todos).
create policy profiles_select on profiles for select
  using (organization_id = current_org_id() or id = auth.uid());
create policy profiles_insert on profiles for insert
  with check (id = auth.uid());
create policy profiles_update on profiles for update
  using (id = auth.uid() or (organization_id = current_org_id() and current_role_is('admin')));

-- Demais tabelas: tudo restrito à org do usuário.
do $$
declare
  t text;
  scoped text[] := array[
    'departments','channels','contacts','conversations','messages','tags',
    'quick_replies','wa_templates','automations','campaigns','plans',
    'api_keys','integrations','ai_agents','audit_logs'
  ];
begin
  foreach t in array scoped loop
    execute format($f$
      create policy %1$s_all on %1$I
        for all
        using (organization_id = current_org_id())
        with check (organization_id = current_org_id());
    $f$, t);
  end loop;
end $$;

-- Tabelas de junção: herdam a org pela entidade pai.
alter table conversation_tags enable row level security;
alter table contact_tags enable row level security;

create policy conversation_tags_all on conversation_tags for all
  using (exists (select 1 from conversations c
                  where c.id = conversation_id and c.organization_id = current_org_id()))
  with check (exists (select 1 from conversations c
                  where c.id = conversation_id and c.organization_id = current_org_id()));

create policy contact_tags_all on contact_tags for all
  using (exists (select 1 from contacts c
                  where c.id = contact_id and c.organization_id = current_org_id()))
  with check (exists (select 1 from contacts c
                  where c.id = contact_id and c.organization_id = current_org_id()));


-- ======================================================================
-- 0003_realtime.sql
-- ======================================================================

-- Habilita Realtime (broadcast de mudanças) para o chat ao vivo e o board Kanban.
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table conversations;


-- ======================================================================
-- 0004_views.sql
-- ======================================================================

-- View para a inbox de atendimento: junta conversa + contato + canal + última mensagem.
-- security_invoker = true faz a view respeitar a RLS das tabelas para o usuário que consulta.
create view conversation_overview
with (security_invoker = true)
as
select
  c.id,
  c.organization_id,
  c.status,
  c.assigned_user_id,
  c.department_id,
  c.channel_id,
  c.contact_id,
  c.protocol,
  c.last_message_at,
  c.opened_at,
  c.closed_at,
  c.created_at,
  ct.name        as contact_name,
  ct.phone       as contact_phone,
  ct.avatar_url  as contact_avatar,
  ch.name        as channel_name,
  ch.type        as channel_type,
  lm.body         as last_message_body,
  lm.content_type as last_message_type,
  lm.direction    as last_message_direction
from conversations c
join contacts ct on ct.id = c.contact_id
join channels ch on ch.id = c.channel_id
left join lateral (
  select body, content_type, direction
  from messages m
  where m.conversation_id = c.id
  order by m.created_at desc
  limit 1
) lm on true;


-- ======================================================================
-- 0005_avatars_bucket.sql
-- ======================================================================

-- Bucket público para fotos de perfil dos contatos (sincronizadas da UAZAPI).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Leitura pública das imagens do bucket avatars.
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'avatars_public_read'
  ) then
    create policy "avatars_public_read" on storage.objects
      for select using (bucket_id = 'avatars');
  end if;
end $$;


-- ======================================================================
-- 0006_groups_mute.sql
-- ======================================================================

-- Suporte a conversas de GRUPO e a silenciar (mute) conversas.
alter table contacts add column if not exists is_group boolean not null default false;
alter table conversations add column if not exists is_muted boolean not null default false;
alter table messages add column if not exists author_name text; -- quem enviou (participante do grupo)

-- Recria a view da inbox expondo is_group, is_muted e o autor da última mensagem.
drop view if exists conversation_overview;
create view conversation_overview
with (security_invoker = true)
as
select
  c.id,
  c.organization_id,
  c.status,
  c.assigned_user_id,
  c.department_id,
  c.channel_id,
  c.contact_id,
  c.protocol,
  c.last_message_at,
  c.opened_at,
  c.closed_at,
  c.created_at,
  c.is_muted,
  ct.name        as contact_name,
  ct.phone       as contact_phone,
  ct.avatar_url  as contact_avatar,
  ct.is_group    as is_group,
  ch.name        as channel_name,
  ch.type        as channel_type,
  lm.body         as last_message_body,
  lm.content_type as last_message_type,
  lm.direction    as last_message_direction,
  lm.author_name  as last_message_author
from conversations c
join contacts ct on ct.id = c.contact_id
join channels ch on ch.id = c.channel_id
left join lateral (
  select body, content_type, direction, author_name
  from messages m
  where m.conversation_id = c.id
  order by m.created_at desc
  limit 1
) lm on true;


-- ======================================================================
-- 0007_media_bucket.sql
-- ======================================================================

-- Bucket público para mídia das conversas (recebida e enviada).
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

-- Leitura pública dos arquivos de mídia.
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'media_public_read'
  ) then
    create policy "media_public_read" on storage.objects
      for select using (bucket_id = 'media');
  end if;
end $$;


-- ======================================================================
-- 0008_message_interactions.sql
-- ======================================================================

-- Interações de mensagem: responder (quote), reações, editar, apagar.
alter table messages add column if not exists reply_to_external text;   -- id externo da msg citada
alter table messages add column if not exists reply_excerpt text;        -- trecho da msg citada (cache)
alter table messages add column if not exists reply_author text;         -- autor da msg citada
alter table messages add column if not exists reactions jsonb not null default '[]'; -- [{emoji, by}]
alter table messages add column if not exists is_deleted boolean not null default false;
alter table messages add column if not exists edited boolean not null default false;

create index if not exists messages_external_id_idx on messages (external_id);


-- ======================================================================
-- 0009_bot_state.sql
-- ======================================================================

-- Estado do chatbot por conversa (qual automação e em que nó parou aguardando resposta).
alter table conversations add column if not exists bot_automation_id uuid references automations (id) on delete set null;
alter table conversations add column if not exists bot_node_id text;


-- ======================================================================
-- 0010_author_phone.sql
-- ======================================================================

-- Telefone real do autor de mensagens de grupo (para abrir conversa 1:1 ao clicar no nome).
alter table messages add column if not exists author_phone text;


-- ======================================================================
-- 0011_group_jid_lid.sql
-- ======================================================================

-- JID completo do grupo (preserva traço de jids antigos) e LID do autor (p/ resolver 1:1).
alter table contacts add column if not exists chat_jid text;
alter table messages add column if not exists author_lid text;

-- Recria a view expondo o JID do contato/grupo.
drop view if exists conversation_overview;
create view conversation_overview
with (security_invoker = true)
as
select
  c.id, c.organization_id, c.status, c.assigned_user_id, c.department_id,
  c.channel_id, c.contact_id, c.protocol, c.last_message_at, c.opened_at,
  c.closed_at, c.created_at, c.is_muted,
  ct.name as contact_name, ct.phone as contact_phone, ct.avatar_url as contact_avatar,
  ct.is_group as is_group, ct.chat_jid as contact_jid,
  ch.name as channel_name, ch.type as channel_type,
  lm.body as last_message_body, lm.content_type as last_message_type,
  lm.direction as last_message_direction, lm.author_name as last_message_author
from conversations c
join contacts ct on ct.id = c.contact_id
join channels ch on ch.id = c.channel_id
left join lateral (
  select body, content_type, direction, author_name
  from messages m where m.conversation_id = c.id
  order by m.created_at desc limit 1
) lm on true;


-- ======================================================================
-- 0012_avatar_src.sql
-- ======================================================================

-- Impressão digital da foto-fonte (caminho da URL do WhatsApp, sem query de expiração).
-- Quando muda, sabemos que a pessoa trocou a foto e re-hospedamos a nova.
alter table contacts add column if not exists avatar_src text;


-- ======================================================================
-- 0013_protocol_close.sql
-- ======================================================================

-- =====================================================================
-- Fase 1 — Protocolo de atendimento, encerramento e notas internas
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Protocolo: contador diário por organização + trigger de atribuição.
--    Formato: AAAAMMDD + sequência diária (4 dígitos). Ex.: 202606040001
-- ---------------------------------------------------------------------
create table if not exists protocol_counters (
  organization_id uuid not null references organizations (id) on delete cascade,
  day             date not null,
  seq             int  not null default 0,
  primary key (organization_id, day)
);

create or replace function assign_protocol()
returns trigger
language plpgsql
as $$
declare
  n     int;
  today date := (now() at time zone 'America/Bahia')::date;
begin
  if new.protocol is null or new.protocol = '' then
    insert into protocol_counters (organization_id, day, seq)
      values (new.organization_id, today, 1)
      on conflict (organization_id, day)
        do update set seq = protocol_counters.seq + 1
      returning seq into n;
    new.protocol := to_char(today, 'YYYYMMDD') || lpad(n::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_protocol on conversations;
create trigger trg_assign_protocol
  before insert on conversations
  for each row execute function assign_protocol();

-- Backfill: numera conversas existentes sem protocolo (por org+dia, ordem de criação).
with numbered as (
  select
    id,
    to_char((created_at at time zone 'America/Bahia')::date, 'YYYYMMDD') as ymd,
    row_number() over (
      partition by organization_id, (created_at at time zone 'America/Bahia')::date
      order by created_at
    ) as rn
  from conversations
  where protocol is null or protocol = ''
)
update conversations c
   set protocol = n.ymd || lpad(n.rn::text, 4, '0')
  from numbered n
 where n.id = c.id;

-- Sincroniza o contador com o que já existe (evita colisão com novos do mesmo dia).
insert into protocol_counters (organization_id, day, seq)
  select organization_id, (created_at at time zone 'America/Bahia')::date, count(*)
    from conversations
   group by 1, 2
  on conflict (organization_id, day)
    do update set seq = greatest(protocol_counters.seq, excluded.seq);

-- ---------------------------------------------------------------------
-- 2) Encerramento: motivo de encerramento (classificação via conversation_tags).
-- ---------------------------------------------------------------------
alter table conversations add column if not exists close_reason text;
-- Aguardando resposta da pesquisa de satisfação (captura a nota na próxima resposta do cliente).
alter table conversations add column if not exists awaiting_satisfaction boolean not null default false;

-- ---------------------------------------------------------------------
-- 3) Notas internas: mensagens visíveis só aos atendentes (não vão ao cliente).
-- ---------------------------------------------------------------------
alter table messages add column if not exists is_internal boolean not null default false;

-- ---------------------------------------------------------------------
-- 4) Recria a view da inbox expondo satisfação, motivo, atendente e depto.
-- ---------------------------------------------------------------------
drop view if exists conversation_overview;
create view conversation_overview
with (security_invoker = true)
as
select
  c.id, c.organization_id, c.status, c.assigned_user_id, c.department_id,
  c.channel_id, c.contact_id, c.protocol, c.last_message_at, c.opened_at,
  c.closed_at, c.created_at, c.is_muted, c.satisfaction, c.close_reason,
  c.bot_automation_id,
  ct.name as contact_name, ct.phone as contact_phone, ct.avatar_url as contact_avatar,
  ct.is_group as is_group, ct.chat_jid as contact_jid,
  ch.name as channel_name, ch.type as channel_type,
  pr.name as assigned_name,
  dp.name as department_name, dp.color as department_color,
  lm.body as last_message_body, lm.content_type as last_message_type,
  lm.direction as last_message_direction, lm.author_name as last_message_author,
  coalesce(ur.cnt, 0)::int as unread_count
from conversations c
join contacts ct on ct.id = c.contact_id
join channels ch on ch.id = c.channel_id
left join profiles pr on pr.id = c.assigned_user_id
left join departments dp on dp.id = c.department_id
left join lateral (
  select body, content_type, direction, author_name
  from messages m
  where m.conversation_id = c.id and coalesce(m.is_internal, false) = false
  order by m.created_at desc
  limit 1
) lm on true
left join lateral (
  select count(*) as cnt
  from messages m2
  where m2.conversation_id = c.id and m2.direction = 'in' and m2.status <> 'read'
) ur on true;


-- ======================================================================
-- 0014_full_parity.sql
-- ======================================================================

-- =====================================================================
-- 0014 — Paridade total com Chatmix: todas as tabelas/colunas faltantes
-- =====================================================================

-- =========================== CSAT (Pesquisa de Satisfação) ===========================
create table if not exists satisfaction_surveys (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  active          boolean not null default false,
  scale_type      text not null default 'stars' check (scale_type in ('stars','buttons')),
  scale_max       int not null default 5,
  question        text not null default 'De 1 a 5, como você avalia o nosso atendimento?',
  channels        uuid[] not null default '{}',   -- vazio = todos
  close_after_min int not null default 30,        -- encerra se cliente não responder
  created_at      timestamptz not null default now()
);

-- =========================== HORÁRIO DE ATENDIMENTO ===========================
create table if not exists business_hours (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  department_id   uuid references departments (id) on delete cascade, -- null = global da org
  day_of_week     int not null check (day_of_week between 0 and 6),   -- 0=domingo
  start_time      time not null default '08:00',
  end_time        time not null default '18:00',
  active          boolean not null default true,
  unique (organization_id, department_id, day_of_week)
);

-- =========================== MENSAGENS AUTOMÁTICAS POR EVENTO ===========================
create table if not exists auto_messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  event           text not null check (event in (
    'welcome','away','out_of_hours','close','queue_wait','agent_assign'
  )),
  channel_id      uuid references channels (id) on delete cascade, -- null = todos
  department_id   uuid references departments (id) on delete cascade, -- null = todos
  body            text not null,
  active          boolean not null default true,
  interval_min    int,  -- para queue_wait: reenvia a cada N min
  created_at      timestamptz not null default now()
);

-- =========================== CONFIGURAÇÕES DA ORGANIZAÇÃO ===========================
-- Expansão: organizations.settings JSONB já existe; vamos usá-lo com chaves bem-definidas.
-- Nada a criar em schema; os defaults ficam no código.

-- =========================== RECORRÊNCIA DE ATENDIMENTO ===========================
-- Campo na conversa para exibir badge Baixa/Média/Alta
-- (calculado on-the-fly; configuração em organizations.settings)

-- =========================== COLUNAS ADICIONAIS ===========================

-- Conversations: survey_id (qual pesquisa foi enviada)
alter table conversations add column if not exists survey_id uuid references satisfaction_surveys (id) on delete set null;

-- Conversations: closed_by (quem encerrou)
alter table conversations add column if not exists closed_by uuid references profiles (id) on delete set null;

-- Messages: forwarded (encaminhada)
alter table messages add column if not exists forwarded boolean not null default false;

-- Conversations: pinned (fixada)
alter table conversations add column if not exists pinned boolean not null default false;

-- Conversations: archived
alter table conversations add column if not exists archived boolean not null default false;

-- Contacts: campos CRM extras
alter table contacts add column if not exists email text;
alter table contacts add column if not exists birthday date;
alter table contacts add column if not exists city text;
alter table contacts add column if not exists address text;

-- Profiles: 2FA
alter table profiles add column if not exists totp_secret text;
alter table profiles add column if not exists totp_enabled boolean not null default false;

-- Profiles: avatar (foto de perfil do atendente)
-- já existe avatar_url

-- API keys: canal amarrado
alter table api_keys add column if not exists channel_id uuid references channels (id) on delete set null;

-- Campaigns: campos de disparo real
alter table campaigns add column if not exists channel_id uuid references channels (id) on delete set null;
alter table campaigns add column if not exists contact_filter jsonb not null default '{}';
alter table campaigns add column if not exists started_at timestamptz;
alter table campaigns add column if not exists finished_at timestamptz;
alter table campaigns add column if not exists total_contacts int not null default 0;
alter table campaigns add column if not exists sent_count int not null default 0;
alter table campaigns add column if not exists failed_count int not null default 0;

-- =========================== RLS nas tabelas novas ===========================
alter table satisfaction_surveys enable row level security;
create policy "org_surveys" on satisfaction_surveys using (organization_id = current_org_id());

alter table business_hours enable row level security;
create policy "org_hours" on business_hours using (organization_id = current_org_id());

alter table auto_messages enable row level security;
create policy "org_auto_msgs" on auto_messages using (organization_id = current_org_id());

-- =========================== VIEW ATUALIZADA ===========================
drop view if exists conversation_overview;
create view conversation_overview
with (security_invoker = true)
as
select
  c.id, c.organization_id, c.status, c.assigned_user_id, c.department_id,
  c.channel_id, c.contact_id, c.protocol, c.last_message_at, c.opened_at,
  c.closed_at, c.created_at, c.is_muted, c.satisfaction, c.close_reason,
  c.bot_automation_id, c.survey_id, c.pinned, c.archived,
  c.awaiting_satisfaction, c.closed_by,
  ct.name as contact_name, ct.phone as contact_phone, ct.avatar_url as contact_avatar,
  ct.is_group as is_group, ct.chat_jid as contact_jid,
  ct.email as contact_email, ct.city as contact_city,
  ch.name as channel_name, ch.type as channel_type,
  pr.name as assigned_name,
  dp.name as department_name, dp.color as department_color,
  lm.body as last_message_body, lm.content_type as last_message_type,
  lm.direction as last_message_direction, lm.author_name as last_message_author,
  lm.created_at as last_message_created_at,
  coalesce(ur.cnt, 0)::int as unread_count
from conversations c
join contacts ct on ct.id = c.contact_id
join channels ch on ch.id = c.channel_id
left join profiles pr on pr.id = c.assigned_user_id
left join departments dp on dp.id = c.department_id
left join lateral (
  select body, content_type, direction, author_name, created_at
  from messages m
  where m.conversation_id = c.id and coalesce(m.is_internal, false) = false
  order by m.created_at desc
  limit 1
) lm on true
left join lateral (
  select count(*) as cnt
  from messages m2
  where m2.conversation_id = c.id and m2.direction = 'in' and m2.status <> 'read'
) ur on true;

-- =========================== REALTIME nas tabelas novas ===========================
alter publication supabase_realtime add table satisfaction_surveys;
alter publication supabase_realtime add table auto_messages;


-- ======================================================================
-- 0015_conversation_ai.sql
-- ======================================================================

-- =====================================================================
-- 0015 — Controle por conversa do atendimento por IA (pausar/reativar)
-- Equivalente ao "assumir / devolver para a automação" + block_return_to_bot
-- do Chatmix, mas no nível da conversa.
-- =====================================================================

-- true (padrão) = a IA pode atuar nesta conversa.
-- false = atendente pausou a IA; o chatbot NÃO reengaja, mesmo em conversa nova.
alter table conversations add column if not exists ai_enabled boolean not null default true;

-- Recria a view expondo ai_enabled. MANTÉM unread_count (não remover!).
drop view if exists conversation_overview;
create view conversation_overview
with (security_invoker = true)
as
select
  c.id, c.organization_id, c.status, c.assigned_user_id, c.department_id,
  c.channel_id, c.contact_id, c.protocol, c.last_message_at, c.opened_at,
  c.closed_at, c.created_at, c.is_muted, c.satisfaction, c.close_reason,
  c.bot_automation_id, c.survey_id, c.pinned, c.archived,
  c.awaiting_satisfaction, c.closed_by, c.ai_enabled,
  ct.name as contact_name, ct.phone as contact_phone, ct.avatar_url as contact_avatar,
  ct.is_group as is_group, ct.chat_jid as contact_jid,
  ct.email as contact_email, ct.city as contact_city,
  ch.name as channel_name, ch.type as channel_type,
  pr.name as assigned_name,
  dp.name as department_name, dp.color as department_color,
  lm.body as last_message_body, lm.content_type as last_message_type,
  lm.direction as last_message_direction, lm.author_name as last_message_author,
  lm.created_at as last_message_created_at,
  coalesce(ur.cnt, 0)::int as unread_count
from conversations c
join contacts ct on ct.id = c.contact_id
join channels ch on ch.id = c.channel_id
left join profiles pr on pr.id = c.assigned_user_id
left join departments dp on dp.id = c.department_id
left join lateral (
  select body, content_type, direction, author_name, created_at
  from messages m
  where m.conversation_id = c.id and coalesce(m.is_internal, false) = false
  order by m.created_at desc
  limit 1
) lm on true
left join lateral (
  select count(*) as cnt
  from messages m2
  where m2.conversation_id = c.id and m2.direction = 'in' and m2.status <> 'read'
) ur on true;


-- ======================================================================
-- 0016_ai_allowlist.sql
-- ======================================================================

-- Allowlist de números autorizados a receber atendimento por IA.
-- Rollout controlado: quando o agente está com restrict_to_allowlist=true,
-- só os números desta lista (active) recebem resposta da IA; os demais vão
-- direto para a fila humana.

create table if not exists ai_allowed_numbers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  phone           text not null,                 -- só dígitos (ex.: 5573999998888)
  label           text,                          -- nome/observação
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, phone)
);

create index if not exists ai_allowed_numbers_org_phone_idx
  on ai_allowed_numbers (organization_id, phone);

alter table ai_allowed_numbers enable row level security;

-- Acesso restrito à própria organização (mesma convenção das demais tabelas: current_org_id()).
drop policy if exists ai_allowed_numbers_all on ai_allowed_numbers;
create policy ai_allowed_numbers_all on ai_allowed_numbers for all
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());


-- ======================================================================
-- 0017_automation_integration_schedule.sql
-- ======================================================================

-- Vincula cada automação a uma integração SGP específica (opcional).
-- Quando preenchido, o pipeline usa esse SGP em vez de buscar o primeiro da org.
alter table automations
  add column if not exists integration_id uuid references integrations(id) on delete set null;

-- Horário de execução por automação.
-- Formato: {"sun":[],"mon":[["08:00","18:00"]],...}
-- null ou objeto vazio = sem restrição (roda 24/7).
alter table automations
  add column if not exists schedule jsonb;


-- ======================================================================
-- 0018_campaign_message.sql
-- ======================================================================

-- Texto de disparo da campanha (usado quando não há fluxo, ou como override
-- da 1ª mensagem do fluxo de automação vinculado).
alter table campaigns
  add column if not exists message text;


-- ======================================================================
-- 0020_conversation_variables.sql
-- ======================================================================

-- Variáveis coletadas durante o fluxo de automação (nós "input") e merge fields.
alter table conversations
  add column if not exists variables jsonb not null default '{}'::jsonb;


-- ======================================================================
-- 0021_super_admin.sql
-- ======================================================================

-- Marca de superadmin (acesso ao painel /superadmin).
alter table public.profiles
  add column if not exists super_admin boolean not null default false;


-- ======================================================================
-- 0022_internal_messages_mentions.sql
-- ======================================================================

-- Mensagens internas entre atendentes: menções + notificações (sino).

-- Menções em mensagens internas: array de { id, name } dos atendentes marcados.
alter table public.messages
  add column if not exists mentions jsonb not null default '[]'::jsonb;

-- Notificações de menção interna (para o sino/badge por atendente).
create table if not exists public.internal_mentions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  mentioned_user_id uuid not null,
  created_by uuid,
  author_name text,
  excerpt text,
  contact_name text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_internal_mentions_user
  on public.internal_mentions(mentioned_user_id, read_at);
create index if not exists idx_internal_mentions_conv
  on public.internal_mentions(conversation_id);

alter table public.internal_mentions enable row level security;

-- Cada atendente vê e marca como lida apenas as próprias menções.
drop policy if exists internal_mentions_select on public.internal_mentions;
create policy internal_mentions_select on public.internal_mentions
  for select using (mentioned_user_id = auth.uid());

drop policy if exists internal_mentions_update on public.internal_mentions;
create policy internal_mentions_update on public.internal_mentions
  for update using (mentioned_user_id = auth.uid());

-- Realtime para o sino.
alter publication supabase_realtime add table public.internal_mentions;


-- ======================================================================
-- 0023_app_logs.sql
-- ======================================================================

-- Logs de aplicação acessíveis fora do Easypanel (lidos no /superadmin e via REST).
create table if not exists public.app_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  level text not null default 'info',          -- info | warn | error
  source text not null default 'app',          -- webhook | chatbot | ai | sgp | send | ...
  message text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_logs_created on public.app_logs(created_at desc);
create index if not exists idx_app_logs_level on public.app_logs(level, created_at desc);

alter table public.app_logs enable row level security;
-- Sem policies: só o service role (servidor) escreve/lê.


-- ======================================================================
-- 0024_inactivity_auto_close.sql
-- ======================================================================

-- Encerramento por inatividade: marca quando o aviso foi enviado (pra não repetir).
alter table public.conversations
  add column if not exists inactivity_warned_at timestamptz;

-- Índice pra o cron achar conversas ociosas de forma barata.
create index if not exists idx_conversations_org_status_lastmsg
  on public.conversations(organization_id, status, last_message_at);


-- ======================================================================
-- 0025_message_deleted_scope.sql
-- ======================================================================

-- Escopo da exclusão: 'me' (só na plataforma) ou 'everyone' (revogada no cliente).
-- A mensagem permanece no banco (faded na UI) para auditoria/admin.
alter table public.messages
  add column if not exists deleted_scope text;


-- ======================================================================
-- 0026_crm_kanban.sql
-- ======================================================================

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


-- ======================================================================
-- 0027_tasks.sql
-- ======================================================================

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


-- ======================================================================
-- 0028_broadcasts_scheduled.sql
-- ======================================================================

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


-- ======================================================================
-- 0029_contracts.sql
-- ======================================================================

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


-- ======================================================================
-- 0030_required_attributes.sql
-- ======================================================================

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
