import { createClient } from "@/lib/supabase/server";
import { getProvider } from "@/lib/whatsapp";
import type { Channel } from "@/lib/types";
import { sendMail } from "@/lib/mail";

type Signer = { name: string; email: string; phone: string | null; sign_token: string };
type ContractInfo = { title: string; number: string; organization_id: string };

function signUrl(token: string): string {
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  return `${base}/assinar/${token}`;
}

function emailHtml(signer: Signer, contract: ContractInfo): string {
  const url = signUrl(signer.sign_token);
  return `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">
      <p>Olá, ${signer.name}!</p>
      <p>Você tem um contrato para assinar: <strong>${contract.title}</strong> (${contract.number}).</p>
      <p style="margin:24px 0">
        <a href="${url}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">
          Ver e assinar contrato
        </a>
      </p>
      <p style="font-size:13px;color:#6b7280">Ou copie este link: ${url}</p>
    </div>
  `;
}

function whatsappText(signer: Signer, contract: ContractInfo): string {
  return `Olá, ${signer.name}! Você tem um contrato para assinar: *${contract.title}* (${contract.number}).\n\nAcesse o link para ver e assinar:\n${signUrl(signer.sign_token)}`;
}

/**
 * Manda o link de assinatura por e-mail (sempre) e WhatsApp (se o
 * signatário tiver telefone cadastrado). Antes disto, "Enviar para
 * assinatura" só mudava o status — o signatário nunca recebia nada.
 */
export async function notifySigners(contract: ContractInfo, signers: Signer[]) {
  const sb = await createClient();
  const { data: channel } = await sb
    .from("channels")
    .select("*")
    .eq("organization_id", contract.organization_id)
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();

  for (const signer of signers) {
    await sendMail({
      to: signer.email,
      subject: `Contrato para assinatura: ${contract.title}`,
      html: emailHtml(signer, contract),
    }).catch((e) => console.error(`e-mail p/ ${signer.email} falhou:`, (e as Error).message));

    if (signer.phone && channel) {
      await getProvider(channel as Channel)
        .sendText({ to: signer.phone, text: whatsappText(signer, contract) })
        .catch((e) => console.error(`whatsapp p/ ${signer.phone} falhou:`, (e as Error).message));
    }
  }
}
