# Deploy — Let's Go Far Atendimento

## 1. Tornar a imagem acessível (3 cliques, uma vez só)

A imagem está **privada**. No GitHub:

**Perfil → Packages → `letsgofar-atendimento` → Package settings → Danger Zone
→ Change visibility → Public**

> O código continua privado; só a imagem fica pública. Alternativa: manter
> privada e cadastrar usuário + PAT (escopo `read:packages`) no EasyPanel.

## 2. Criar o app no EasyPanel

- **Source:** Docker Image
- **Image:** `ghcr.io/doni010520/letsgofar-atendimento:latest`
  (ou `:v1.0.0` para fixar a versão)
- **Porta:** 3000

## 3. Variáveis de ambiente

Cole no painel do EasyPanel:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://ikwpkmjvkjqsfefulhdz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrd3BrbWp2a2pxc2ZlZnVsaGR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNTQyMzEsImV4cCI6MjEwMDgzMDIzMX0.ABMPj54TCdbOwdP4oiWdW3Pbzv8nByTqEeig6Klgwjw
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrd3BrbWp2a2pxc2ZlZnVsaGR6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTI1NDIzMSwiZXhwIjoyMTAwODMwMjMxfQ.3wv81eCFCjHrbaWRanX4i6FIOEjM3b1qz79FguGxcWU
CRON_SECRET=V3O7j-MdDhLWsLpNgd8HJ0cp0O1RGWE_V09OMFKP1QsrtHvpY-SABOFfcn_qWHPC
UAZAPI_HOST=https://benitechlab.uazapi.com
UAZAPI_ADMIN_TOKEN=aFwNqkriam7MPp6wqpVntVpeTR8wFyslpTnft581hX63sHLnA0
UAZAPI_WEBHOOK_TOKEN=Rj7EU5VdIcfo0IjlKBRJlIulH7ll8hnDY2snaoA4ryc
APP_BASE_URL=https://SEU-DOMINIO
CRON_INTERVAL_MS=60000
NODE_ENV=production
```

⚠️ **`APP_BASE_URL` precisa ser o domínio público real.** É com ele que o app
monta o endereço do webhook que a uazapi vai chamar — com `localhost`, nenhuma
mensagem chega.

## 4. Domínio

Aponte o domínio no EasyPanel (aba Domains) para a porta 3000 e ative HTTPS.

## 5. Primeiro acesso

1. `https://SEU-DOMINIO/cadastro` — crie sua conta (vira admin da organização)
2. **Empresa → Atendentes** — convide a equipe
3. **Canais → Novo canal → UAZAPI** — conecta o WhatsApp

## 6. Importar a operação do Chatwoot

Com a conta criada, rode (o ORG_ID sai do banco):

```bash
CHATWOOT_URL=https://letsgofarchat.benitechlab.com CHATWOOT_TOKEN=<token do Chatwoot> SUPABASE_DB_URL=<connection string> ORG_ID=<uuid da organização> node scripts/import-chatwoot.mjs --dry     # simula
```

Tire o `--dry` para gravar. Traz times, respostas rápidas, etiquetas,
contatos e o histórico de conversas.

## 7. Conferir

- `GET https://SEU-DOMINIO/api/cron?secret=$CRON_SECRET` → `{"ok":true}`
- **Disparos:** crie um com 1 número seu e veja chegar
- **Automações → Criar bot de triagem** → revise os textos → ative

## ⚠️ O corte do WhatsApp

A instância da uazapi só pode ter **um** webhook. Ao conectar o canal aqui,
o Chatwoot **para de receber**. Faça em horário de baixo movimento.
