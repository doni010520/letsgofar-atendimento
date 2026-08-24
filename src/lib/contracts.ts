/**
 * Assinatura eletrônica pública (sem login).
 *
 * O que dá validade é a EVIDÊNCIA: IP, user-agent, data/hora, confirmação de
 * nome/CPF e hash. Base legal: MP 2.200-2/2001 e Lei 14.063/2020.
 * Roda com service role porque quem assina não é usuário do sistema.
 */

import { createHash } from "crypto";
import { notifySigned, notifyRefused, notifyCompleted } from "@/lib/contract-notify";
import { createServiceClient } from "@/lib/supabase/server";

export type SignerView = {
  id: string;
  name: string;
  email: string;
  document: string | null;
  status: string;
  contract: {
    id: string;
    number: string;
    title: string;
    content_html: string;
    status: string;
    organization_id: string;
  };
};

/** Carrega o signatário pelo token do link e marca a visualização. */
export async function loadSignerByToken(token: string): Promise<SignerView | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("contract_signers")
    .select("id, name, email, document, status, viewed_at, contracts(id, number, title, content_html, status, organization_id)")
    .eq("sign_token", token)
    .maybeSingle();

  if (!data) return null;
  const row = data as unknown as SignerView & { viewed_at: string | null };
  if (!row.contract) return null;

  if (!row.viewed_at) {
    await db
      .from("contract_signers")
      .update({ viewed_at: new Date().toISOString() })
      .eq("id", row.id);
    await db.from("contract_activities").insert({
      organization_id: row.contract.organization_id,
      contract_id: row.contract.id,
      signer_id: row.id,
      kind: "viewed",
    });
  }

  return row;
}

type ContratoPortao = { status: string; expires_at: string | null };

/**
 * Portão de validade do CONTRATO (o resto do código só olhava o status do
 * SIGNATÁRIO). Sem isto, um link de contrato cancelado, recusado ou vencido
 * continuava assinando normalmente — o Chatwoot devolvia 410 nesses casos.
 *
 * Também materializa o vencimento: `expires_at` era gravado no envio e nunca
 * lido em lugar nenhum, então `expired` era um status morto que jamais
 * acontecia. Aqui ele vira realidade na primeira vez que alguém toca o link.
 */
async function portaoDoContrato(
  db: ReturnType<typeof createServiceClient>,
  contractId: string,
  organizationId: string,
  c: ContratoPortao | null,
): Promise<string | null> {
  if (!c) return "Link inválido.";
  if (c.status === "cancelled") return "Este contrato foi cancelado e não pode mais ser assinado.";
  if (c.status === "refused") return "Este contrato foi recusado e não pode mais ser assinado.";

  if (c.expires_at) {
    // `expires_at` costuma vir só como data (AAAA-MM-DD): vale até o fim do dia.
    const limite = c.expires_at.length === 10 ? `${c.expires_at}T23:59:59Z` : c.expires_at;
    if (new Date(limite).getTime() < Date.now()) {
      if (c.status !== "expired") {
        await db.from("contracts").update({ status: "expired" }).eq("id", contractId);
        await db.from("contract_activities").insert({
          organization_id: organizationId,
          contract_id: contractId,
          kind: "expired",
        });
      }
      return "O prazo para assinatura deste contrato venceu. Peça um link novo.";
    }
  }

  if (!["pending", "partially_signed"].includes(c.status)) {
    return "Este contrato não está disponível para assinatura.";
  }
  return null;
}

