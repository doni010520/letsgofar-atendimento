/** Substitui {{variavel}} pelo valor informado no corpo do contrato. */
export function renderTemplate(html: string, variables: Record<string, string>): string {
  return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => variables[key] ?? "");
}
