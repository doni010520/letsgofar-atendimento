/**
 * Quem é o contrato, do ponto de vista de quem procura por ele.
 *
 * A Luana consulta contrato por ALUNO, não por número: "se precisarmos
 * consultar um aluno específico, não aparece o nome, aí teríamos que baixar
 * um por um até achar". O nome sempre esteve em `contract_signers.name` — só
 * não era mostrado em lugar nenhum depois que o contrato saía de "aguardando
 * assinatura".
 *
 * Módulo próprio e sem dependência de nada para a lista e o PDF darem a MESMA
 * resposta: o nome que ela lê no card tem que ser o mesmo que vem no arquivo
 * baixado, senão a busca continua sendo por tentativa.
 *
 * Testes: `node scripts/verify-contract-nome.mjs`.
 */

export type SignatarioLike = {
  name?: string | null;
  status?: string | null;
};

/**
 * Nomes que identificam o contrato: quem ASSINOU, se alguém assinou; senão,
 * quem foi listado para assinar.
 *
 * A preferência por quem assinou é o pedido literal ("o nome do aluno que
 * assinou o contrato"). Num contrato ainda pendente não há assinante, e aí o
 * previsto é melhor que nada — é o mesmo nome que aparecerá quando assinar.
 */
export function assinantes(signers: SignatarioLike[] | null | undefined): string[] {
  const comNome = (signers ?? [])
    .map((s) => ({ nome: (s?.name ?? "").trim(), status: s?.status ?? null }))
    .filter((s) => s.nome);
  const assinaram = comNome.filter((s) => s.status === "signed");
  return (assinaram.length ? assinaram : comNome).map((s) => s.nome);
}

/**
 * Junta os nomes numa linha curta. Contrato de aula em grupo tem vários
 * signatários e a lista não pode virar um parágrafo.
 */
export function resumoNomes(nomes: string[], max = 2): string {
  if (!nomes.length) return "";
  if (nomes.length <= max) return nomes.join(" e ");
  return `${nomes.slice(0, max).join(", ")} +${nomes.length - max}`;
}

/**
 * Proibidos em nome de arquivo no Windows. Espaço e hífen NÃO entram aqui: são
 * válidos e são o que deixa o nome legível.
 */
const ILEGAIS_EM_ARQUIVO = /[\\/:*?"<>|]/g;

/**
 * Título da página imprimível — e, por tabela, o nome do arquivo que sai do
 * "Imprimir -> Salvar como PDF", porque o navegador usa o `document.title`.
 *
 * Era ISSO que fazia todo contrato baixar como "Let's Go Far — Atendimento.pdf":
 * a página do PDF não definia título nenhum, então herdava o do layout raiz e
 * os arquivos ficavam indistinguíveis na pasta de Downloads.
 */
export function tituloPdfContrato(
  numero: string,
  signers: SignatarioLike[] | null | undefined,
): string {
  const nome = resumoNomes(assinantes(signers));
  const bruto = nome ? `${numero} — ${nome}` : numero;
  return bruto.replace(ILEGAIS_EM_ARQUIVO, "-").replace(/\s+/g, " ").trim();
}

/** Tira acento e caixa: "André" tem que ser achado digitando "andre". */
export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/**
 * Texto onde a busca da lista procura. Junta número, título e signatários para
 * "andre", "CTR-35" e "assessoria" acharem o mesmo contrato.
 */
export function textoBuscavel(c: {
  number?: string | null;
  title?: string | null;
  contract_signers?: SignatarioLike[] | null;
}): string {
  const nomes = (c.contract_signers ?? []).map((s) => s?.name ?? "");
  return normalizar([c.number ?? "", c.title ?? "", ...nomes].join(" "));
}
