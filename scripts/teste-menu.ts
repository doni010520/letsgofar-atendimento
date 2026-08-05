/**
 * Testa o envio de menu com BOTÕES pelo caminho real do provider.
 *
 * Uso: npx tsx scripts/teste-menu.ts <telefone>
 */
import pg from "pg";
import { getProvider } from "../src/lib/whatsapp";
import type { Channel } from "../src/lib/types";

async function main() {
  const telefone = process.argv[2];
  if (!telefone) {
    console.error("Uso: npx tsx scripts/teste-menu.ts <telefone>");
    process.exit(1);
  }

  const db = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  const { rows } = await db.query<Channel>(
    `select id, organization_id, type, external_id, credentials, name
       from channels where type = 'uazapi' limit 1`,
  );
  const channel = rows[0];
  if (!channel) {
    console.error("Nenhum canal uazapi.");
    process.exit(1);
  }

  const provider = getProvider(channel);
  if (!provider.sendMenu) {
    console.error("Este provider não implementa sendMenu.");
    process.exit(1);
  }

  const res = await provider.sendMenu({
    to: telefone,
    text: "Teste de menu com botões — pode ignorar.\n\nEscolha uma opção abaixo:",
    sectionLabel: "Setores",
    options: [
      { id: "opt1", label: "📚 Experiência do Aluno" },
      { id: "opt2", label: "💰 Financeiro" },
      { id: "opt3", label: "📊 Consultoria Estratégica" },
    ],
  });

  console.log("resposta:", JSON.stringify(res));
  if (res.externalId) console.log(`\nENVIADO — recibo: ${res.externalId}`);
  else {
    console.log("\nSEM RECIBO — o provedor não confirmou.");
    process.exitCode = 1;
  }
  await db.end();
}

main().catch((e) => {
  console.error("ERRO:", e instanceof Error ? e.message : e);
  process.exit(1);
});