/** Registra a assinatura com as evidências. */
export async function signContract(params: {
  token: string;
  confirmationName: string;
  confirmationDocument?: string | null;
  ip: string | null;
  userAgent: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const db = createServiceClient();
  const { data } = await db
    .from("contract_signers")
    .select("id, name, email, status, contract_id, organization_id, contracts(status, expires_at, title, number, created_by, organization_id)")
    .eq("sign_token", params.token)
    .maybeSingle();

  const signer = data as unknown as {
    id: string;
    name: string;
    email: string;
    status: string;
    contract_id: string;
    organization_id: string;
    contracts: ContratoPortao & { title: string; number: string; created_by: string | null; organization_id: string } | null;
  } | null;

  if (!signer) return { ok: false, error: "Link inválido." };
  if (signer.status !== "pending") return { ok: false, error: "Este contrato já foi respondido." };
  const barrado = await portaoDoContrato(db, signer.contract_id, signer.organization_id, signer.contracts);
  if (barrado) return { ok: false, error: barrado };
  if (!params.confirmationName.trim()) return { ok: false, error: "Confirme seu nome completo." };

  const signedAt = new Date().toISOString();
  const hash = createHash("sha256")
    .update(`${signer.id}|${params.confirmationName}|${params.ip ?? ""}|${signedAt}`)
    .digest("hex");

  await db.from("contract_signatures").insert({
    organization_id: signer.organization_id,
    signer_id: signer.id,
    ip_address: params.ip,
    user_agent: params.userAgent,
    confirmation_name: params.confirmationName.trim(),
    confirmation_document: params.confirmationDocument?.trim() || null,
    signature_hash: hash,
    signed_at: signedAt,
  });

  await db
    .from("contract_signers")
    .update({ status: "signed", signed_at: signedAt })
    .eq("id", signer.id);

  await db.from("contract_activities").insert({
    organization_id: signer.organization_id,
    contract_id: signer.contract_id,
    signer_id: signer.id,
    kind: "signed",
    ip_address: params.ip,
  });

  await refreshContractStatus(signer.contract_id);

  // E-mails são best-effort: a assinatura já está gravada e NÃO pode ser
  // desfeita por falha de envio.
  const ct = signer.contracts;
  if (ct) {
    const info = { title: ct.title, number: ct.number, organization_id: ct.organization_id };
    await notifySigned({ name: signer.name, email: signer.email }, info, { assinadoEm: signedAt, hash })
      .catch((e) => console.error("e-mail de confirmação falhou:", (e as Error).message));

    const { data: atual } = await db.from("contracts").select("status").eq("id", signer.contract_id).maybeSingle();
    if ((atual as { status: string } | null)?.status === "signed") {
      const dono = await emailDoCriador(db, ct.created_by);
      if (dono) {
        await notifyCompleted(dono, info)
          .catch((e) => console.error("e-mail de conclusão falhou:", (e as Error).message));
      }
    }
  }
  return { ok: true };
}

/** E-mail de quem criou o contrato, para os avisos de recusa e conclusão. */
async function emailDoCriador(
  db: ReturnType<typeof createServiceClient>,
  createdBy: string | null,
): Promise<string | null> {
  if (!createdBy) return null;
  const { data } = await db.from("profiles").select("email").eq("id", createdBy).maybeSingle();
  return (data as { email: string } | null)?.email ?? null;
}

/** Recusa com motivo. */
export async function refuseContract(params: {
  token: string;
  reason: string;
  ip: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const db = createServiceClient();
  const { data } = await db
    .from("contract_signers")
    .select("id, name, status, contract_id, organization_id, contracts(status, expires_at, title, number, created_by, organization_id)")
    .eq("sign_token", params.token)
    .maybeSingle();

  const signer = data as unknown as {
    id: string; name: string; status: string; contract_id: string; organization_id: string;
    contracts: (ContratoPortao & { title: string; number: string; created_by: string | null; organization_id: string }) | null;
  } | null;
  if (!signer) return { ok: false, error: "Link inválido." };
  if (signer.status !== "pending") return { ok: false, error: "Este contrato já foi respondido." };
  const barrado = await portaoDoContrato(db, signer.contract_id, signer.organization_id, signer.contracts);
  if (barrado) return { ok: false, error: barrado };

  await db
    .from("contract_signers")
    .update({ status: "refused", refused_at: new Date().toISOString(), refusal_reason: params.reason })
    .eq("id", signer.id);

  await db.from("contract_activities").insert({
    organization_id: signer.organization_id,
    contract_id: signer.contract_id,
    signer_id: signer.id,
    kind: "refused",
    metadata: { reason: params.reason },
    ip_address: params.ip,
  });

  await db.from("contracts").update({ status: "refused" }).eq("id", signer.contract_id);

  // Recusa passava em silêncio: quem criou o contrato não ficava sabendo.
  const ct = signer.contracts;
  if (ct) {
    const dono = await emailDoCriador(db, ct.created_by);
    if (dono) {
      await notifyRefused(dono, signer.name, { title: ct.title, number: ct.number, organization_id: ct.organization_id }, params.reason)
        .catch((e) => console.error("e-mail de recusa falhou:", (e as Error).message));
    }
  }
  return { ok: true };
}

/** Recalcula o status do contrato a partir dos signatários. */
async function refreshContractStatus(contractId: string) {
  const db = createServiceClient();
  const { data: signers } = await db
    .from("contract_signers")
    .select("status")
    .eq("contract_id", contractId);

  const list = (signers ?? []) as { status: string }[];
  if (!list.length) return;

  if (list.some((s) => s.status === "refused")) {
    await db.from("contracts").update({ status: "refused" }).eq("id", contractId);
    return;
  }
  if (list.every((s) => s.status === "signed")) {
    await db
      .from("contracts")
      .update({ status: "signed", signed_at: new Date().toISOString() })
      .eq("id", contractId);
    return;
  }
  if (list.some((s) => s.status === "signed")) {
    await db.from("contracts").update({ status: "partially_signed" }).eq("id", contractId);
  }
}
