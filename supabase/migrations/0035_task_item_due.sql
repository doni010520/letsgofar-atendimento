-- Prazo do item de checklist.
--
-- Uma tarefa como "matrícula do aluno" tem etapas com dia e hora próprios
-- (ligar 14h, enviar contrato até sexta). Sem isto o item era só um texto e a
-- data de todas as etapas acabava enfiada no título, escrita na mão.
alter table public.task_items
  add column if not exists due_date date,
  add column if not exists due_time time;

comment on column public.task_items.due_date is 'Dia do item de checklist (opcional).';
comment on column public.task_items.due_time is 'Hora do item de checklist (opcional, só faz sentido com due_date).';
