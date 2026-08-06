/**
 * Reconstrói `variable_fields` dos modelos de contrato a partir dos marcadores
 * do próprio HTML.
 *
 * Os modelos vieram do Chatwoot com o texto completo mas com a lista de campos
 * VAZIA — e é dela que o formulário tira o que perguntar. Resultado: o app
 * pedia só data de início, fim e signatário, e gerava um contrato em branco que
 * não dava para preencher. Os marcadores estavam lá o tempo todo: 24 no modelo
 * de Assessoria, 26 no de Aulas em Grupo.
 *
 *   node scripts/campos-dos-modelos.mjs            # simulação
 *   node scripts/campos-dos-modelos.mjs --gravar
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const GRAVAR = process.argv.includes("--gravar");
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/** Rótulos em português. Sem isto o formulário mostraria "contractor_cep". */
const ROTULOS = {
  contractor_name: "Nome do contratante",
  contractor_cpf: "CPF",
  contractor_rg: "RG",
  contractor_birthdate: "Data de nascimento",
  contractor_email: "E-mail",
  contractor_phone: "Telefone",
  contractor_address: "Endereço",
  contractor_street: "Rua",
  contractor_number: "Número",
  contractor_complement: "Complemento",
  contractor_neighborhood: "Bairro",
  contractor_city: "Cidade",
  contractor_state: "Estado",
  contractor_cep: "CEP",
  legal_representative_name: "Nome do responsável legal",
  legal_representative_cpf: "CPF do responsável legal",
  contract_date: "Data do contrato",
  plan_name: "Plano",
  plan_duration: "Duração do plano",
  plan_start_date: "Início do plano",
  plan_end_date: "Fim do plano",
  plan_value: "Valor do plano",
  enrollment_fee: "Taxa de matrícula",
  lessons_count: "Quantidade de aulas",
  installments_count: "Número de parcelas",
  first_installment_value: "Valor da primeira parcela",
  first_installment_date: "Data da primeira parcela",
  installment_due_day: "Dia do vencimento",
  sessions_call_estrategica: "Sessões: call estratégica",
  sessions_individual: "Sessões individuais",
  sessions_group_consultive: "Sessões consultivas em grupo",
  sessions_group_meetings: "Encontros em grupo",
};

/** Tipo do campo: muda o teclado no celular e evita data digitada errado. */
function tipoDe(chave) {
  if (/_date$|birthdate/.test(chave)) return "date";
  if (/value|fee|price/.test(chave)) return "currency";
  if (/count|_day$|sessions_|number$/.test(chave)) return "number";
  if (/email/.test(chave)) return "email";
  if (/phone/.test(chave)) return "tel";
  return "text";
}

/** Rótulo de emergência para marcador que não está no dicionário. */
const rotuloAuto = (c) => c.replace(/_/g, " ").replace(/^./, (m) => m.toUpperCase());

const { data: modelos } = await db.from("contract_templates").select("id, name, content_html, variable_fields");

for (const m of modelos ?? []) {
  // Ordem de APARIÇÃO no contrato: preencher na ordem em que se lê o documento
  // é menos confuso do que numa ordem alfabética qualquer.
  const chaves = [...new Set([...(m.content_html ?? "").matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((x) => x[1]))];
  const campos = chaves.map((k) => ({
    key: k,
    label: ROTULOS[k] ?? rotuloAuto(k),
    type: tipoDe(k),
  }));

  const jaTinha = (m.variable_fields ?? []).length;
  console.log(`\n${m.name}`);
  console.log(`  tinha ${jaTinha} campos -> passa a ter ${campos.length}`);
  const semRotulo = campos.filter((c) => !ROTULOS[c.key]);
  if (semRotulo.length) console.log(`  sem rótulo no dicionário (nome automático): ${semRotulo.map((c) => c.key).join(", ")}`);

  if (GRAVAR) {
    const { error } = await db.from("contract_templates").update({ variable_fields: campos }).eq("id", m.id);
    console.log(error ? `  ERRO: ${error.message}` : "  gravado.");
  }
}

if (!GRAVAR) console.log("\n(simulação — rode com --gravar para gravar)");
