/**
 * Importa os GRUPOS (turmas) do Chatwoot: o grupo em si, o histórico de
 * mensagens e os lembretes de aula agendados.
 *
 * Grupo não tem telefone — a chave é o JID `<id>@g.us`. As importações
 * anteriores casavam por telefone e por isso deixaram todos de fora.
 *
 * O grupo é gravado do MESMO jeito que o app grava quando a mensagem chega
 * pelo WhatsApp (phone = dígitos do JID, is_group, chat_jid). Sem isso, o
 * histórico ficaria numa conversa e as mensagens novas em outra.
 *
 * Uso: SUPABASE_DB_URL=... ORG_ID=... node scripts/import-grupos.mjs <pasta> [--dry]
 */
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const DB_URL = process.env.SUPABASE_DB_URL;
const ORG_ID = process.env.ORG_ID;
const PASTA = process.argv[2];
const DRY = process.argv.includes("--dry");

if (!DB_URL || !ORG_ID || !PASTA) {
  console.error("Uso: SUPABASE_DB_URL=... ORG_ID=... node scripts/import-grupos.mjs <pasta> [--dry]");
  process.exit(1);
}

/** Mesma regra do parser da UAZAPI: os dígitos do JID viram o "telefone". */
const idDoJid = (jid) => String(jid ?? "").replace(/@.*/, "").replace(/\D/g, "");
const STATUS = { 0: "sent", 1: "delivered", 2: "read", 3: "failed" };
const traduzStatus = (v) =>
  typeof v === "number" ? (STATUS[v] ?? "sent")
    : ["pending", "sent", "delivered", "read", "failed"].includes(String(v)) ? String(v)
    : (STATUS[Number(v)] ?? "sent");
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

const db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const { rows: canais } = await db.query(`select id from channels where organization_id=$1 limit 1`, [ORG_ID]);
const canalId = canais[0]?.id ?? null;
const { rows: perfis } = await db.query(`select id, name from profiles where organization_id=$1`, [ORG_ID]);
const porNome = new Map(perfis.map((p) => [norm(p.name), p.id]));
const acharPerfil = (n) => {
  if (!n) return null;
  const alvo = norm(n);
  if (porNome.has(alvo)) return porNome.get(alvo);
  for (const [k, id] of porNome) if (k.split(/[\s-]/)[0] === alvo.split(/[\s-]/)[0]) return id;
  return null;
};

// ── 1. Os grupos ─────────────────────────────────────────────────────
console.log("▸ Grupos");
const convPorId = new Map(); // dígitos do JID → id da conversa no app
let gNovos = 0, gExistentes = 0;

for (const g of JSON.parse(fs.readFileSync(path.join(PASTA, "grupos.json"), "utf8"))) {
  const id = idDoJid(g.identifier);
  if (!id) continue;
  // O Chatwoot prefixa o nome com "[👥] "; o app não usa esse enfeite.
  const nome = String(g.name ?? "").replace(/^\[👥\]\s*/, "").trim() || id;

  const { rows: ct } = await db.query(
    `select id from contacts where organization_id=$1 and phone=$2 limit 1`,
    [ORG_ID, id],
  );
  let contatoId = ct[0]?.id ?? null;
  if (!contatoId) {
    if (DRY) { gNovos += 1; continue; }
    const { rows } = await db.query(
      `insert into contacts (organization_id, name, phone, is_group, chat_jid, created_at)
       values ($1,$2,$3,true,$4,$5)
       on conflict (organization_id, phone) do update
         set is_group = true, chat_jid = excluded.chat_jid
       returning id`,
      [ORG_ID, nome, id, g.identifier, g.created_at ?? new Date().toISOString()],
    );
    contatoId = rows[0].id;
    gNovos += 1;
  } else gExistentes += 1;

  const { rows: cv } = await db.query(
    `select id from conversations where organization_id=$1 and contact_id=$2 order by created_at limit 1`,
    [ORG_ID, contatoId],
  );
  let convId = cv[0]?.id ?? null;
  if (!convId && !DRY) {
    const { rows } = await db.query(
      // `now()` aqui foi um erro que custou caro: a conversa nascia carimbada
      // com a hora do IMPORT, nao com a data da ultima mensagem. 558 conversas
      // antigas saltaram para o topo da caixa e a equipe abria a primeira da
      // lista para encontrar mensagem de meses atras. Agora a data vem do
      // chamador; sem ela, cai no now() de antes.
      `insert into conversations (organization_id, channel_id, contact_id, status, last_message_at)
       values ($1,$2,$3,'open', coalesce($4::timestamptz, now())) returning id`,
      [ORG_ID, canalId, contatoId, g.last_activity_at ?? g.created_at ?? null],
    );
    convId = rows[0].id;
  }
  if (convId) convPorId.set(id, convId);
}
console.log(`  novos: ${gNovos} | já existiam: ${gExistentes}`);

