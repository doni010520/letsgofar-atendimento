/**
 * Importa TODAS as mensagens do Chatwoot a partir do JSONL extraído direto do
 * banco. Existe porque o endpoint `/conversations/:id/messages` devolve só as
 * últimas mensagens de cada conversa — o importador por API trouxe 8 mil de
 * 24 mil, e foi por isso que a equipe reclamou de conversa sem histórico.
 *
 * Uso: SUPABASE_DB_URL=... ORG_ID=... node scripts/import-mensagens-completo.mjs <arquivo.jsonl> [--dry]
 */
import pg from "pg";
import fs from "node:fs";
import readline from "node:readline";

const DB_URL = process.env.SUPABASE_DB_URL;
const ORG_ID = process.env.ORG_ID;
const ARQ = process.argv[2];
const DRY = process.argv.includes("--dry");

if (!DB_URL || !ORG_ID || !ARQ) {
  console.error("Uso: SUPABASE_DB_URL=... ORG_ID=... node scripts/import-mensagens-completo.mjs <jsonl> [--dry]");
  process.exit(1);
}

/**
 * O Chatwoot guarda o status como número (enum do Rails); o app usa texto e
 * tem CHECK constraint. Sem esta tradução o insert quebra na primeira linha.
 */
const STATUS = { 0: "sent", 1: "delivered", 2: "read", 3: "failed" };
function traduzStatus(v) {
  if (v === null || v === undefined) return "sent";
  if (typeof v === "number") return STATUS[v] ?? "sent";
  const s = String(v);
  return ["pending", "sent", "delivered", "read", "failed"].includes(s) ? s : (STATUS[Number(s)] ?? "sent");
}

function normalizePhone(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.length <= 11) d = `55${d}`;
  return d;
}
function variantes(fone) {
  const v = [fone];
  const m = /^(55)(\d{2})(\d{8,9})$/.exec(fone);
  if (m) {
    const [, ddi, ddd, resto] = m;
    v.push(resto.length === 8 ? `${ddi}${ddd}9${resto}` : `${ddi}${ddd}${resto.slice(1)}`);
  }
  return v;
}

const db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

// Índice do que já existe, para não consultar o banco por mensagem.
console.log("montando índice do que já está no app…");
const { rows: existentes } = await db.query(
  `select external_id, conversation_id, coalesce(body,'') body, created_at
     from messages where organization_id = $1`,
  [ORG_ID],
);
const porExternal = new Set();
const porConteudo = new Set();
for (const m of existentes) {
  if (m.external_id) porExternal.add(String(m.external_id).split(":").pop());
  porConteudo.add(`${m.conversation_id}|${m.body}|${m.created_at.toISOString()}`);
}
console.log(`  mensagens já no app: ${existentes.length}`);

// Canal para pendurar conversas novas.
const { rows: canais } = await db.query(
  `select id from channels where organization_id=$1 limit 1`,
  [ORG_ID],
);
const canalId = canais[0]?.id ?? null;

// Conversa de destino por telefone (uma consulta por contato, não por mensagem).
const convPorFone = new Map();
let contatosCriados = 0, conversasCriadas = 0;

/**
 * Acha a conversa do contato e, se ele ainda não existir no app, cria contato
 * e conversa a partir do que a própria mensagem traz. Sem isso, 7.671
 * mensagens seriam descartadas por falta de destino — justamente as dos
 * contatos que a importação por API nunca trouxe.
 */
async function acharConversa(fone, nome) {
  if (convPorFone.has(fone)) return convPorFone.get(fone);

  const { rows } = await db.query(
    `select cv.id from conversations cv join contacts ct on ct.id = cv.contact_id
      where cv.organization_id=$1 and ct.phone = any($2)
      order by cv.created_at desc limit 1`,
    [ORG_ID, variantes(fone)],
  );
  let id = rows[0]?.id ?? null;

  if (!id && !DRY) {
    const { rows: ct } = await db.query(
      `insert into contacts (organization_id, name, phone) values ($1,$2,$3)
       on conflict (organization_id, phone) do update
         set name = coalesce(nullif(excluded.name,''), contacts.name)
       returning id, (xmax = 0) as novo`,
      [ORG_ID, nome || fone, fone],
    );
    if (ct[0]?.novo) contatosCriados += 1;
    const { rows: cv } = await db.query(
      `insert into conversations (organization_id, channel_id, contact_id, status, last_message_at)
       values ($1,$2,$3,'closed', now()) returning id`,
      [ORG_ID, canalId, ct[0].id],
    );
    id = cv[0]?.id ?? null;
    if (id) conversasCriadas += 1;
  }

  convPorFone.set(fone, id);
  return id;
}

let lidas = 0, gravadas = 0, jaExistiam = 0, semDestino = 0;
const rl = readline.createInterface({ input: fs.createReadStream(ARQ, "utf8"), crlfDelay: Infinity });

for await (const linha of rl) {
  if (!linha.trim()) continue;
  lidas += 1;
  let m;
  try { m = JSON.parse(linha); } catch { continue; }

  const sid = m.source_id || null;
  if (sid && porExternal.has(sid)) { jaExistiam += 1; continue; }

  const fone = normalizePhone(m.fone);
  if (!fone) { semDestino += 1; continue; }
  const convId = await acharConversa(fone, m.contato);
  if (!convId) { semDestino += 1; continue; }

  const corpo = m.content ?? "";
  const quando = new Date(m.created_at).toISOString();
  // Sem recibo não dá para casar por id: usa conversa + texto + instante.
  const chave = `${convId}|${corpo}|${quando}`;
  if (!sid && porConteudo.has(chave)) { jaExistiam += 1; continue; }

  if (!DRY) {
    await db.query(
      `insert into messages
         (organization_id, conversation_id, direction, sender_type, content_type,
          body, status, external_id, is_internal, created_at)
       values ($1,$2,$3,$4,'text',$5,$6,$7,$8,$9)`,
      [
        ORG_ID, convId,
        m.message_type === 1 ? "out" : "in",
        m.message_type === 1 ? "agent" : "contact",
        corpo, traduzStatus(m.status), sid, !!m.private, quando,
      ],
    );
  }
  if (sid) porExternal.add(sid);
  porConteudo.add(chave);
  gravadas += 1;
  if (gravadas % 1000 === 0) process.stdout.write(`\r  gravadas ${gravadas}…`);
}

console.log(
  `\n\n${DRY ? "SIMULAÇÃO — " : ""}lidas: ${lidas} | gravadas: ${gravadas}` +
    ` | já existiam: ${jaExistiam} | sem conversa no app: ${semDestino}`,
);
await db.end();
