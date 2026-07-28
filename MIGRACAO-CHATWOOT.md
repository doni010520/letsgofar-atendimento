# Migração Chatwoot → letsgofar-atendimento

Inventário levantado por **diff real** contra o Chatwoot v4.10.1 (273 arquivos
adicionados, 396 modificados pelo fork) — não pelo README.

Base: `mvf-atendimento` (Next.js 16 + TypeScript + Tailwind v4 + Supabase).

## Legenda
- [ ] pendente · [x] concluído · ~~riscado~~ = já existe no mvf

---

## A. Módulos completos

### A1. CRM / Kanban (67 arquivos no Chatwoot)
- [ ] Pipelines e estágios (posição, cor, ordenação)
- [ ] Cards = conversas/contatos no funil
- [ ] Valor do negócio (`deal_value`), ganho/perdido, data de fechamento
- [ ] Campos personalizados por pipeline (+ valores)
- [ ] Motor de automações: 8 gatilhos × 10 ações + logs de execução
- [ ] Atividades/timeline por conversa
- [ ] Permissões de CRM por usuário (visibilidade)
- [ ] Dashboard do Kanban + Dashboard de controle de leads

### A2. Contratos (41 arquivos)
- [ ] Modelos de contrato com variáveis dinâmicas
- [ ] Geração, edição, preview e PDF
- [ ] Assinatura pública por token (sem login)
- [ ] Múltiplos signatários, ordem, auto-assinatura da empresa, CPF
- [ ] Evidências jurídicas: IP, user-agent, timestamp, hash
- [ ] Recusa com motivo + timeline + e-mails
- [ ] Filtros: todos/rascunhos/aguardando/assinados/recusados/modelos

### A3. Tarefas (19 arquivos)
- [ ] Tarefa com checklist, comentários, labels, anexos
- [ ] Recorrência (diária/semanal/mensal/custom)
- [ ] Prazo + hora, prioridade, status, lembrete
- [ ] Vínculo com contato/conversa/pipeline
- [ ] Views: lista, calendário, kanban, estatísticas
- [ ] Multi-responsável (1 tarefa → N cópias independentes)

### A4. Disparos (18 arquivos) — `campaigns` do mvf é base parcial
- [ ] Espaçamento aleatório entre envios (anti-ban)
- [ ] Janela de horário + teto diário
- [ ] Personalização (`{primeiro_nome}`, merges) + spintax `{a|b}`
- [ ] Fonte: CSV ou contatos salvos
- [ ] Rastreio por destinatário (enviado/falha/pendente) + progresso
- [ ] Atribuição das conversas criadas

### A5. Mensagens Agendadas (4 arquivos)
- [ ] Agendar mensagem para data/hora futura (com anexos)

---

## B. Features sem tabela própria
- [ ] B6. Atributos obrigatórios ao resolver conversa (text/number/link/date/list/checkbox)
- [ ] B7. Copiloto de IA na resposta + sugestão automática de labels
- [ ] B8. Prefixo automático do agente (`**Nome:**`) + tela de configuração
- [ ] B9. Alerta sonoro de tarefas (preferência por usuário)
- [ ] B10. Relatórios: distribuição do tempo de 1ª resposta · matriz inbox×label · contagem de enviadas
- [ ] B11. Painel de CRM dentro da conversa
- [ ] B12. Identidade visual Let's Go Far

---

## C. Comportamentos de núcleo (os mais fáceis de esquecer)
- [ ] C13. Conversa nova **herda** CRM do contato (pipeline/estágio/valor)
- [ ] C14. Log automático de mudanças (estágio/valor/ganho) + dispara automações
- [ ] C15. "Adicionar ao CRM" a partir do contato
- [ ] C16. **Mensagens espelhadas do celular** (echo) entram no sistema e não levam prefixo
- [ ] C17. Reabertura inteligente: reusa conversa não-resolvida em vez de criar outra
- [ ] C18. Limpeza de notificações (>1 mês, máx. 300 por usuário)
- [ ] C19. Faxina de conversas órfãs (12h)
- [ ] C20. Notificação em tempo real de tarefa criada
- [ ] C21. Agendador de 1 em 1 minuto (para o agendamento sair no minuto certo)

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
