/**
 * Tipagem mínima do `pg` para os scripts operacionais.
 *
 * O pacote vem como dependência transitiva (não está no package.json) e não
 * publica tipos. Os scripts antigos são `.mjs` e escapam do typecheck; os
 * novos são `.ts` porque precisam importar código do app. Isto evita ter de
 * excluir a pasta `scripts/` da verificação.
 */
declare module "pg" {
  export interface QueryResult<T = Record<string, unknown>> {
    rows: T[];
    rowCount: number | null;
  }

  export class Client {
    constructor(config?: {
      connectionString?: string;
      ssl?: boolean | { rejectUnauthorized?: boolean };
    });
    connect(): Promise<void>;
    query<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<QueryResult<T>>;
    end(): Promise<void>;
  }

  const pg: { Client: typeof Client };
  export default pg;
}
