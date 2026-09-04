-- Assinatura por ATENDENTE, não pela organização inteira.
--
-- `organizations.settings.identify_agent` continua sendo o padrão do time, mas
-- só admin pode mudar (RLS de organizations exige current_role_is('admin')).
-- Resultado: quem atende via o botao "Assinatura" na conversa, clicava, e o
-- banco recusava calado -- "nao consigo desligar a assinatura".
--
-- null  = segue o padrao da organizacao
-- true  = sempre assina, mesmo que o time nao assine
-- false = nunca assina, mesmo que o time assine
alter table public.profiles add column if not exists identify_agent boolean;

comment on column public.profiles.identify_agent is
  'Preferencia individual de assinatura. null = segue organizations.settings.identify_agent.';
