import { normalizar } from "@/lib/texto";

/**
 * Recortes por pessoa e busca das tarefas.
 *
 * Módulo puro porque a mesma regra vale para as três visões (lista, kanban e
 * calendário) e porque o recorte "recebidas" nasceu de um mal-entendido que
 * vale fixar em teste: já existia "Delegadas por mim" (o que EU dei para os
 * outros), e a Ianka pediu justamente o espelho — "as que RECEBEMOS de
 * terceiros e não misturar com as nossas".
 *
 * Testes: `npx tsx scripts/verify-task-filtros.mjs`.
 */

export type EscopoPessoa = "todas" | "minhas" | "delegadas" | "recebidas";

export type TarefaLike = {
  assigned_to?: string | null;
  created_by?: string | null;
  title?: string | null;
  description?: string | null;
};

/**
 * A tarefa entra no recorte escolhido?
 *
 * - `minhas`     — sou a responsável, tenha eu criado ou não.
 * - `delegadas`  — EU criei e passei para outra pessoa (acompanhar o que saiu).
 * - `recebidas`  — outra pessoa criou e passou PARA MIM (o pedido da Ianka).
 *
 * Sem `meId` não há "eu": qualquer recorte pessoal devolve tudo, em vez de
 * esvaziar a tela sem explicação.
 */
export function noEscopo(t: TarefaLike, escopo: EscopoPessoa, meId: string | null | undefined): boolean {
  if (escopo === "todas" || !meId) return true;
  const minha = t.assigned_to === meId;
  const criadaPorMim = t.created_by === meId;
  if (escopo === "minhas") return minha;
  if (escopo === "delegadas") return criadaPorMim && !minha;
  return minha && !criadaPorMim; // recebidas
}

/**
 * A tarefa casa com o termo buscado?
 *
 * Procura no título, na descrição e no NOME de quem é responsável — buscar
 * "luana" tem que achar o que está com a Luana, não só o que tem "luana"
 * escrito no título. Termo vazio não filtra nada.
 */
export function casaBusca(
  t: TarefaLike,
  termo: string,
  nomeDoResponsavel?: string | null,
): boolean {
  const alvo = normalizar(termo);
  if (!alvo) return true;
  const campos = [t.title ?? "", t.description ?? "", nomeDoResponsavel ?? ""];
  return campos.some((c) => normalizar(c).includes(alvo));
}
