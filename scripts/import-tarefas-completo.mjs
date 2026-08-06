/**
 * Importa TODAS as tarefas do Chatwoot a partir do JSON extraído direto do
 * banco (scratchpad/tarefas.json), com itens de checklist, comentários e o
 * vínculo com o contato.
 *
 * Existe porque o importador por API só trazia a primeira página (25 de 437):
 * o Chatwoot pagina de 25 em 25 e eu não paginava.
 *
 * Uso: SUPABASE_DB_URL=... ORG_ID=... node scripts/import-tarefas-completo.mjs <arquivo.json> [--dry]
 */
import pg from "pg";
import fs from "node:fs";

const DB_URL = process.env.SUPABASE_DB_URL;
const ORG_ID = process.env.ORG_ID;
const ARQ = process.argv[2];
const DRY = process.argv.includes("--dry");

if (!DB_URL || !ORG_ID || !ARQ) {
  console.error("Uso: SUPABASE_DB_URL=... ORG_ID=... node scripts/import-tarefas-completo.mjs <json> [--dry]");
  process.exit(1);
}

const tarefas = JSON.parse(fs.readFileSync(ARQ, "utf8"));
console.log(`tarefas no arquivo: ${tarefas.length}`);

const db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const { rows: perfis } = await db.query(`select id, name from profiles where organization_id = $1`, [ORG_ID]);
const porNome = new Map(perfis.map((p) => [norm(p.name), p.id]));
/** Casa "Vanessa- Financeiro" com "Vanessa", "Ianka Cavalcante" com "Ianka". */
function acharPerfil(nome) {
  if (!nome) return null;
  const alvo = norm(nome);
  if (porNome.has(alvo)) return porNome.get(alvo);
  for (const [n, id] of porNome) {
    if (n.split(/[\s-]/)[0] === alvo.split(/[\s-]/)[0]) return id;
  }
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

let criadas = 0, jaExistiam = 0, itens = 0, coments = 0, comContato = 0, semPerfil = 0;

for (const t of tarefas) {
  const { rows: dup } = await db.query(
    `select id from tasks where organization_id=$1 and title=$2 and created_at=$3 limit 1`,
    [ORG_ID, t.title, t.created_at],
  );
  if (dup.length) { jaExistiam += 1; continue; }

  let contatoId = null;
  const fone = normalizePhone(t.contato_fone);
  if (fone) {
    const { rows } = await db.query(
      `select id from contacts where organization_id=$1 and phone = any($2) limit 1`,
      [ORG_ID, variantes(fone)],
    );
    contatoId = rows[0]?.id ?? null;
    if (contatoId) comContato += 1;
  }

  const resp = acharPerfil(t.responsavel);
  if (t.responsavel && !resp) semPerfil += 1;

  if (DRY) { criadas += 1; continue; }

  const { rows } = await db.query(
    `insert into tasks
       (organization_id, created_by, assigned_to, contact_id, title, description,
        priority, status, due_date, due_time, reminder_at, recurrence_type,
        recurrence_config, started_at, completed_at, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     returning id`,
    [
      ORG_ID, acharPerfil(t.criador), resp, contatoId,
      t.title, t.description ?? null,
      t.priority ?? "medium", t.status ?? "pending",
      t.due_date ?? null, t.due_time ?? null, t.reminder_at ?? null,
      t.recurrence_type ?? "none", JSON.stringify(t.recurrence_config ?? {}),
      t.started_at ?? null, t.completed_at ?? null,
      t.created_at ?? new Date().toISOString(),
    ],
  );
  const taskId = rows[0]?.id;
  if (!taskId) continue;
  criadas += 1;

  for (const i of t.itens ?? []) {
    await db.query(
      `insert into task_items (organization_id, task_id, title, completed, position, created_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [ORG_ID, taskId, i.titulo, !!i.feito, i.pos ?? 0, i.criado ?? t.created_at],
    );
    itens += 1;
  }
  for (const c of t.comentarios ?? []) {
    await db.query(
      `insert into task_comments (organization_id, task_id, profile_id, content, created_at)
       values ($1,$2,$3,$4,$5)`,
      [ORG_ID, taskId, acharPerfil(c.autor), c.texto ?? "", c.criado ?? t.created_at],
    );
    coments += 1;
  }
}

console.log(
  `\n${DRY ? "SIMULAÇÃO — " : ""}criadas: ${criadas} | já existiam: ${jaExistiam}` +
    `\nitens: ${itens} | comentários: ${coments} | com contato vinculado: ${comContato}` +
    `\nresponsável sem perfil no app: ${semPerfil}`,
);
await db.end();
