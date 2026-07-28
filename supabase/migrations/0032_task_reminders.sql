-- =====================================================================
-- Lembretes de tarefa
--
-- No Chatwoot as colunas de lembrete existiam mas nada as usava. Aqui o
-- cron marca a tarefa quando chega a hora (ou quando vence), e a marcação
-- viaja pelo realtime até a tela do responsável.
-- =====================================================================

alter table public.tasks
  add column if not exists reminder_sent_at  timestamptz,
  add column if not exists overdue_notified_at timestamptz;

-- Índice para o cron achar rápido o que precisa de aviso.
create index if not exists idx_tasks_reminder_due
  on public.tasks(reminder_at)
  where reminder_at is not null and reminder_sent_at is null;
