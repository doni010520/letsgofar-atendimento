// Precedencia da assinatura (rodar: npx tsx scripts/verify-assinatura.mjs)
import { deveAssinar } from "../src/lib/assinatura.ts";

let fail = 0;
const ok = (c, m) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) fail++; };

// O caso da Luana: o time assina, ela nao quer assinar.
ok(deveAssinar(false, true) === false, "atendente DESLIGA mesmo com o time ligado (o pedido da Luana)");
ok(deveAssinar(true, false) === true, "atendente LIGA mesmo com o time desligado");

// Sem preferencia, segue o time.
ok(deveAssinar(null, true) === true, "sem preferencia, segue o padrao da org (ligado)");
ok(deveAssinar(null, false) === false, "sem preferencia, segue o padrao da org (desligado)");
ok(deveAssinar(undefined, true) === true, "undefined tambem segue a org");
ok(deveAssinar(undefined, undefined) === false, "sem nada configurado, nao assina");

// `false` do atendente NAO pode ser confundido com "nao respondeu".
ok(deveAssinar(false, true) !== deveAssinar(null, true),
   "false do atendente e diferente de null (o erro classico de usar ||)");

// Padrao da org so vale se for exatamente true.
ok(deveAssinar(null, "sim") === false, "valor estranho na org nao liga a assinatura");
ok(deveAssinar(null, 1) === false, "1 nao e true");

console.log(fail ? `\n${fail} falha(s)` : "\nTudo certo.");
process.exit(fail ? 1 : 0);
