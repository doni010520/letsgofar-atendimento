/**
 * Teste de envio pelo caminho real do app (provider uazapi), verificando a
 * prova de entrega (`externalId`). Não passa pela UI — exercita o mesmo
 * código que a tela de atendimento usa.
 *
 * Uso: npx tsx scripts/teste-envio.ts <telefone> "<texto>"
 */
import pg from "pg";
import { getProvider } from "../src/lib/whatsapp";
import type { Channel } from "../src/lib/types";

async function main() {
  const [, , telefone, texto] = process.argv;
  if (!telefone || !texto) {
    console.error('Uso: npx tsx scripts/teste-envio.ts <telefone> "<texto>"');
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
    console.error("Nenhum canal uazapi cadastrado.");
    process.exit(1);
  }
  console.log(`canal: ${channel.name} (${channel.type})`);

  const res = await getProvider(channel).sendText({ to: telefone, text: texto });

  console.log("resposta do provider:", JSON.stringify(res));
  if (res.externalId) {
    console.log(`\nENTREGUE — recibo: ${res.externalId}`);
  } else {
    console.log("\nSEM RECIBO — o provedor não confirmou. Seria marcada como falha.");
    process.exitCode = 1;
  }

  await db.end();
}

main().catch((e) => {
  console.error("ERRO:", e instanceof Error ? e.message : e);
  process.exit(1);
});
