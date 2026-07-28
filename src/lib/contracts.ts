/**
 * Assinatura eletrônica pública (sem login).
 *
 * O que dá validade é a EVIDÊNCIA: IP, user-agent, data/hora, confirmação de
 * nome/CPF e hash. Base legal: MP 2.200-2/2001 e Lei 14.063/2020.
 * Roda com service role porque quem assina não é usuário do sistema.
 */

import { createHash } from "crypto";
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
    .select("id, name, status, contract_id, organization_id")
    .eq("sign_token", params.token)
    .maybeSingle();

  const signer = data as {
    id: string;
    name: string;
    status: string;
    contract_id: string;
    organization_id: string;
  } | null;

  if (!signer) return { ok: false, error: "Link inválido." };
  if (signer.status !== "pending") return { ok: false, error: "Este contrato já foi respondido." };
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
  return { ok: true };
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
    .select("id, status, contract_id, organization_id")
    .eq("sign_token", params.token)
    .maybeSingle();

  const signer = data as {
    id: string; status: string; contract_id: string; organization_id: string;
  } | null;
  if (!signer) return { ok: false, error: "Link inválido." };
  if (signer.status !== "pending") return { ok: false, error: "Este contrato já foi respondido." };

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
