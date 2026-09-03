/**
 * Quem manda no nome do contato: a atendente, não o WhatsApp.
 *
 * O nome que chega no webhook é o *push name* — o que a PESSOA escolheu no
 * aparelho dela. Serve para não deixar o contato sem nome nenhum, mas não pode
 * mandar no cadastro: quem atende corrige "Antônio" onde o cliente pôs só um
 * emoji, e essa correção tem que sobreviver à próxima mensagem dele.
 *
 * O bug que isto encerra: `inbound.ts` regravava `contacts.name` com o push
 * name em TODA mensagem recebida de contato já existente. A atendente editava,
 * salvava de verdade, e a mensagem seguinte do cliente desfazia — "eu já
 * editei 3 vezes e não salva, só fica esse emoji". O portão certo existia
 * logo abaixo, mas nunca alcançava nada porque a sobrescrita vinha antes.
 *
 * Testes: `npx tsx scripts/verify-nome-contato.mjs`.
 */

export type EntradaNome = {
  /** Nome que já está gravado no cadastro (pode ter sido digitado por humano). */
  atual?: string | null;
  /** Push name do contato, vindo do webhook. */
  contactName?: string | null;
  /** Nome do chat, vindo do webhook. */
  chatName?: string | null;
  /** A mensagem é um eco de algo que NÓS enviamos. */
  fromMe?: boolean;
  isGroup?: boolean;
};

/**
 * Nome a GRAVAR, ou `null` para não mexer.
 *
 * Regra única: só preenche o que está vazio. Nunca sobrescreve.
 */
export function nomeParaGravar({
  atual,
  contactName,
  chatName,
  fromMe = false,
  isGroup = false,
}: EntradaNome): string | null {
  // Já tem nome? Não se toca. Vale inclusive para nome "estranho" (um emoji,
  // um caractere invisível): se está lá, ou veio do WhatsApp e ninguém mexeu,
  // ou foi escolhido por quem atende. Nos dois casos, sobrescrever é pior.
  if (atual != null && atual.trim() !== "") return null;

  // Em 1:1, eco de mensagem NOSSA traz o nome do DONO da conta, não o do
  // cliente — gravaria "LET'S GO FAR" como nome do contato.
  const ecoProprio = fromMe && !isGroup;

  const doContato = (contactName ?? "").trim();
  if (doContato && !ecoProprio) return doContato;

  const doChat = (chatName ?? "").trim();
  if (doChat && !ecoProprio) return doChat;

  return null;
}
