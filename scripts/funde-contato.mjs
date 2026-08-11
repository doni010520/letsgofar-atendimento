/**
 * Funde dois contatos/conversas duplicados (mesmo número, 9º dígito diferente)
 * em um só, movendo TODAS as tabelas que referenciam contato/conversa — não
 * só mensagens. Achado ao investigar a duplicata da Cristiane Fernandes:
 * existem 25 pares assim na conta, a maioria de antes de qualquer correção
 * recente (a maior parte criada em 01/08, na importação do Chatwoot).
 *
 * Uso: node scripts/funde-contato.mjs <survivorContactId> <loserContactId> [--gravar]
 *
 * O sobrevivente é quem você escolhe passar primeiro — o outro é apagado
 * depois de tudo migrado. Sem --gravar só mostra o que faria.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const [, , SOBREVIVENTE, PERDEDOR, ...flags] = process.argv;
const GRAVAR = flags.includes("--gravar");
if (!SOBREVIVENTE || !PERDEDOR) {
  console.log("uso: node scripts/funde-contato.mjs <sobrevivente> <perdedor> [--gravar]");
  process.exit(1);
}

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: ctS } = await db.from("contacts").select("*").eq("id", SOBREVIVENTE).single();
const { data: ctP } = await db.from("contacts").select("*").eq("id", PERDEDOR).single();
if (!ctS || !ctP) { console.log("contato não encontrado"); process.exit(1); }
if (ctS.organization_id !== ctP.organization_id) { console.log("ABORTADO: organizações diferentes"); process.exit(1); }

console.log(`SOBREVIVE: ${ctS.phone}  "${ctS.name}"`);
console.log(`SOME     : ${ctP.phone}  "${ctP.name}"`);

const { data: cvS } = await db.from("conversations").select("id").eq("contact_id", SOBREVIVENTE);
const { data: cvP } = await db.from("conversations").select("id").eq("contact_id", PERDEDOR);
console.log(`conversas: sobrevivente=${cvS?.length ?? 0}  perdedor=${cvP?.length ?? 0}`);
if ((cvS?.length ?? 0) !== 1 || (cvP?.length ?? 0) !== 1) {
  console.log("ABORTADO: este script só lida com 1 conversa de cada lado (o caso comum). Confira na mão.");
  process.exit(1);
}
const convS = cvS[0].id, convP = cvP[0].id;

// Tabelas de junção (chave composta) — mover pode colidir se o sobrevivente
// já tem a mesma linha (mesma tag, por exemplo). Nesses casos: apaga a do
// perdedor em vez de mover.
const JUNCAO = [
  { tabela: "contact_tags", coluna: "contact_id", chaveExtra: "tag_id" },
  { tabela: "conversation_tags", coluna: "conversation_id", chaveExtra: "tag_id" },
];
// Tabelas normais — moveu, sem risco de colisão de chave.
const SIMPLES_CONTATO = ["broadcast_recipients", "contracts", "crm_activities", "pipeline_field_values", "scheduled_messages", "tasks"];
const SIMPLES_CONVERSA = ["broadcast_recipients", "crm_activities", "internal_mentions", "messages", "pipeline_automation_logs", "pipeline_field_values", "scheduled_messages", "tasks"];

let totalMovido = 0;
const relatorio = [];

for (const j of JUNCAO) {
  const idPerdedor = j.coluna === "contact_id" ? PERDEDOR : convP;
  const idSobrevivente = j.coluna === "contact_id" ? SOBREVIVENTE : convS;
  const { data: linhas } = await db.from(j.tabela).select(j.chaveExtra).eq(j.coluna, idPerdedor);
  for (const l of linhas ?? []) {
    const { data: jaTem } = await db.from(j.tabela).select("*").eq(j.coluna, idSobrevivente).eq(j.chaveExtra, l[j.chaveExtra]).maybeSingle();
    if (GRAVAR) {
      if (jaTem) await db.from(j.tabela).delete().eq(j.coluna, idPerdedor).eq(j.chaveExtra, l[j.chaveExtra]);
      else await db.from(j.tabela).update({ [j.coluna]: idSobrevivente }).eq(j.coluna, idPerdedor).eq(j.chaveExtra, l[j.chaveExtra]);
    }
    relatorio.push(`  ${j.tabela}.${j.chaveExtra}=${l[j.chaveExtra]}: ${jaTem ? "já existia no sobrevivente, removida a duplicata" : "movida"}`);
    totalMovido++;
  }
}

for (const tabela of SIMPLES_CONTATO) {
  const { count } = await db.from(tabela).select("id", { count: "exact", head: true }).eq("contact_id", PERDEDOR);
  if (count) {
    relatorio.push(`  ${tabela}: ${count} linha(s) com contact_id`);
    totalMovido += count;
    if (GRAVAR) await db.from(tabela).update({ contact_id: SOBREVIVENTE }).eq("contact_id", PERDEDOR);
  }
}
for (const tabela of SIMPLES_CONVERSA) {
  const { count } = await db.from(tabela).select("id", { count: "exact", head: true }).eq("conversation_id", convP);
  if (count) {
    relatorio.push(`  ${tabela}: ${count} linha(s) com conversation_id`);
    totalMovido += count;
    if (GRAVAR) await db.from(tabela).update({ conversation_id: convS }).eq("conversation_id", convP);
  }
}

console.log(`\nMOVIDO (${totalMovido} linhas no total):`);
for (const l of relatorio) console.log(l);

if (GRAVAR) {
  // last_message_at correto, contato/conversa perdedores apagados.
  const { data: ult } = await db.from("messages").select("created_at").eq("conversation_id", convS).order("created_at", { ascending: false }).limit(1).single();
  await db.from("conversations").update({ last_message_at: ult.created_at }).eq("id", convS);
  await db.from("conversations").delete().eq("id", convP);
  await db.from("contacts").delete().eq("id", PERDEDOR);
  console.log(`\nlast_message_at ajustado, conversa e contato do perdedor apagados.`);

  const { data: check } = await db.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", convS);
  console.log(`conversa sobrevivente agora tem mensagens confirmadas.`);
} else {
  console.log("\n(simulação — rode de novo com --gravar para aplicar)");
}
