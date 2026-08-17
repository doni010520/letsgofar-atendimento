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
  // Formato antigo de tronco (0 + DDD + local, ex.: 011992365226) — troca o
  // "0" pelo "55". Foi o caso do Leandro: cadastrado assim manualmente, nunca
  // batia com o "55..." que o WhatsApp manda quando ele responde de verdade.
  if (d.startsWith("0") && (d.length === 11 || d.length === 12)) {
    const semZero = d.slice(1);
    if (semZero.length === 10 || semZero.length === 11) return `55${semZero}`;
  }
  return d;
}

/**
 * O mesmo celular brasileiro escrito de formas diferentes: com/sem o 9º
 * dígito, com/sem o 55 na frente, ou com o "0" antigo de tronco em vez do 55
 * (ex.: 011992365226). O que identifica o número de verdade é o DDD + os 8
 * dígitos finais — o resto é só forma de escrever o mesmo prefixo.
 *
 * Sem cobrir essas variantes, um contato cadastrado num formato (à mão, por
 * um atendente) nunca casa com o que o WhatsApp manda quando a pessoa
 * responde de verdade: cria contato novo, conversa nova, e o bot de triagem
 * cumprimenta do zero quem já estava no meio de um atendimento (caso real do
 * Leandro: cadastrado como "011992365226", respondeu como "5511992365226").
 */
export function variantesTelefone(telefone: string): string[] {
  const d = normalizarTelefoneBR(telefone);
  if (!d) return [];
  const v = new Set([d]);
  const m = d.match(/^55(\d{2})(\d{8,9})$/);
  if (m) {
    const [, ddd, resto] = m;
    const restos = new Set([resto]);
    if (resto.length === 9 && resto.startsWith("9")) restos.add(resto.slice(1));
    if (resto.length === 8) restos.add(`9${resto}`);
    for (const r of restos) {
      v.add(`55${ddd}${r}`); // com DDI
      v.add(`0${ddd}${r}`); // formato antigo de tronco
      v.add(`${ddd}${r}`); // sem DDI nem tronco, só DDD + local
    }
  }
  return [...v];
}
