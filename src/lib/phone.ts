/**
 * Normalização de telefone brasileiro — usada em TODO lugar que cria ou casa
 * um contato a partir de número digitado por gente (não vindo do webhook).
 *
 * Sem isto: alguém digita "31 98905-6632" (sem o 55 na frente, do jeito que
 * qualquer brasileiro digita um número) na tela de "Nova conversa", o contato
 * nasce como "31989056632". Quando essa pessoa responde de verdade, o
 * WhatsApp manda "553189056632" — nunca bate com o que foi salvo, mesmo com
 * variantesTelefone() cobrindo o 9º dígito, porque o 55 nem está lá. Cria
 * contato/conversa novos, a resposta "some" da conversa de quem mandou
 * primeiro. Foi o caso real da Luana com o Matheus Mello.
 */

/** Só os dígitos, sem nada mais. */
function apenasDigitos(v: string): string {
  return String(v ?? "").replace(/\D/g, "");
}

/**
 * Garante o "55" na frente de um número brasileiro. Se já vier com DDI
 * (12-13 dígitos começando com 55) ou não parecer brasileiro (não bate nem
 * DDD+8 nem DDD+9), devolve como veio — só completa o caso óbvio.
 */
export function normalizarTelefoneBR(raw: string): string {
  const d = apenasDigitos(raw);
  if (!d) return d;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

/**
 * O mesmo celular brasileiro escrito das duas formas: com e sem o 9º dígito.
 *
 * O WhatsApp entrega ora um, ora outro, para a MESMA pessoa. Sem comparar as
 * duas formas, o contato é criado de novo e o histórico se parte em dois.
 */
export function variantesTelefone(telefone: string): string[] {
  const d = normalizarTelefoneBR(telefone);
  if (!d) return [];
  const v = new Set([d]);
  const m = d.match(/^55(\d{2})(\d{8,9})$/);
  if (m) {
    const [, ddd, resto] = m;
    if (resto.length === 9 && resto.startsWith("9")) v.add(`55${ddd}${resto.slice(1)}`);
    if (resto.length === 8) v.add(`55${ddd}9${resto}`);
  }
  return [...v];
}
