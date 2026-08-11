-- Dono padrão do departamento: cada setor tem UMA pessoa responsável hoje.
-- Sem isto, a transferência do bot só marcava o departamento e deixava a
-- conversa em "Sem responsável" — quem cuida daquele setor tinha que ir
-- procurar na fila em vez de já receber atribuído.
alter table public.departments
  add column if not exists default_assignee_id uuid references profiles (id) on delete set null;

comment on column public.departments.default_assignee_id is
  'Atendente que recebe automaticamente as conversas transferidas para este departamento (setor com 1 responsável só).';
