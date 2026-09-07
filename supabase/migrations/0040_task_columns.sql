-- =====================================================================
-- Colunas próprias no kanban de TAREFAS  (pedido da Ianka, 04/09/26)
--
-- "seria ótimo se conseguirmos criar nossas próprias colunas tbm baseado no
--  que interessa para cada uma"
--
-- Até aqui as colunas do kanban eram os STATUS, fixos no código
-- (A fazer / Em andamento / Concluídas / Canceladas). Isto acrescenta um
-- SEGUNDO quadro, com colunas que a equipe cria — sem tirar o de status, que
-- continua sendo o padrão e continua funcionando igual.
--
-- As colunas são da ORGANIZAÇÃO, não de cada pessoa. Tarefa é objeto
-- compartilhado: se cada uma tivesse o seu quadro, a mesma tarefa estaria em
-- colunas diferentes para pessoas diferentes e ninguém saberia onde ela
-- "está". Quem separa o que interessa a cada uma são os filtros por pessoa
-- (Minhas / Delegadas por mim / Recebidas de outros) e a busca, aplicados
-- sobre o mesmo quadro.
--
-- `column_id` é nulo por padrão: toda tarefa que já existe cai em "Sem
-- coluna" e nada muda para quem não usar o quadro novo.
-- =====================================================================

create table if not exists public.task_columns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  color           text not null default '#6366F1',
  position        int not null default 0,
  created_by      uuid references profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create index if not exists idx_task_columns_org on public.task_columns(organization_id, position);

-- on delete set null: apagar a coluna devolve as tarefas para "Sem coluna".
-- NUNCA cascade aqui — apagar uma coluna não pode apagar o trabalho de ninguém.
alter table public.tasks
  add column if not exists column_id uuid references task_columns (id) on delete set null;

create index if not exists idx_tasks_column on public.tasks(column_id, position);

alter table public.task_columns enable row level security;
drop policy if exists task_columns_org on public.task_columns;
create policy task_columns_org on public.task_columns for all
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());
