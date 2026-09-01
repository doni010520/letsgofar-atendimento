"use server";

import { randomUUID, createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { orgUpdate, orgDelete } from "@/lib/crud-helpers";
import { renderTemplate } from "@/lib/contract-template";
import { notifySigners } from "@/lib/contract-notify";

export async function createTemplate(fd: FormData) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();

  // Campos vêm serializados em JSON de um editor no formulário — sem isto o
  // modelo nunca ganhava variable_fields, e a tela de criar contrato não
  // tinha como mostrar onde preencher cada {{marcador}} do texto.
  let variableFields: unknown = [];
  try {
    variableFields = JSON.parse(String(fd.get("variable_fields") || "[]"));
  } catch {
    variableFields = [];
  }

  await sb.from("contract_templates").insert({
    organization_id: session.organization.id,
    created_by: session.profile?.id ?? null,
    name: String(fd.get("name") || "").trim(),
    description: String(fd.get("description") || "").trim() || null,
    content_html: String(fd.get("content_html") || ""),
    variable_fields: variableFields,
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
  const phones = fd.getAll("signer_phone").map(String);

  const signers = names
    .map((name, i) => ({
      name: name.trim(),
      email: (emails[i] ?? "").trim(),
      document: (docs[i] ?? "").trim(),
      phone: (phones[i] ?? "").replace(/\D/g, ""),
    }))
    .filter((s) => s.name && s.email)
    .map((s, i) => ({
      organization_id: org,
      contract_id: contractId,
      name: s.name,
      email: s.email,
      document: s.document || null,
      phone: s.phone || null,
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

/**
 * Duplica um contrato: cópia editável, do jeito que o Chatwoot fazia.
 *
 * Pedido literal da Luana: "criei o contrato do André, porém ele pediu para
 * alterar um ponto, e só fiz duplicar, editei a alteração e ele assinou a
 * cópia". Hoje, sem isto, alterar dois pontos de um contrato já enviado
 * obriga a refazer tudo do zero para o mesmo cliente — porque `updateContract`
 * (de propósito) só deixa editar enquanto está em rascunho.
 *
 * A cópia nasce em RASCUNHO e sem vínculo nenhum com o original: número novo,
 * `sign_token` novo por signatário, e nenhuma assinatura/evidência herdada.
 * Duplicar não pode ressuscitar a assinatura de ninguém.
 */
export async function duplicateContract(id: string) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const org = session.organization.id;
  const sb = await createClient();

  const { data } = await sb
    .from("contracts")
    // String literal inteira, sem concatenar: o supabase-js so consegue inferir
    // o shape da linha quando o select e um literal estatico.
    .select("template_id, contact_id, title, content_html, variables, plan_start_date, plan_end_date, contract_signers(name, email, phone, document, sign_order)")
    .eq("id", id)
    .eq("organization_id", org)
    .maybeSingle();
  if (!data) throw new Error("Contrato não encontrado.");

  const orig = data as {
    template_id: string | null;
    contact_id: string | null;
    title: string;
    content_html: string | null;
    variables: Record<string, string> | null;
    plan_start_date: string | null;
    plan_end_date: string | null;
    contract_signers: {
      name: string; email: string; phone: string | null;
      document: string | null; sign_order: number | null;
    }[];
  };

  const { data: numberRow } = await sb.rpc("next_contract_number", { org });
  const number = (numberRow as string) ?? `CTR-${new Date().getFullYear()}-00001`;
  const html = orig.content_html ?? "";

  const { data: novo, error } = await sb
    .from("contracts")
    .insert({
      organization_id: org,
      created_by: session.profile?.id ?? null,
      template_id: orig.template_id,
      contact_id: orig.contact_id,
      number,
      title: orig.title,
      content_html: html,
      variables: orig.variables ?? {},
      plan_start_date: orig.plan_start_date,
      plan_end_date: orig.plan_end_date,
      status: "draft",
      // RECALCULA, não copia: o hash é do par (número, texto). Copiado, a cópia
      // nasceria carregando o hash do original e a evidência de assinatura
      // passaria a apontar para um documento que não é aquele.
      document_hash: createHash("sha256").update(`${number}|${html}`).digest("hex"),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const novoId = (novo as { id: string }).id;

  // Signatários vêm junto (é o ponto do pedido: não redigitar o mesmo cliente),
  // mas ZERADOS — token novo, e status/assinatura ficam no default da tabela.
  const signers = orig.contract_signers
    .filter((x) => x.name?.trim() && x.email?.trim())
    .map((x, i) => ({
      organization_id: org,
      contract_id: novoId,
      name: x.name.trim(),
      email: x.email.trim(),
      document: x.document || null,
      phone: x.phone || null,
      sign_token: randomUUID(),
      sign_order: x.sign_order ?? i + 1,
    }));
  if (signers.length) await sb.from("contract_signers").insert(signers);

  await sb.from("contract_activities").insert({
    organization_id: org,
    contract_id: novoId,
    profile_id: session.profile?.id ?? null,
    kind: "created",
    metadata: { number, duplicado_de: id },
  });

  revalidatePath("/contratos");
  return novoId;
}

/**
 * Busca um contrato completo para edição.
 *
 * Regra igual ao Chatwoot (é o pedido explícito da Luana: "do jeito que
 * estava lá"): só dá pra editar enquanto está em rascunho — depois de
 * enviado, o texto já pode ter ido para quem vai assinar, então trava.
 */
export async function getContractForEdit(id: string) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();

  const { data: contract, error } = await sb
    .from("contracts")
    .select("id, title, status, template_id, content_html, variables, plan_start_date, plan_end_date, contract_signers(id, name, email, document, phone)")
    .eq("id", id)
    .eq("organization_id", session.organization.id)
    .single();
  if (error || !contract) throw new Error("Contrato não encontrado.");
  if (contract.status !== "draft") throw new Error("Só é possível editar contratos em rascunho.");
  return contract;
}

/**
 * Salva as alterações de um contrato em rascunho.
 *
 * Mesma regra de `getContractForEdit`: bloqueia se o status não for mais
 * "draft" — confere de novo aqui (não só na tela) porque entre abrir a
 * edição e salvar alguém pode ter enviado o contrato nesse meio tempo.
 */
export async function updateContract(id: string, fd: FormData) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const org = session.organization.id;
  const sb = await createClient();

  const { data: atual } = await sb.from("contracts").select("status").eq("id", id).eq("organization_id", org).single();
  if (!atual) throw new Error("Contrato não encontrado.");
  if (atual.status !== "draft") throw new Error("Este contrato não está mais em rascunho — não é possível editar.");

  // O editor visual manda o HTML já pronto (modelo + variáveis já aplicados
  // e possivelmente ajustado à mão) — diferente da criação, aqui NÃO
  // re-renderiza o modelo por cima do que a pessoa editou.
  const html = String(fd.get("content_html") || "");
  const variables: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("var_")) variables[k.slice(4)] = String(v);
  }

  const { error } = await sb
    .from("contracts")
    .update({
      title: String(fd.get("title") || "").trim() || "Contrato",
      content_html: html,
      variables,
      plan_start_date: String(fd.get("plan_start_date") || "").trim() || null,
      plan_end_date: String(fd.get("plan_end_date") || "").trim() || null,
      document_hash: createHash("sha256").update(`${id}|${html}`).digest("hex"),
    })
    .eq("id", id)
    .eq("organization_id", org);
  if (error) throw new Error(error.message);

  // Signatários: substitui a lista inteira (apaga e recria) — mais simples
  // e seguro que tentar casar linha a linha quem mudou, considerando que um
  // contrato em rascunho tem poucos signatários e nenhum assinou ainda.
  await sb.from("contract_signers").delete().eq("contract_id", id);
  const names = fd.getAll("signer_name").map(String);
  const emails = fd.getAll("signer_email").map(String);
  const docs = fd.getAll("signer_document").map(String);
  const phones = fd.getAll("signer_phone").map(String);
  const signers = names
    .map((name, i) => ({
      name: name.trim(),
      email: (emails[i] ?? "").trim(),
      document: (docs[i] ?? "").trim(),
      phone: (phones[i] ?? "").replace(/\D/g, ""),
    }))
    .filter((s) => s.name && s.email)
    .map((s, i) => ({
      organization_id: org,
      contract_id: id,
      name: s.name,
      email: s.email,
      document: s.document || null,
      phone: s.phone || null,
      sign_token: randomUUID(),
      sign_order: i + 1,
    }));
  if (signers.length) await sb.from("contract_signers").insert(signers);

  await sb.from("contract_activities").insert({
    organization_id: org,
    contract_id: id,
    profile_id: session.profile?.id ?? null,
    kind: "edited",
  });

  revalidatePath("/contratos");
}

/** Coloca o contrato em circulação: gera os links e avisa cada signatário por e-mail e WhatsApp. */
export async function sendContract(id: string) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();

  const { data: signers } = await sb
    .from("contract_signers")
    .select("name, email, phone, sign_token")
    .eq("contract_id", id)
    .eq("status", "pending");
  if (!signers?.length) throw new Error("Adicione ao menos um signatário.");

  const { data: contract } = await sb
    .from("contracts")
    .select("title, number")
    .eq("id", id)
    .single();

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

  await notifySigners(
    { title: contract?.title ?? "Contrato", number: contract?.number ?? "", organization_id: session.organization.id },
    signers,
  );

  revalidatePath("/contratos");
}

/**
 * Reenvia o link de assinatura pra UM signatário específico (e-mail +
 * WhatsApp, se tiver telefone) — igual ao "Reenviar" do Chatwoot. Faltava
 * isto: depois de "Enviar para assinatura" (que só funciona uma vez, com o
 * contrato em rascunho), não tinha nenhum jeito de mandar de novo pra quem
 * não recebeu ou perdeu a mensagem original. Confirmado com a Luana: ela
 * ficou sem nenhuma forma de reenviar o link do contrato do Lucas Luiz.
 */
export async function resendToSigner(contractId: string, signerId: string) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();

  const { data: signer } = await sb
    .from("contract_signers")
    .select("name, email, phone, sign_token, status")
    .eq("id", signerId)
    .eq("contract_id", contractId)
    .single();
  if (!signer) throw new Error("Signatário não encontrado.");
  if (signer.status !== "pending") throw new Error("Este signatário já assinou ou recusou — não há o que reenviar.");

  const { data: contract } = await sb
    .from("contracts")
    .select("title, number")
    .eq("id", contractId)
    .single();
  if (!contract) throw new Error("Contrato não encontrado.");

  await notifySigners(
    { title: contract.title, number: contract.number, organization_id: session.organization.id },
    [signer],
  );

  await sb.from("contract_activities").insert({
    organization_id: session.organization.id,
    contract_id: contractId,
    profile_id: session.profile?.id ?? null,
    kind: "resent",
    metadata: { signer_id: signerId, signer_name: signer.name },
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
