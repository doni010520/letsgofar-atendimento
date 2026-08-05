/**
 * Define uma senha nova para cada usuário do app e imprime a lista.
 * Usa a API admin do Supabase (service_role) — não precisa da senha antiga.
 *
 * Uso: node scripts/resetar-senhas.mjs
 */
import pg from "pg";
import crypto from "node:crypto";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB = process.env.SUPABASE_DB_URL;
if (!URL || !KEY || !DB) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SUPABASE_DB_URL.");
  process.exit(1);
}

/** Senha legível de digitar no celular, mas com entropia suficiente. */
function senha() {
  const silabas = ["ka", "lo", "mi", "re", "tu", "sa", "vi", "ze", "no", "pe", "ju", "fa"];
  const p = Array.from({ length: 3 }, () => silabas[crypto.randomInt(silabas.length)]).join("");
  return `${p[0].toUpperCase()}${p.slice(1)}-${crypto.randomInt(1000, 9999)}`;
}

const db = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(
  `select u.id, u.email, p.name, p.role
     from auth.users u join profiles p on p.id = u.id
    order by p.role, p.name`,
);

const saida = [];
for (const u of rows) {
  const nova = senha();
  const res = await fetch(`${URL}/auth/v1/admin/users/${u.id}`, {
    method: "PUT",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: nova, email_confirm: true }),
  });
  if (!res.ok) {
    console.error(`FALHOU ${u.email}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
    continue;
  }
  saida.push({ nome: u.name, papel: u.role, email: u.email, senha: nova });
}

console.log("\nCREDENCIAIS — entregar a cada pessoa em particular\n");
for (const s of saida) {
  console.log(`  ${s.nome}  (${s.papel})`);
  console.log(`     ${s.email}`);
  console.log(`     ${s.senha}\n`);
}

await db.end();
