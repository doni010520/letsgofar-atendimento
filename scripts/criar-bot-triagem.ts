/**
 * Cria o bot de triagem sem passar pela UI (a server action exige sessão).
 * Mesma lógica de `criarBotTriagem()`: casa cada setor do template com o
 * departamento de nome parecido. Nasce DESLIGADO — ligar só no corte.
 *
 * Uso: npx tsx scripts/criar-bot-triagem.ts
 */
import pg from "pg";
import {
  buildTriagemFlow,
  DEFAULT_SECTORS,
  DEFAULT_GREETING,
  SECTOR_DEPARTMENT_ALIASES,
} from "../src/lib/triagem-template";

async function main() {
  const db = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  const { rows: orgs } = await db.query(`select id from organizations limit 1`);
  const org = orgs[0]?.id as string;
  const { rows: departments } = await db.query(
    `select id, name from departments where organization_id = $1`,
    [org],
  );

  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  const acharDepartamento = (rotulo: string): string | null => {
    const limpo = rotulo.replace(/[^\p{L}\s]/gu, "").trim();
    const lista = departments as { id: string; name: string }[];
    const alias = SECTOR_DEPARTMENT_ALIASES[limpo];
    if (alias) {
      const porAlias = lista.find((d) => norm(d.name) === norm(alias));
      if (porAlias) return porAlias.id;
    }
    const alvo = norm(limpo);
    const exato = lista.find((d) => norm(d.name) === alvo);
    if (exato) return exato.id;
    const parcial = lista.find(
      (d) => alvo.includes(norm(d.name)) || norm(d.name).includes(alvo.split(" ")[0]),
    );
    return parcial?.id ?? null;
  };

  const sectors = DEFAULT_SECTORS.map((s) => ({ ...s, departmentId: acharDepartamento(s.label) }));
  console.log("Casamento setor -> departamento:");
  for (const s of sectors) {
    const dep = (departments as { id: string; name: string }[]).find((d) => d.id === s.departmentId);
    console.log(`   ${s.label.padEnd(26)} -> ${dep?.name ?? "*** SEM DEPARTAMENTO ***"}`);
  }

  const flow = buildTriagemFlow({ greeting: DEFAULT_GREETING, sectors });
  const nome = "Triagem — direcionamento inicial";

  const { rows: existing } = await db.query(
    `select id from automations where organization_id = $1 and name = $2 limit 1`,
    [org, nome],
  );

  if (existing[0]?.id) {
    await db.query(`update automations set flow = $1, updated_at = now() where id = $2`, [
      JSON.stringify(flow),
      existing[0].id,
    ]);
    console.log("\nAtualizado (já existia).");
  } else {
    await db.query(
      `insert into automations (organization_id, name, trigger, flow, active)
       values ($1, $2, 'mensagem recebida', $3, false)`,
      [org, nome, JSON.stringify(flow)],
    );
    console.log("\nCriado — DESLIGADO (active = false).");
  }

  const semDep = sectors.filter((s) => !s.departmentId).map((s) => s.label);
  if (semDep.length) console.log("Setores sem departamento:", semDep.join(", "));

  await db.end();
}

main().catch((e) => {
  console.error("ERRO:", e instanceof Error ? e.message : e);
  process.exit(1);
});
