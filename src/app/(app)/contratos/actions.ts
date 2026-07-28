"use server";

import { randomUUID, createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { orgUpdate, orgDelete } from "@/lib/crud-helpers";
import { renderTemplate } from "@/lib/contract-template";

export async function createTemplate(fd: FormData) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();
  await sb.from("contract_templates").insert({
    organization_id: session.organization.id,
    created_by: session.profile?.id ?? null,
    name: String(fd.get("name") || "").trim(),
    description: String(fd.get("description") || "").trim() || null,
    content_html: String(fd.get("content_html") || ""),
  });
  revalidatePath("/contratos");
}

export async function createContract(fd: FormData) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const org = session.organization.id;
  const sb = await createClient();

  const templateId = String(fd.get("template_id") || "").trim() || null;
  let html = String(fd.get("content_html") || "");

  const variables: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("var_")) variables[k.slice(4)] = String(v);
  }

  if (templateId && !html) {
    const { data: tpl } = await sb
      .from("contract_templates")
      .select("content_html")
      .eq("id", templateId)
      .single();
    html = (tpl as { content_html: string } | null)?.content_html ?? "";
  }
  html = renderTemplate(html, variables);

  const { data: numberRow } = await sb.rpc("next_contract_number", { org });
  const number = (numberRow as string) ?? `CTR-${new Date().getFullYear()}-00001`;

  const { data: contract, error } = await sb
    .from("contracts")
    .insert({
      organization_id: org,
      created_by: session.profile?.id ?? null,
      template_id: templateId,
      contact_id: String(fd.get("contact_id") || "").trim() || null,
      number,
      title: String(fd.get("title") || "").trim() || "Contrato",
      content_html: html,
      variables,
      plan_start_date: String(fd.get("plan_start_date") || "").trim() || null,
      plan_end_date: String(fd.get("plan_end_date") || "").trim() || null,
      document_hash: createHash("sha256").update(`${number}|${html}`).digest("hex"),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const contractId = (contract as { id: string }).id;

  // Signatários enviados no formulário (nome/email/cpf em paralelo).
  const names = fd.getAll("signer_name").map(String);
  const emails = fd.getAll("signer_email").map(String);
  const docs = fd.getAll("signer_document").map(String);

  const signers = names
    .map((name, i) => ({ name: name.trim(), email: (emails[i] ?? "").trim(), document: (docs[i] ?? "").trim() }))
    .filter((s) => s.name && s.email)
    .map((s, i) => ({
      organization_id: org,
      contract_id: contractId,
      name: s.name,
      email: s.email,
      document: s.document || null,
      sign_token: randomUUID(),
      sign_order: i + 1,
    }));

  if (signers.length) await sb.from("contract_signers").insert(signers);

  await sb.from("contract_activities").insert({
    organization_id: org,
    contract_id: contractId,
    profile_id: session.profile?.id ?? null,
    kind: "created",
    metadata: { number },
  });

  revalidatePath("/contratos");
  return contractId;
}

/** Coloca o contrato em circulação (gera os links de assinatura). */
export async function sendContract(id: string) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();

  const { count } = await sb
    .from("contract_signers")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", id);
  if (!count) throw new Error("Adicione ao menos um signatário.");

  await sb
    .from("contracts")
    .update({
      status: "pending",
      sent_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    })
    .eq("id", id);

  await sb.from("contract_activities").insert({
    organization_id: session.organization.id,
    contract_id: id,
    profile_id: session.profile?.id ?? null,
    kind: "sent",
  });

  revalidatePath("/contratos");
}

export async function cancelContract(id: string) {
  await orgUpdate("contracts", id, { status: "cancelled" });
  revalidatePath("/contratos");
}

export async function deleteContract(id: string) {
  await orgDelete("contracts", id);
  revalidatePath("/contratos");
}
