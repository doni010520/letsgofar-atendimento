/**
 * Normalização de texto para busca: sem acento, sem caixa, sem espaço nas
 * pontas. "André" tem que ser achado digitando "andre".
 */
export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}
