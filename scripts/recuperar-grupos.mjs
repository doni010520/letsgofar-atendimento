/**
 * Recupera as mensagens de GRUPO que o app descartou (v1.7.0 corrigiu a causa).
 *
 * A uazapi guarda o histórico, então dá para recolocar o que foi jogado fora.
 * Traz as duas direções: sem as nossas respostas a conversa fica sem sentido.
 *
 *   node scripts/recuperar-grupos.mjs            # só mostra o que faria
 *   node scripts/recuperar-grupos.mjs --gravar   # grava
 *
 * Dedup por external_id: rodar de novo não duplica.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const GRAVAR = process.argv.includes("--gravar");
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: canal } = await db.from("channels").select("id, organization_id, credentials").limit(1).single();
const token = canal.credentials?.token ?? canal.credentials?.instanceToken;

/**
 * Puxa as mensagens recentes de CADA grupo, um a um.
 *
 * A busca global paginada parece o caminho óbvio e não é: a primeira página
 * volta em 3s, as seguintes travam, e uma tentativa chegou a puxar 91 MB e
 * morrer sem gravar nada. Filtrando por `chatid` a mesma consulta volta em
 * 300ms — e é exatamente o recorte que interessa aqui.
 */
async function buscarPorGrupo(jids, porGrupo = 200) {
  const todas = [];
  for (const jid of jids) {
    try {
      const r = await fetch(`${env.UAZAPI_HOST}/message/find`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token },
        body: JSON.stringify({ chatid: jid, limit: porGrupo }),
        signal: AbortSignal.timeout(45_000),
      });
      const lote = (await r.json()).messages ?? [];
      todas.push(...lote);
      process.stdout.write(`\r  lidas ${todas.length} de ${todas.length ? jids.indexOf(jid) + 1 : 0}/${jids.length} grupos`);
    } catch (e) {
      console.log(`\n  falhou em ${jid}: ${e.name}`);
    }
  }
  console.log("");
  return todas;
}

const tipoDe = (t) => {
  const s = String(t ?? "").toLowerCase();
  if (s.includes("image")) return "image";
  if (s.includes("audio") || s.includes("ptt")) return "audio";
  if (s.includes("video")) return "video";
  if (s.includes("document")) return "document";
  if (s.includes("sticker")) return "sticker";
  if (s.includes("location")) return "location";
  return "text";
};
const PULAR = new Set(["reactionmessage", "protocolmessage", "senderkeydistributionmessage", "pollupdatemessage"]);

// Grupos cadastrados (vieram do import do Chatwoot) — a lista de onde buscar.
const { data: gruposCad } = await db.from("contacts").select("chat_jid").eq("is_group", true);
const jids = [...new Set((gruposCad ?? []).map((g) => g.chat_jid).filter(Boolean))];
console.log(`lendo a uazapi (${jids.length} grupos)...`);
const todas = await buscarPorGrupo(jids);
const grupos = todas.filter((m) => String(m.chatid ?? "").endsWith("@g.us"))
  .filter((m) => !PULAR.has(String(m.messageType ?? "").toLowerCase()));
console.log(`mensagens de grupo na uazapi: ${grupos.length}`);

// Conversas dos grupos já cadastrados (vieram do import do Chatwoot).
const { data: contatos } = await db.from("contacts").select("id, name, chat_jid").eq("is_group", true);
const porJid = new Map((contatos ?? []).map((c) => [c.chat_jid, c]));
const { data: convs } = await db.from("conversations").select("id, contact_id")
  .in("contact_id", (contatos ?? []).map((c) => c.id));
const convDoContato = new Map((convs ?? []).map((c) => [c.contact_id, c.id]));

const envolvidos = [...new Set(grupos.map((m) => m.chatid))];
console.log(`grupos envolvidos: ${envolvidos.length}`);
for (const j of envolvidos) {
  const c = porJid.get(j);
  console.log(`  ${c ? (c.name ?? "").slice(0, 34).padEnd(36) : "(NAO CADASTRADO)".padEnd(36)} ${j}`);
}

// O que já existe no banco (dedup por external_id).
const ids = [...new Set(grupos.map((m) => m.id).filter(Boolean))];
const existentes = new Set();
for (let i = 0; i < ids.length; i += 50) {
  const { data } = await db.from("messages").select("external_id").in("external_id", ids.slice(i, i + 50));
  for (const x of data ?? []) existentes.add(x.external_id);
}

const novas = [];
let semConversa = 0;
for (const m of grupos) {
  if (!m.id || existentes.has(m.id)) continue;
  const ct = porJid.get(m.chatid);
  const convId = ct ? convDoContato.get(ct.id) : null;
  if (!convId) { semConversa++; continue; }
  const tipo = tipoDe(m.messageType ?? m.mediaType);
  const texto = m.text ?? m.caption ?? null;
  if (tipo === "text" && !String(texto ?? "").trim()) continue;
  novas.push({
    organization_id: canal.organization_id,
    conversation_id: convId,
    direction: m.fromMe ? "out" : "in",
    sender_type: m.fromMe ? "agent" : "contact",
    content_type: tipo,
    body: texto,
    media_url: m.fileURL ?? null,
    external_id: m.id,
    author_name: m.fromMe ? null : (m.senderName ?? null),
    author_lid: m.fromMe ? null : String(m.sender ?? "").replace(/@.*/, "") || null,
    status: m.fromMe ? "sent" : "delivered",
    created_at: new Date(m.messageTimestamp).toISOString(),
  });
}

console.log(`\njá no banco: ${existentes.size}`);
console.log(`sem conversa cadastrada (ignoradas): ${semConversa}`);
console.log(`A RECUPERAR: ${novas.length}  (entradas: ${novas.filter((n) => n.direction === "in").length}, saídas: ${novas.filter((n) => n.direction === "out").length})`);

if (!GRAVAR) { console.log("\n(simulação — rode com --gravar para gravar)"); process.exit(0); }

let ok = 0;
for (let i = 0; i < novas.length; i += 100) {
  const { error, count } = await db.from("messages").insert(novas.slice(i, i + 100), { count: "exact" });
  if (error) console.log("  erro no lote:", error.message);
  else ok += count ?? novas.slice(i, i + 100).length;
}
console.log(`gravadas: ${ok}`);

// Deixa a conversa no topo da caixa com a data certa da última mensagem.
for (const convId of new Set(novas.map((n) => n.conversation_id))) {
  const ultima = novas.filter((n) => n.conversation_id === convId)
    .reduce((a, b) => (a.created_at > b.created_at ? a : b));
  await db.from("conversations").update({ last_message_at: ultima.created_at }).eq("id", convId);
}
console.log("conversas reordenadas pela última mensagem.");
