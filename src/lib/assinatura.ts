/**
 * Quem decide se a mensagem sai assinada com "*Nome:*".
 *
 * Duas camadas: a organização define o PADRÃO (Ajustes → Configurações, só
 * admin), e cada atendente pode divergir dele. Antes existia só a camada da
 * organização, e o botão "Assinatura" na conversa tentava gravar nela — mas a
 * RLS de `organizations` só aceita admin. Quem atende clicava, o banco recusava
 * e o botão voltava sozinho: "não consigo desligar a assinatura".
 *
 * `false` do atendente é uma resposta LEGÍTIMA, não "não respondeu" — por isso
 * a distinção entre `false` e `null`/`undefined` importa aqui.
 *
 * Testes: `npx tsx scripts/verify-assinatura.mjs`.
 */
export function deveAssinar(
  preferenciaDoAtendente: boolean | null | undefined,
  padraoDaOrganizacao: unknown,
): boolean {
  if (typeof preferenciaDoAtendente === "boolean") return preferenciaDoAtendente;
  return padraoDaOrganizacao === true;
}
