-- Ordem manual dos cards dentro da coluna do kanban.
--
-- Hoje a ordem é por prazo e data de criação, e não dá para arrastar um card
-- para cima do outro — a Ianka pediu para organizar na ordem dela.
--
-- É `double precision` de propósito: para colocar um card ENTRE outros dois
-- basta gravar a média das duas posições, sem renumerar a coluna inteira a
-- cada arrasto. Nulo = nunca foi arrastada, cai na ordem antiga por prazo.
alter table public.tasks
  add column if not exists position double precision;

create index if not exists idx_tasks_position
  on public.tasks(status, position)
  where position is not null;

comment on column public.tasks.position is
  'Ordem manual dentro da coluna do kanban. Nulo = ordena por prazo, como antes.';
