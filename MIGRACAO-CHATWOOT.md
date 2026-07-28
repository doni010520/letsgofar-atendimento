# Migração Chatwoot → letsgofar-atendimento

Inventário levantado por **diff real** contra o Chatwoot v4.10.1 (273 arquivos
adicionados, 396 modificados pelo fork) — não pelo README.

Base: `mvf-atendimento` (Next.js 16 + TypeScript + Tailwind v4 + Supabase).

## Legenda
- [ ] pendente · [x] concluído · ~~riscado~~ = já existe no mvf

---

## A. Módulos completos

### A1. CRM / Kanban (67 arquivos no Chatwoot)
- [x] Pipelines e estágios (posição, cor, ordenação)
- [x] Cards = conversas no funil (arrastar entre estágios)
- [x] Valor do negócio, ganho/perdido, data de fechamento
- [x] Campos personalizados por pipeline (UI de criação e listagem)
- [x] Motor de automações: 8 gatilhos × 7 ações + logs de execução
- [x] Atividades/timeline por conversa
- [ ] Permissões de CRM por usuário (visibilidade)
- [ ] Dashboard do Kanban + Dashboard de controle de leads

### A2. Contratos (41 arquivos)
- [x] Modelos de contrato com variáveis dinâmicas
- [x] Geração, preview e **PDF** (versão imprimível em /contratos/[id]/pdf)
- [x] Assinatura pública por token (sem login)
- [x] Múltiplos signatários, ordem, CPF
- [x] Evidências jurídicas: IP, user-agent, timestamp, hash
- [x] Recusa com motivo + timeline (e-mails: pendente)
- [x] Filtros: todos/rascunhos/aguardando/assinados/recusados/modelos

### A3. Tarefas (19 arquivos)
- [x] Tarefa com checklist e comentários (UI completa)
- [x] Recorrência (diária/semanal/mensal/custom)
- [x] Prazo + hora, prioridade, status, ações iniciar/cancelar/reabrir
- [x] **Visibilidade**: admin vê tudo; atendente vê o que criou ou o que é dele (igual Chatwoot)
- [ ] Anexos: schema pronto, falta upload na tela
- [ ] Etiquetas na tarefa: schema pronto, falta UI
- [ ] ~~Lembrete~~: as colunas existiam no Chatwoot mas **nada as usava** — não é regressão
- [x] Vínculo com contato/conversa/pipeline
- [x] Views: lista, **calendário**, **kanban** + filtros e estatísticas
- [x] Multi-responsável (1 tarefa → N cópias independentes)

### A4. Disparos (18 arquivos) — `campaigns` do mvf é base parcial
- [x] Espaçamento aleatório entre envios (anti-ban)
- [x] Janela de horário + teto diário
- [x] Personalização (`{primeiro_nome}`, merges) + spintax `{a|b}`
- [x] Fonte: CSV ou contatos salvos
- [x] Rastreio por destinatário (enviado/falha/pendente) + progresso
- [x] Atribuição das conversas criadas

### A5. Mensagens Agendadas (4 arquivos)
- [x] Agendar mensagem para data/hora futura (com anexos) — motor pronto

---

## B. Features sem tabela própria
- [x] B6. Atributos obrigatórios ao resolver (schema + validação; falta plugar no botão Resolver)
- [x] B7. Copiloto de IA (sugere resposta) + sugestão automática de etiquetas
- [x] B8. Prefixo automático do agente (aplicado no envio real)
- [x] B9. Alerta sonoro de tarefas (preferência por usuário)
- [x] B10. Relatórios: 1ª resposta · matriz canal×etiqueta · contagem de enviadas (tela em /relatorios/extras)
- [x] B11. Painel de CRM dentro da conversa (estágio + valor)
- [x] B12. Identidade visual Let's Go Far (logo, títulos, manifest)

---

## C. Comportamentos de núcleo (os mais fáceis de esquecer)
- [x] C13. Conversa nova **herda** CRM do contato (pipeline/estágio/valor)
- [x] C14. Log automático de mudanças (estágio/valor/ganho) + dispara automações
- [x] C15. "Adicionar ao CRM" a partir do contato
- [x] C16. **Mensagens espelhadas do celular** (echo) — ~~já nativo no mvf~~ (`inbound.ts` fromMe)
- [x] C17. Reabertura inteligente — nativo no mvf + reforçado no disparo
- [x] C18. Limpeza de notificações (>1 mês, máx. 300 por usuário)
- [x] C19. Faxina de conversas órfãs
- [x] C20. Realtime habilitado na tabela de tarefas
- [x] C21. Agendador — jobs ligados ao cron in-process do mvf

---

## D. Configuração e dados da operação (faltou no 1º inventário)
Levantado direto da instância em produção — **não aparece em código**:
- [x] D1. **13 respostas rápidas** (PIX/CNPJ, links de Meet por pessoa, cobrança, congelamento, cancelamento, multa, boas-vindas, briefing)
- [x] D2. **4 times**: financeiro, comercial, experiência do aluno, equipe
- [~] D3. **6 agentes** — recriar manualmente (convite por e-mail); o import não cria login
- [x] D4. **Bot de triagem/direcionamento inicial** (nativo, botão em /automacoes) (hoje no n8n; o mvf tem motor nativo com nós menu/transferir/tag)
- [x] D5. **Dados**: script de import (contatos + histórico de conversas)
- Confirmado que NÃO há: automações do Chatwoot (0), macros (0), campanhas (0), atributos customizados (0), agent bots (0)
- No n8n só 3 workflows ativos são do LGF: triagem, relay de saída e o vigia

## Fora do app (fluxos n8n que viram nativos aqui)
- Triagem com botões / distribuição de leads por setor
- Relay Chatwoot ↔ UaZapi (no mvf o canal já é nativo)
- Vigia de entregas (marcar falha quando a mensagem não é entregue)

## Pegadinhas conhecidas (aprendidas na dor)
- **Entrega ≠ "enviado"**: só há entrega quando o provedor devolve o id da mensagem.
  Sem isso, marcar como falha e sinalizar na conversa.
- **9º dígito**: casar número com/sem o 9 antes de criar contato novo (evita duplicado).
- **LID**: número pode ter WhatsApp e mesmo assim não receber (sem LID no servidor).
