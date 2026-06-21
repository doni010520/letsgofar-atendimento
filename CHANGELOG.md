# Changelog

Versões do MVF Chat. A versão no ar fica em `GET /api/version` e no topo da tela.
A imagem é publicada com tag de versão (`:vX.Y.Z`) e do commit (`:<sha>`).

## v2.22.0
- Apagar mensagem deixa de aparecer em conversas do canal **Meta (API Oficial)**,
  já que a Meta não permite revogar mensagem enviada. UAZAPI mantém as duas opções.

## v2.21.0
- Limpeza da sidebar: remove "Chaves de API" (sem API consumindo) e tira
  "Auditoria" e "Exportar contatos" do menu (export já é botão em Clientes).
  "Integrações" vira **SGP** e passa para a seção Empresa.

## v2.20.0
- Deploys identificáveis: imagem ganha tag de **versão** (`:vX.Y.Z`) além do SHA;
  `/api/version` agora também expõe o **commit** (via `GIT_SHA` no build).
- Este CHANGELOG.

## v2.19.0
- Modal de apagar mensagem com **as duas opções sempre** (para mim / para todos),
  sem texto explicativo. README com a seção "Funcionalidades do chat".

## v2.18.0
- **Apagar mensagem** com modal próprio (para mim / para todos) e **auditoria**:
  a mensagem fica esmaecida e visível para a equipe (não some do banco).

## v2.17.0
- **Encerramento por inatividade** (avisa → despede → fecha → reinicia o fluxo) e
  **ao resolver** (IA `finalizar_atendimento` fecha a conversa). Configurável em
  Ajustes → Configurações → Atendimento. Cron via `/api/cron` (`CRON_SECRET`).

## v2.16.0
- Correção do SGP: painel deixa de usar o CPF `00000000000` (que travava o SGP);
  cliente SGP com timeout (AbortController).

## v2.15.0
- Endpoint público **`/api/version`** + `deploy.mjs` robusto (confirma a versão no ar).

## v2.14.0
- **Logs no banco** (`app_logs`) visíveis no `/superadmin`; tela do agente de IA
  mostra/edita o prompt-base.

## v2.13.0
- **Mensagens internas** entre atendentes (chat interno + `@menção` + sino em tempo real).

## v2.12.0
- **Buffer/debounce** de mensagens do bot (rajadas viram 1 resposta). `BOT_DEBOUNCE_MS`.
