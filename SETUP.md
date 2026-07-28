# Subir o Let's Go Far Atendimento

Passo a passo para colocar o app no ar com Supabase Cloud.

---

## 1. Criar o projeto no Supabase

1. Acesse https://supabase.com/dashboard e crie um projeto.
2. **Region:** `South America (São Paulo)` — menor latência para o Brasil.
3. **Guarde a senha do banco** que ele pedir (some depois de criada).

## 2. Rodar o banco

No painel do projeto → **SQL Editor** → **New query**:

1. Abra o arquivo `supabase/SETUP_COMPLETO.sql` deste repositório.
2. Cole o conteúdo inteiro e clique em **Run**.

Isso cria tudo: atendimento, CRM/Kanban, Tarefas, Disparos, Agendadas,
Contratos e as políticas de segurança (RLS) por organização.

> É seguro rodar de novo: o script usa `if not exists`.

## 3. Pegar as chaves

Painel → **Settings** → **API**. Copie:

| No painel | Vai para a variável |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY` |

⚠️ A `service_role` ignora todas as regras de segurança. Ela vive **só** no
servidor (variável de ambiente) — nunca no navegador, nunca no Git.

## 4. Variáveis de ambiente

Crie um `.env.local` (ou preencha no painel do EasyPanel):

```bash
# Supabase (obrigatório)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# App
APP_BASE_URL=https://atendimento.letsgofar.com.br
CRON_SECRET=<gere uma senha aleatória longa>

# WhatsApp — UAZAPI (canal atual da escola)
UAZAPI_HOST=https://benitechlab.uazapi.com
UAZAPI_ADMIN_TOKEN=...
UAZAPI_WEBHOOK_TOKEN=<senha que você inventa; a uazapi devolve nos webhooks>

# IA (opcional, para o agente)
OPENAI_API_KEY=...

# Segurança (opcional)
REQUIRE_2FA=false
```

## 5. Primeiro acesso

1. Suba o app (`npm run dev` local, ou deploy no EasyPanel).
2. Acesse `/cadastro` e crie sua conta.
3. O onboarding cria a **organização** — a partir daí todo dado fica isolado nela.
4. Convide a equipe em **Empresa → Atendentes**.

## 6. Conectar o WhatsApp

**Canais → Novo canal → UAZAPI** e leia o QR code com o celular da escola.

## 7. Conferir se está tudo de pé

- **Disparos:** crie um disparo com **1 número seu**, planilha de 1 linha, e
  veja a mensagem chegar. Confirme que o card mostra "1/1 enviados".
- **CRM:** crie um funil (vem com Leads → Qualificação → Negociação → Fechamento)
  e arraste um card entre estágios.
- **Tarefas:** crie uma tarefa marcando 2 responsáveis — devem nascer 2 tarefas.
- **Cron:** `GET /api/cron?secret=<CRON_SECRET>` deve responder `{"ok":true}`.

---

## Sobre os dados do Chatwoot

Contatos e conversas antigas **não vêm sozinhos**. Quando o app estiver de pé,
dá para importar os contatos do Chatwoot (nome + telefone) — é o mínimo
necessário para a equipe continuar o trabalho sem perder histórico de quem é quem.

## Verificação da lógica de disparo

```bash
npx tsx scripts/verify-broadcast.mjs
```

Testa spintax, 9º dígito, janela de horário e leitura do CSV.
