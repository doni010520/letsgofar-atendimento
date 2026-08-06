-- Nome original do arquivo enviado/recebido.
--
-- Sem isso a única pista do nome era o caminho no storage, que é gerado
-- (`<conversa>-<timestamp>.pdf`) — a conversa mostrava só "Abrir documento" e
-- quem recebia no WhatsApp via o nome gerado, não o nome que a pessoa salvou.
-- Nulo para tudo que já existe: mensagem antiga cai no nome tirado da URL.
alter table public.messages
  add column if not exists media_name text;

comment on column public.messages.media_name is
  'Nome original do arquivo, exatamente como veio de quem enviou (com acento e espaço).';
