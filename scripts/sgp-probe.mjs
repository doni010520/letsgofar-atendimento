/**
 * Probe da API URA do SGP — autossuficiente (Node 18+, sem dependências).
 *
 * Faz chamadas cruas e imprime as respostas para confirmarmos os caminhos e o
 * shape real antes de fixar os normalizadores em src/lib/sgp/client.ts.
 *
 * Uso (PowerShell):
 *   $env:SGP_URL="https://SEUDOMINIO.sgp.net.br"
 *   $env:SGP_APP="nome_do_token"
 *   $env:SGP_TOKEN="o_token_secreto"
 *   node scripts/sgp-probe.mjs --cpfcnpj 00000000000
 *   node scripts/sgp-probe.mjs --telefone 5571999999999
 *   node scripts/sgp-probe.mjs --contrato 1234
 */

const URL = (process.env.SGP_URL || "").replace(/\/+$/, "");
const APP = process.env.SGP_APP || "";
const TOKEN = process.env.SGP_TOKEN || "";

if (!URL || !APP || !TOKEN) {
  console.error("Defina SGP_URL, SGP_APP e SGP_TOKEN no ambiente.");
  process.exit(1);
}

// args simples: --chave valor
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i]?.replace(/^--/, "");
  if (k) args[k] = process.argv[i + 1];
}

const onlyDigits = (s) => String(s || "").replace(/\D+/g, "");

async function call(path, body) {
  const url = `${URL}/${path.replace(/^\/+/, "")}`;
  process.stdout.write(`\n=== POST ${path} ${JSON.stringify(body)} ===\n`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ app: APP, token: TOKEN, ...body }),
    });
    const text = await res.text();
    let out = text;
    try { out = JSON.stringify(JSON.parse(text), null, 2); } catch { /* texto cru */ }
    console.log(`HTTP ${res.status}`);
    console.log(out.slice(0, 4000));
  } catch (e) {
    console.log(`ERRO DE REDE: ${e.message}`);
  }
}

const cpfcnpj = args.cpfcnpj ? onlyDigits(args.cpfcnpj) : undefined;
const telefone = args.telefone ? onlyDigits(args.telefone) : undefined;
const contrato = args.contrato ? Number(args.contrato) : undefined;

await call("api/ura/consultacliente/", { cpfcnpj, telefone, contrato });
if (contrato || cpfcnpj) await call("api/ura/titulos/", { contrato, cpfcnpj });
if (contrato) await call("api/ura/verificaacesso/", { contrato });

console.log("\nProbe concluído. Cole a saída aqui para eu ajustar os normalizadores.");
