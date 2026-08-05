/**
 * Preenche lacunas de mensagens comparando conversa a conversa contra o
 * Chatwoot, num intervalo de datas. Diferente do importador geral, este
 * relata o que encontrou — serve para auditar, não só para gravar.
 *
 * Uso:
 *   CHATWOOT_URL=... CHATWOOT_TOKEN=... SUPABASE_DB_URL=... ORG_ID=... \
 *   node scripts/preencher-lacunas.mjs --de=2026-08-04 --ate=2026-08-05 [--dry]
 */
import pg from "pg";

const CW_URL = process.env.CHATWOOT_URL;
const CW_TOKEN = process.env.CHATWOOT_TOKEN;
const DB_URL = process.env.SUPABASE_DB_URL;
const ORG_ID = process.env.ORG_ID;
const DRY = process.argv.includes("--dry");
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split("=")[1];
const DE = arg("de", "2026-08-04");
const ATE = arg("ate", "2026-08-06");

if (!CW_URL || !CW_TOKEN || !DB_URL || !ORG_ID) {
  console.error("Faltam CHATWOOT_URL, CHATWOOT_TOKEN, SUPABASE_DB_URL, ORG_ID.");
  process.exit(1);
}

const cw = async (p) => {
  const r = await fetch(`${CW_URL}/api/v1/accounts/1/${p}`, {
    headers: { api_access_token: CW_TOKEN, "User-Agent": "curl/8.4.0" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${p}`);
  return r.json();
};
const diaDe = (ts) => new Date((ts ?? 0) * 1000).toISOString().slice(0, 10);
function normalizePhone(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.length <= 11) d = `55${d}`;
  return d;
}
/** Variantes com e sem o 9º dígito — o WhatsApp entrega das duas formas. */
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

let convs = [];
for (let p = 1; p <= 60; p += 1) {
  const l = (await cw(`conversations?status=all&assignee_type=all&page=${p}`)).data?.payload ?? [];
  if (!l.length) break;
  convs = convs.concat(l);
}
console.log(`conversas no Chatwoot: ${convs.length}`);
console.log(`janela: ${DE} → ${ATE}\n`);

let inseridas = 0, jaTinham = 0, semDestino = 0;
const porContato = new Map();

for (const c of convs) {
  let msgs = [];
  try {
    msgs = (await cw(`conversations/${c.id}/messages`)).payload ?? [];
  } catch {
    continue;
  }
  const naJanela = msgs.filter(
    (m) => m.message_type <= 1 && !m.private && diaDe(m.created_at) >= DE && diaDe(m.created_at) <= ATE,
  );
  if (!naJanela.length) continue;

  const fone = normalizePhone(c.meta?.sender?.phone_number);
  if (!fone) { semDestino += naJanela.length; continue; }
  const { rows: cv } = await db.query(
    `select cv.id from conversations cv join contacts ct on ct.id = cv.contact_id
      where cv.organization_id=$1 and ct.phone = any($2)
      order by cv.created_at desc limit 1`,
    [ORG_ID, variantes(fone)],
  );
  if (!cv[0]) { semDestino += naJanela.length; continue; }
  const convId = cv[0].id;

  for (const m of naJanela) {
    const sid = m.source_id || null;
    const { rows: dup } = sid
      ? await db.query(
          `select 1 from messages where organization_id=$1
             and (external_id=$2 or external_id like '%:' || $2) limit 1`,
          [ORG_ID, sid],
        )
      : await db.query(
          `select 1 from messages where organization_id=$1 and conversation_id=$2
             and coalesce(body,'')=coalesce($3,'') and created_at=to_timestamp($4) limit 1`,
          [ORG_ID, convId, m.content ?? "", m.created_at ?? 0],
        );
    if (dup.length) { jaTinham += 1; continue; }

    if (!DRY) {
      await db.query(
        `insert into messages
           (organization_id, conversation_id, direction, sender_type, content_type,
            body, status, external_id, created_at)
         values ($1,$2,$3,$4,'text',$5,$6,$7,to_timestamp($8))`,
        [
          ORG_ID, convId,
          m.message_type === 1 ? "out" : "in",
          m.message_type === 1 ? "agent" : "contact",
          m.content ?? "", m.status ?? "sent", sid, m.created_at ?? 0,
        ],
      );
    }
    inseridas += 1;
    const quem = c.meta?.sender?.name ?? fone;
    porContato.set(quem, (porContato.get(quem) ?? 0) + 1);
  }
}

console.log(`${DRY ? "SIMULAÇÃO — " : ""}mensagens inseridas: ${inseridas}`);
console.log(`já existiam: ${jaTinham} | sem destino no app: ${semDestino}`);
if (porContato.size) {
  console.log("\npor contato:");
  for (const [k, v] of [...porContato].sort((a, b) => b[1] - a[1])) console.log(`  ${v.toString().padStart(3)} · ${k}`);
}
await db.end();
