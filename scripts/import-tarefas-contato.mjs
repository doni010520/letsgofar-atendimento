/**
 * Importa as `kanban_tasks` do Chatwoot — as tarefas que a equipe criava
 * DENTRO da ficha do contato, no painel lateral da conversa.
 *
 * São outra coisa, e outra tabela, que as `agent_tasks` da aba de Tarefas:
 * ficam presas a uma conversa/contato e servem de lembrete de follow-up
 * ("Entrar em contato em junho", "Follow Up").
 *
 * Uso: SUPABASE_DB_URL=... ORG_ID=... node scripts/import-tarefas-contato.mjs <json> [--dry]
 */
import pg from "pg";
import fs from "node:fs";

const DB_URL = process.env.SUPABASE_DB_URL;
const ORG_ID = process.env.ORG_ID;
const ARQ = process.argv[2];
const DRY = process.argv.includes("--dry");

if (!DB_URL || !ORG_ID || !ARQ) {
  console.error("Uso: SUPABASE_DB_URL=... ORG_ID=... node scripts/import-tarefas-contato.mjs <json> [--dry]");
  process.exit(1);
}

const tarefas = JSON.parse(fs.readFileSync(ARQ, "utf8"));
console.log(`tarefas no arquivo: ${tarefas.length}`);

const db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const { rows: perfis } = await db.query(`select id, name from profiles where organization_id=$1`, [ORG_ID]);
const porNome = new Map(perfis.map((p) => [norm(p.name), p.id]));
function acharPerfil(nome) {
  if (!nome) return null;
  const alvo = norm(nome);
  if (porNome.has(alvo)) return porNome.get(alvo);
  for (const [n, id] of porNome) if (n.split(/[\s-]/)[0] === alvo.split(/[\s-]/)[0]) return id;
  return null;
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

let criadas = 0, jaExistiam = 0, semContato = 0;

for (const t of tarefas) {
  const { rows: dup } = await db.query(
    `select id from tasks where organization_id=$1 and title=$2 and created_at=$3 limit 1`,
    [ORG_ID, t.title, t.created_at],
  );
  if (dup.length) { jaExistiam += 1; continue; }

  let contatoId = null, conversaId = null;
  const fone = normalizePhone(t.contato_fone);
  if (fone) {
    const { rows } = await db.query(
      `select id from contacts where organization_id=$1 and phone = any($2) limit 1`,
      [ORG_ID, variantes(fone)],
    );
    contatoId = rows[0]?.id ?? null;
    if (contatoId) {
      const { rows: cv } = await db.query(
        `select id from conversations where organization_id=$1 and contact_id=$2
          order by created_at desc limit 1`,
        [ORG_ID, contatoId],
      );
      conversaId = cv[0]?.id ?? null;
    }
  }
  if (!contatoId) semContato += 1;

  // due_at é timestamp; o app separa data e hora.
  const venc = t.due_at ? new Date(t.due_at) : null;
  const dataVenc = venc ? venc.toISOString().slice(0, 10) : null;
  const horaVenc = venc ? venc.toISOString().slice(11, 16) : null;

  if (DRY) { criadas += 1; continue; }

  await db.query(
    `insert into tasks
       (organization_id, created_by, assigned_to, contact_id, conversation_id,
        title, description, priority, status, due_date, due_time,
        completed_at, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      ORG_ID,
      acharPerfil(t.criador),
      // Sem responsável no Chatwoot: fica com quem criou, senão some do painel.
      acharPerfil(t.responsavel) ?? acharPerfil(t.criador),
      contatoId, conversaId,
      t.title, t.description ?? null,
      t.priority ?? "medium",
      t.completed_at ? "completed" : (t.status ?? "pending"),
      dataVenc, horaVenc,
      t.completed_at ?? null,
      t.created_at ?? new Date().toISOString(),
    ],
  );
  criadas += 1;
}

console.log(
  `\n${DRY ? "SIMULAÇÃO — " : ""}criadas: ${criadas} | já existiam: ${jaExistiam} | sem contato no app: ${semContato}`,
);
await db.end();
