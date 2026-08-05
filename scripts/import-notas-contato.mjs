/**
 * Traz as ANOTAÇÕES de contato do Chatwoot (aquelas que ficam dentro da ficha
 * do contato, sem relação com a aba de Tarefas).
 *
 * O Chatwoot guarda várias por contato, com autor e data; o app tem um único
 * campo de texto. Juntamos preservando autor e data, e sem apagar o que já
 * estiver escrito lá.
 *
 * Uso:
 *   CHATWOOT_URL=... CHATWOOT_TOKEN=... SUPABASE_DB_URL=... ORG_ID=... \
 *   node scripts/import-notas-contato.mjs [--dry]
 */
import pg from "pg";

const CW_URL = process.env.CHATWOOT_URL;
const CW_TOKEN = process.env.CHATWOOT_TOKEN;
const DB_URL = process.env.SUPABASE_DB_URL;
const ORG_ID = process.env.ORG_ID;
const DRY = process.argv.includes("--dry");

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
/** O Chatwoot devolve o instante em SEGUNDOS; tratar como ms cai em 1970. */
const dia = (v) => {
  if (!v) return "";
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n > 1e12 ? n : n * 1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR");
};

const db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

let contatos = [];
for (let p = 1; p <= 60; p += 1) {
  const l = (await cw(`contacts?page=${p}`)).payload ?? [];
  if (!l.length) break;
  contatos = contatos.concat(l);
}
console.log(`contatos no Chatwoot: ${contatos.length}`);

let comNotas = 0, gravados = 0, semDestino = 0, jaTinham = 0;

for (const c of contatos) {
  let notas = [];
  try {
    notas = await cw(`contacts/${c.id}/notes`);
  } catch {
    continue;
  }
  if (!Array.isArray(notas) || !notas.length) continue;
  comNotas += 1;

  const fone = normalizePhone(c.phone_number);
  if (!fone) { semDestino += 1; continue; }
  const { rows } = await db.query(
    `select id, notes from contacts where organization_id=$1 and phone = any($2) limit 1`,
    [ORG_ID, variantes(fone)],
  );
  if (!rows[0]) { semDestino += 1; continue; }

  // Mais antiga primeiro, para o texto ficar em ordem de leitura.
  const ordenadas = [...notas].sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  );
  const texto = ordenadas
    .map((n) => {
      const autor = (n.user ?? {}).name;
      const quando = dia(n.created_at);
      const assinatura = [autor, quando].filter(Boolean).join(" · ");
      return assinatura ? `${n.content}\n(${assinatura})` : String(n.content ?? "");
    })
    .join("\n\n");

  const atual = String(rows[0].notes ?? "").trim();
  // Não sobrescreve o que a equipe já escreveu no app.
  if (atual.includes(String(ordenadas[0]?.content ?? "").slice(0, 40))) {
    jaTinham += 1;
    continue;
  }
  const final = atual ? `${atual}\n\n${texto}` : texto;

  console.log(`  ${c.name} (${fone}) — ${notas.length} anotação(ões)`);
  for (const n of ordenadas) console.log(`     • ${String(n.content ?? "").replace(/\s+/g, " ").slice(0, 80)}`);

  if (!DRY) {
    await db.query(`update contacts set notes = $1 where id = $2`, [final, rows[0].id]);
  }
  gravados += 1;
}

console.log(
  `\n${DRY ? "SIMULAÇÃO — " : ""}contatos com anotação: ${comNotas} | gravados: ${gravados}` +
    ` | já tinham: ${jaTinham} | sem destino: ${semDestino}`,
);
await db.end();
