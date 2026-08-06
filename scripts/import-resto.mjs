/**
 * Fecha a migração: contatos que faltavam, mensagens agendadas e modelos de
 * contrato. Lê os JSON extraídos direto do banco do Chatwoot.
 *
 * Uso: SUPABASE_DB_URL=... ORG_ID=... node scripts/import-resto.mjs <pasta> [--dry]
 */
import pg from "pg";
import fs from "node:fs";
import path from "node:path";

const DB_URL = process.env.SUPABASE_DB_URL;
const ORG_ID = process.env.ORG_ID;
const PASTA = process.argv[2];
const DRY = process.argv.includes("--dry");

if (!DB_URL || !ORG_ID || !PASTA) {
  console.error("Uso: SUPABASE_DB_URL=... ORG_ID=... node scripts/import-resto.mjs <pasta> [--dry]");
  process.exit(1);
}
const ler = (n) => JSON.parse(fs.readFileSync(path.join(PASTA, n), "utf8"));

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
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

const db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const { rows: perfis } = await db.query(`select id, name from profiles where organization_id=$1`, [ORG_ID]);
const porNome = new Map(perfis.map((p) => [norm(p.name), p.id]));
function acharPerfil(nome) {
  if (!nome) return null;
  const alvo = norm(nome);
  if (porNome.has(alvo)) return porNome.get(alvo);
  for (const [n, id] of porNome) if (n.split(/[\s-]/)[0] === alvo.split(/[\s-]/)[0]) return id;
  return null;
}
const { rows: canais } = await db.query(`select id from channels where organization_id=$1 limit 1`, [ORG_ID]);
const canalId = canais[0]?.id ?? null;

// ── Contatos ─────────────────────────────────────────────────────────
console.log("▸ Contatos");
let ctNovos = 0, ctExistentes = 0, ctSemFone = 0;
for (const c of ler("contatos.json")) {
  const fone = normalizePhone(c.fone);
  if (!fone) { ctSemFone += 1; continue; }
  const { rows } = await db.query(
    `select id from contacts where organization_id=$1 and phone = any($2) limit 1`,
    [ORG_ID, variantes(fone)],
  );
  if (rows.length) { ctExistentes += 1; continue; }
  if (!DRY) {
    await db.query(
      `insert into contacts (organization_id, name, phone, email, city, created_at)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (organization_id, phone) do nothing`,
      [ORG_ID, c.name || fone, fone, c.email || null, c.cidade || null, c.created_at ?? new Date().toISOString()],
    );
  }
  ctNovos += 1;
}
console.log(`  novos: ${ctNovos} | já existiam: ${ctExistentes} | sem telefone: ${ctSemFone}`);

// ── Mensagens agendadas ──────────────────────────────────────────────
// A tabela exige conversation_id; sem conversa a mensagem não tem para onde ir.
console.log("\n▸ Mensagens agendadas");
let agNovas = 0, agExistentes = 0, agSemDestino = 0;
for (const s of ler("agendadas.json")) {
  const fone = normalizePhone(s.fone);
  if (!fone) { agSemDestino += 1; continue; }
  const { rows: cv } = await db.query(
    `select cv.id, cv.contact_id from conversations cv join contacts ct on ct.id = cv.contact_id
      where cv.organization_id=$1 and ct.phone = any($2) order by cv.created_at desc limit 1`,
    [ORG_ID, variantes(fone)],
  );
  if (!cv[0]) { agSemDestino += 1; continue; }

  const { rows: dup } = await db.query(
    `select id from scheduled_messages
      where organization_id=$1 and conversation_id=$2 and scheduled_at=$3 limit 1`,
    [ORG_ID, cv[0].id, s.scheduled_at],
  );
  if (dup.length) { agExistentes += 1; continue; }

  if (!DRY) {
    await db.query(
      `insert into scheduled_messages
         (organization_id, created_by, conversation_id, contact_id, content,
          attachments, scheduled_at, status, sent_at, created_at)
       values ($1,$2,$3,$4,$5,'[]'::jsonb,$6,$7,$8,$9)`,
      [
        ORG_ID, acharPerfil(s.criador), cv[0].id, cv[0].contact_id, s.content ?? "",
        s.scheduled_at,
        // Já passou da hora: entra como enviada, senão o cron dispararia
        // mensagem antiga para o cliente.
        new Date(s.scheduled_at) < new Date() ? "sent" : "pending",
        new Date(s.scheduled_at) < new Date() ? s.scheduled_at : null,
        s.created_at ?? new Date().toISOString(),
      ],
    );
  }
  agNovas += 1;
}
console.log(`  novas: ${agNovas} | já existiam: ${agExistentes} | sem conversa: ${agSemDestino}`);

// ── Modelos de contrato ──────────────────────────────────────────────
console.log("\n▸ Modelos de contrato");
let mdNovos = 0, mdExistentes = 0;
for (const m of ler("modelos.json")) {
  const { rows } = await db.query(
    `select id from contract_templates where organization_id=$1 and name=$2 limit 1`,
    [ORG_ID, m.name],
  );
  if (rows.length) { mdExistentes += 1; continue; }
  if (!DRY) {
    await db.query(
      `insert into contract_templates
         (organization_id, created_by, name, description, content_html, variable_fields, is_active, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        ORG_ID, acharPerfil(m.criador), m.name, m.description ?? null,
        m.content_html ?? "", JSON.stringify(m.variable_fields ?? []),
        m.active !== false, m.created_at ?? new Date().toISOString(),
      ],
    );
  }
  mdNovos += 1;
  console.log(`  + ${m.name}`);
}
console.log(`  novos: ${mdNovos} | já existiam: ${mdExistentes}`);

console.log(`\n${DRY ? "SIMULAÇÃO — nada gravado" : "Concluído"} (canal usado: ${canalId ? "ok" : "nenhum"})`);
await db.end();
