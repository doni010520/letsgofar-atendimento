/**
 * Regras de anexo de tarefa compartilhadas entre servidor e tela.
 *
 * Fica em módulo próprio porque `tarefas/actions.ts` é `"use server"` e um
 * arquivo desses só pode exportar funções assíncronas — constante nenhuma.
 */

/**
 * Teto por arquivo. Abaixo do `serverActions.bodySizeLimit` (32 MB do
 * next.config.ts) de propósito: o arquivo viaja dentro do corpo da server
 * action e, se estourar o limite do Next, a ação nem chega a rodar e a pessoa
 * fica sem mensagem nenhuma. Cortando antes, ela lê o motivo.
 */
export const MAX_ANEXO_BYTES = 25 * 1024 * 1024;
export const MAX_ANEXO_LABEL = "25 MB";

/** Mensagem pronta quando um arquivo passa do teto — null se estiver tudo bem. */
export function erroDeTamanho(files: File[]): string | null {
  const grande = files.find((f) => f.size > MAX_ANEXO_BYTES);
  return grande ? `"${grande.name}" passa de ${MAX_ANEXO_LABEL} e não pode ser anexado.` : null;
}

/** URL pública do anexo no bucket `media` (bucket é público desde a 0007). */
export function urlDoAnexo(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const seguro = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/media/${seguro}`;
}