// ── 2. Mensagens dos grupos ──────────────────────────────────────────
console.log("\n▸ Mensagens dos grupos");
const { rows: jaTem } = await db.query(
  `select external_id from messages where organization_id=$1 and external_id is not null`,
  [ORG_ID],
);
const vistos = new Set(jaTem.map((r) => String(r.external_id).split(":").pop()));

let mNovas = 0, mExistentes = 0, mSemGrupo = 0;
const arq = path.join(PASTA, "grupos-mensagens.jsonl");
if (fs.existsSync(arq)) {
  const rl = readline.createInterface({ input: fs.createReadStream(arq, "utf8"), crlfDelay: Infinity });
  for await (const linha of rl) {
    if (!linha.trim()) continue;
    let m;
    try { m = JSON.parse(linha); } catch { continue; }
    const sid = m.source_id || null;
    if (sid && vistos.has(sid)) { mExistentes += 1; continue; }
    const convId = convPorId.get(idDoJid(m.jid));
    if (!convId) { mSemGrupo += 1; continue; }
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
          m.content ?? "", traduzStatus(m.status), sid, !!m.private,
          new Date(m.created_at).toISOString(),
        ],
      );
    }
    if (sid) vistos.add(sid);
    mNovas += 1;
    if (mNovas % 1000 === 0) process.stdout.write(`\r  gravadas ${mNovas}…`);
  }
}
console.log(`\n  novas: ${mNovas} | já existiam: ${mExistentes} | sem grupo correspondente: ${mSemGrupo}`);

// ── 3. Lembretes de aula agendados ───────────────────────────────────
console.log("\n▸ Agendamentos das turmas");
let aNovas = 0, aSemGrupo = 0;
const agArq = path.join(PASTA, "grupos-agendadas.json");
if (fs.existsSync(agArq)) {
  for (const s of JSON.parse(fs.readFileSync(agArq, "utf8"))) {
    const convId = convPorId.get(idDoJid(s.jid));
    if (!convId) { aSemGrupo += 1; continue; }
    const { rows: dup } = await db.query(
      `select id from scheduled_messages where organization_id=$1 and conversation_id=$2 and scheduled_at=$3 limit 1`,
      [ORG_ID, convId, s.scheduled_at],
    );
    if (dup.length) continue;
    const passou = new Date(s.scheduled_at) < new Date();
    if (!DRY) {
      const { rows: cvc } = await db.query(`select contact_id from conversations where id=$1`, [convId]);
      await db.query(
        `insert into scheduled_messages
           (organization_id, created_by, conversation_id, contact_id, content,
            attachments, scheduled_at, status, sent_at, created_at)
         values ($1,$2,$3,$4,$5,'[]'::jsonb,$6,$7,$8,$9)`,
        [
          ORG_ID, acharPerfil(s.criador), convId, cvc[0]?.contact_id ?? null,
          s.content ?? "", s.scheduled_at,
          // Data passada entra como enviada: senão o cron dispara lembrete
          // de aula antiga para a turma inteira.
          passou ? "sent" : "pending",
          passou ? s.scheduled_at : null,
          s.created_at ?? new Date().toISOString(),
        ],
      );
    }
    aNovas += 1;
  }
}
console.log(`  novos: ${aNovas} | sem grupo correspondente: ${aSemGrupo}`);

console.log(`\n${DRY ? "SIMULAÇÃO — nada gravado" : "Concluído"}`);
await db.end();
