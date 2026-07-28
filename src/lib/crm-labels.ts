/**
 * Rótulos de gatilhos e ações do funil.
 * Fica separado do motor porque a interface (client) precisa deles — e o
 * motor importa código de servidor, que não pode ir para o navegador.
 */

export type CrmTrigger =
  | "stage_changed"
  | "deal_won"
  | "deal_lost"
  | "deal_value_changed"
  | "conversation_added"
  | "task_overdue"
  | "task_completed"
  | "lead_stale";

export const TRIGGER_LABELS: Record<CrmTrigger, string> = {
  stage_changed: "Mudança de estágio",
  deal_won: "Negócio ganho",
  deal_lost: "Negócio perdido",
  deal_value_changed: "Valor alterado",
  conversation_added: "Lead adicionado",
  task_overdue: "Tarefa vencida",
  task_completed: "Tarefa concluída",
  lead_stale: "Lead parado",
};

export type CrmActionType =
  | "move_to_stage"
  | "assign_user"
  | "add_tag"
  | "remove_tag"
  | "create_task"
  | "send_webhook"
  | "update_deal_value";

export const ACTION_LABELS: Record<CrmActionType, string> = {
  move_to_stage: "Mover para estágio",
  assign_user: "Atribuir a atendente",
  add_tag: "Adicionar etiqueta",
  remove_tag: "Remover etiqueta",
  create_task: "Criar tarefa",
  send_webhook: "Enviar webhook",
  update_deal_value: "Atualizar valor",
};
