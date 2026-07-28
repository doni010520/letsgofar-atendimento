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
- [ ] Campos personalizados por pipeline (schema pronto, falta UI)
- [x] Motor de automações: 8 gatilhos × 7 ações + logs de execução
- [x] Atividades/timeline por conversa
- [ ] Permissões de CRM por usuário (visibilidade)
- [ ] Dashboard do Kanban + Dashboard de controle de leads

### A2. Contratos (41 arquivos)
- [x] Modelos de contrato com variáveis dinâmicas
- [x] Geração e preview (PDF pendente)
- [x] Assinatura pública por token (sem login)
- [x] Múltiplos signatários, ordem, CPF
- [x] Evidências jurídicas: IP, user-agent, timestamp, hash
- [x] Recusa com motivo + timeline (e-mails pendentes)
- [x] Filtros: todos/rascunhos/aguardando/assinados/recusados/modelos

### A3. Tarefas (19 arquivos)
- [x] Tarefa com checklist e comentários (anexos: schema pronto)
- [x] Recorrência (diária/semanal/mensal/custom)
- [x] Prazo + hora, prioridade, status
- [x] Vínculo com contato/conversa/pipeline
- [x] Views: lista + filtros + estatísticas (calendário/kanban pendentes)
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
- [ ] B6. Atributos obrigatórios ao resolver conversa (text/number/link/date/list/checkbox)
- [ ] B7. Copiloto de IA na resposta + sugestão automática de labels
- [ ] B8. Prefixo automático do agente (`**Nome:**`) + tela de configuração
- [x] B9. Alerta sonoro de tarefas (preferência por usuário)
- [ ] B10. Relatórios: distribuição do tempo de 1ª resposta · matriz inbox×label · contagem de enviadas
- [ ] B11. Painel de CRM dentro da conversa
- [ ] B12. Identidade visual Let's Go Far

---

## C. Comportamentos de núcleo (os mais fáceis de esquecer)
- [x] C13. Conversa nova **herda** CRM do contato (pipeline/estágio/valor)
- [x] C14. Log automático de mudanças (estágio/valor/ganho) + dispara automações
- [x] C15. "Adicionar ao CRM" a partir do contato
- [x] C16. **Mensagens espelhadas do celular** (echo) — ~~já nativo no mvf~~ (`inbound.ts` fromMe)
- [x] C17. Reabertura inteligente — nativo no mvf + reforçado no disparo
- [ ] C18. Limpeza de notificações (>1 mês, máx. 300 por usuário)
- [ ] C19. Faxina de conversas órfãs (12h)
- [ ] C20. Notificação em tempo real de tarefa criada
- [x] C21. Agendador — jobs ligados ao cron in-process do mvf

---

## Fora do app (fluxos n8n que viram nativos aqui)
- Triagem com botões / distribuição de leads por setor
- Relay Chatwoot ↔ UaZapi (no mvf o canal já é nativo)
- Vigia de entregas (marcar falha quando a mensagem não é entregue)

## Pegadinhas conhecidas (aprendidas na dor)
- **Entrega ≠ "enviado"**: só há entrega quando o provedor devolve o id da mensagem.
  Sem isso, marcar como falha e sinalizar na conversa.
- **9º dígito**: casar número com/sem o 9 antes de criar contato novo (evita duplicado).
- **LID**: número pode ter WhatsApp e mesmo assim não receber (sem LID no servidor).
