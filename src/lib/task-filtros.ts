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

/** Colunas CALCULADAS — não existem no banco, são relativas a quem olha. */
export const COL_DELEGADAS = "__delegadas__";
export const COL_RECEBIDAS = "__recebidas__";

const FINALIZADAS = new Set(["completed", "cancelled"]);

/**
 * Em QUAL coluna do quadro a tarefa aparece.
 *
 * "Delegadas" e "Recebidas" são colunas CALCULADAS, e é isso que as torna
 * possíveis: a MESMA tarefa é "delegada" para quem passou e "recebida" para
 * quem recebeu. Gravada no banco, uma coluna dessas seria mentira para metade
 * do time; calculada por quem está olhando, ela é sempre verdadeira. Foi por
 * isso que a coluna "DELEGADAS" fixa não daria certo e esta dá.
 *
 * O pedido da Ianka: "as que a Luana me manda fica misturado com as minhas,
 * então às vezes passa despercebido... no kanban fica tudo junto ali no a
 * fazer". Tirar delegada/recebida de "A fazer" é exatamente o ponto.
 *
 * Ordem de precedência:
 *  1. coluna própria, se ainda existir (escolha explícita de quem arrastou);
 *  2. concluída/cancelada vai para o STATUS — arquivo não pode virar fila, ou
 *     "Delegadas" acumularia tudo que já foi entregue;
 *  3. delegada por mim / recebida de outra pessoa;
 *  4. o status.
 */
export function chaveDaColuna(
  t: {
    status?: string | null;
    column_id?: string | null;
    created_by?: string | null;
    assigned_to?: string | null;
  },
  colunasProprias: Iterable<string>,
  meId?: string | null,
): string {
  const validas = colunasProprias instanceof Set ? colunasProprias : new Set(colunasProprias);
  if (t.column_id && validas.has(t.column_id)) return t.column_id;

  const status = t.status ?? "pending";
  if (FINALIZADAS.has(status)) return status;

  if (meId) {
    const minha = t.assigned_to === meId;
    const criadaPorMim = t.created_by === meId;
    if (criadaPorMim && !minha && t.assigned_to) return COL_DELEGADAS;
    if (minha && !criadaPorMim && t.created_by) return COL_RECEBIDAS;
  }
  return status;
}
