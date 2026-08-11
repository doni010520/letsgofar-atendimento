import { Resend } from "resend";

const FROM = process.env.CONTRACT_MAILER_FROM || "Let's Go Far Contratos <contratos@benitechlab.com>";

/** Envia e-mail via Resend. Sem RESEND_API_KEY configurada, não faz nada (evita quebrar o fluxo em dev). */
export async function sendMail(params: { to: string; subject: string; html: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`RESEND_API_KEY ausente — e-mail "${params.subject}" para ${params.to} não foi enviado.`);
    return;
  }
  const resend = new Resend(key);
  const { error } = await resend.emails.send({ from: FROM, to: params.to, subject: params.subject, html: params.html });
  if (error) throw new Error(`Resend: ${error.message}`);
}
