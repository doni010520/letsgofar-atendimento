/**
 * Traz do Chatwoot o RESPONSÁVEL e o TIME de cada conversa.
 *
 * A migração original trouxe as conversas sem dono: 995 de 1000 ficaram sem
 * responsável no app, contra 687 de 692 atribuídas no Chatwoot. É por isso que
 * a equipe vê tudo misturado — não há o que separar quando ninguém é dono de
 * nada. Sem estes dados, filtro de "minhas conversas" não tem o que filtrar.
 *
 *   node scripts/importar-responsaveis.mjs            # simulação
 *   node scripts/importar-responsaveis.mjs --gravar
 *
 * Casa por TELEFONE, testando as variantes do 9º dígito.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const GRAVAR = process.argv.includes("--gravar");
const TOKEN = process.env.CHATWOOT_TOKEN || "xJTZZufykxqt8TEWk14h2uD3";
const BASE = "https://chat.benitechlab.com/api/v1/accounts/1";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const api = async (rota) => {
  const r = await fetch(`${BASE}${rota}`, { headers: { api_access_token: TOKEN }, signal: AbortSignal.timeout(45_000) });
  if (!r.ok) throw new Error(`${r.status} em ${rota}`);
  return r.json();
};

/**
 * PAGINA. A API devolve 25 por página e ignorar isso já custou caro nesta
 * migração: vieram 25 de 437 tarefas e 8k de 24k mensagens por causa disso.
 */
async function todasConversas() {
  const todas = [];
  for (const status of ["open", "pending", "resolved"]) {
    for (let pagina = 1; ; pagina++) {
      const d = await api(`/conversations?status=${status}&page=${pagina}`);
      const lote = d?.data?.payload ?? [];
      todas.push(...lote);
      process.stdout.write(`\r  ${status}: ${todas.length} conversas lidas`);
      if (lote.length < 25) break;
      if (pagina > 80) { console.log(`\n  (parei em 80 páginas de ${status} — confira se falta algo)`); break; }
    }
    console.log("");
  }
  return todas;
}

/** Variantes do telefone: o 9º dígito entra e sai dependendo de quem cadastrou. */
function variantes(tel) {
  const d = String(tel ?? "").replace(/\D/g, "");
  if (!d) return [];
  const v = new Set([d]);
  const m = d.match(/^55(\d{2})(\d{8,9})$/);
  if (m) {
    const [, ddd, resto] = m;
    if (resto.length === 9 && resto.startsWith("9")) v.add(`55${ddd}${resto.slice(1)}`);
    if (resto.length === 8) v.add(`55${ddd}9${resto}`);
  }
  return [...v];
}

console.log("lendo o Chatwoot...");
const conversas = await todasConversas();
console.log(`total no Chatwoot: ${conversas.length}`);

const { data: perfis } = await db.from("profiles").select("id, name, email");
const { data: setores } = await db.from("departments").select("id, name");
const porEmail = new Map((perfis ?? []).map((p) => [(p.email ?? "").toLowerCase(), p]));
const porNome = new Map((perfis ?? []).map((p) => [p.name.toLowerCase().trim(), p]));
const setorPorNome = new Map((setores ?? []).map((s) => [s.name.toLowerCase().trim(), s]));

const { data: convsApp } = await db.from("conversations")
  .select("id, contact_id, assigned_user_id, department_id, contacts!inner(phone)").limit(3000);
const indice = new Map();
for (const c of convsApp ?? []) {
  for (const v of variantes(c.contacts?.phone)) if (!indice.has(v)) indice.set(v, c);
}
console.log(`conversas no app indexadas: ${indice.size} variantes de telefone`);

const mudancas = [];
const semPar = [];
const semPerfil = new Set();
for (const cw of conversas) {
  const dono = cw?.meta?.assignee;
  const time = cw?.meta?.team;
  if (!dono && !time) continue;
  const tel = cw?.meta?.sender?.phone_number;
  const achou = variantes(tel).map((v) => indice.get(v)).find(Boolean);
  if (!achou) { semPar.push({ tel, dono: dono?.name }); continue; }

  const perfil = dono
    ? (porEmail.get((dono.email ?? "").toLowerCase()) ?? porNome.get((dono.name ?? "").toLowerCase().trim()))
    : null;
  if (dono && !perfil) { semPerfil.add(dono.name); continue; }
  const setor = time ? setorPorNome.get((time.name ?? "").toLowerCase().trim()) : null;

  const patch = {};
  if (perfil && achou.assigned_user_id !== perfil.id) patch.assigned_user_id = perfil.id;
  if (setor && !achou.department_id) patch.department_id = setor.id;
  if (Object.keys(patch).length) mudancas.push({ id: achou.id, patch, quem: perfil?.name, time: time?.name });
}

const porPessoa = {};
for (const m of mudancas) if (m.quem) porPessoa[m.quem] = (porPessoa[m.quem] ?? 0) + 1;
console.log("\nA ATRIBUIR:");
for (const [k, v] of Object.entries(porPessoa).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(24)} ${v}`);
console.log(`total de conversas a atualizar: ${mudancas.length}`);
console.log(`sem par no app (telefone não bateu): ${semPar.length}`);
if (semPerfil.size) console.log(`agentes do Chatwoot sem perfil no app: ${[...semPerfil].join(", ")}`);

if (!GRAVAR) { console.log("\n(simulação — rode com --gravar para gravar)"); process.exit(0); }

let ok = 0;
for (const m of mudancas) {
  const { error } = await db.from("conversations").update(m.patch).eq("id", m.id);
  if (error) console.log("  erro:", error.message);
  else ok++;
}
console.log(`\natualizadas: ${ok}`);
