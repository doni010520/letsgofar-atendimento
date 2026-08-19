/**
 * Campo `<input type="date">` guarda e manda o valor como "AAAA-MM-DD"
 * (padrão HTML/ISO) — mas ninguém quer ver isso no meio de um contrato em
 * português. Detecta esse formato exato e devolve "DD/MM/AAAA"; qualquer
 * outra coisa (texto, valor já formatado, vazio) passa direto, sem mexer.
 */
function paraDataBR(valor: string): string {
  const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return valor;
  const [, ano, mes, dia] = m;
  return `${dia}/${mes}/${ano}`;
}

/** Substitui {{variavel}} pelo valor informado no corpo do contrato. */
export function renderTemplate(html: string, variables: Record<string, string>): string {
  return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const valor = variables[key];
    return valor == null ? "" : paraDataBR(valor);
  });
}
