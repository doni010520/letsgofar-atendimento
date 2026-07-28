// Aplica as migrations do supabase/migrations no banco (ordem numérica).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error("Defina SUPABASE_DB_URL"); process.exit(1); }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("conectado ao banco\n");

const dir = "supabase/migrations";
const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
let ok = 0; const fails = [];

for (const f of files) {
  const sql = readFileSync(path.join(dir, f), "utf8");
  try {
    await client.query(sql);
    console.log(`✅ ${f}`);
    ok++;
  } catch (e) {
    console.log(`❌ ${f}\n     ${e.message.split("\n")[0]}`);
    fails.push([f, e.message.split("\n")[0]]);
  }
}

console.log(`\n${ok}/${files.length} aplicadas`);
if (fails.length) { console.log("\nFalhas:"); fails.forEach(([f,m]) => console.log(`  ${f}: ${m}`)); }
await client.end();
process.exit(fails.length ? 1 : 0);
