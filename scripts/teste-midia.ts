/**
 * Testa o envio de mídia pelo caminho real: sobe o arquivo no bucket "media"
 * e manda pela UAZAPI, exatamente como a tela de atendimento faz.
 *
 * Uso: npx tsx scripts/teste-midia.ts <telefone> <caminho-do-arquivo>
 */
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getProvider } from "../src/lib/whatsapp";
import type { Channel } from "../src/lib/types";

function kindFromMime(mime: string): "image" | "video" | "audio" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

async function main() {
  const [, , telefone, arquivo] = process.argv;
  if (!telefone || !arquivo) {
    console.error("Uso: npx tsx scripts/teste-midia.ts <telefone> <arquivo>");
    process.exit(1);
  }

  const buf = fs.readFileSync(arquivo);
  const mb = (buf.length / 1024 / 1024).toFixed(2);
  const ext = path.extname(arquivo).slice(1) || "bin";
  const mime =
    { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf", mp4: "video/mp4" }[
      ext.toLowerCase()
    ] ?? "application/octet-stream";
  console.log(`arquivo: ${path.basename(arquivo)} | ${mb} MB | ${mime}`);

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const alvo = `teste/out/${Date.now()}.${ext}`;
  const up = await sb.storage.from("media").upload(alvo, buf, { contentType: mime, upsert: true });
  if (up.error) {
    console.error("FALHA no upload:", up.error.message);
    process.exit(1);
  }
  const url = sb.storage.from("media").getPublicUrl(alvo).data.publicUrl;
  console.log("subiu para o bucket:", url.slice(0, 80) + "...");

  // A UAZAPI busca a URL — se ela não for alcançável de fora, o envio falha.
  const head = await fetch(url, { method: "HEAD" });
  console.log(`a URL responde de fora? HTTP ${head.status} | ${head.headers.get("content-length")} bytes`);

  const db = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  const { rows } = await db.query<Channel>(
    `select id, organization_id, type, external_id, credentials, name
       from channels where type='uazapi' limit 1`,
  );
  const res = await getProvider(rows[0]).sendMedia({
    to: telefone,
    url,
    caption: `Teste de envio de arquivo (${mb} MB) — pode ignorar.`,
    kind: kindFromMime(mime),
  });
  console.log("resposta do provider:", JSON.stringify(res));
  console.log(res.externalId ? `\nENTREGUE — recibo: ${res.externalId}` : "\nSEM RECIBO");
  if (!res.externalId) process.exitCode = 1;
  await db.end();
}

main().catch((e) => {
  console.error("ERRO:", e instanceof Error ? e.message : e);
  process.exit(1);
});
