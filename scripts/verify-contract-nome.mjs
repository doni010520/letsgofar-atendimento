// Verificação do nome do contrato na lista e no PDF
// (rodar: npx tsx scripts/verify-contract-nome.mjs)
import { assinantes, resumoNomes, tituloPdfContrato, normalizar, textoBuscavel }
  from "../src/lib/contract-nome.ts";

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? "✅" : "❌"} ${msg}`); if (!cond) fail++; };

// --- quem identifica o contrato ---
const andre = [{ name: "ANDRE GRACIANO DOS SANTOS", status: "signed" }];
ok(assinantes(andre)[0] === "ANDRE GRACIANO DOS SANTOS", "usa quem assinou");

const misto = [
  { name: "IANKA CAVALCANTE", status: "pending" },
  { name: "ANDRE GRACIANO", status: "signed" },
];
ok(assinantes(misto).length === 1 && assinantes(misto)[0] === "ANDRE GRACIANO",
   "com assinatura e pendente na mesma lista, prefere quem ASSINOU");

const pendente = [{ name: "LUCAS LUIZ DA SILVA", status: "pending" }];
ok(assinantes(pendente)[0] === "LUCAS LUIZ DA SILVA",
   "contrato ainda sem assinatura mostra quem VAI assinar (melhor que nada)");

ok(assinantes([]).length === 0 && assinantes(null).length === 0 && assinantes(undefined).length === 0,
   "sem signatário não quebra");
ok(assinantes([{ name: "   ", status: "signed" }]).length === 0, "nome em branco não conta");

// --- linha curta ---
ok(resumoNomes(["ANA"]) === "ANA", "um nome");
ok(resumoNomes(["ANA", "BRUNO"]) === "ANA e BRUNO", "dois nomes");
ok(resumoNomes(["ANA", "BRUNO", "CARLA", "DAVI"]) === "ANA, BRUNO +2",
   "turma em grupo não vira parágrafo");
ok(resumoNomes([]) === "", "lista vazia vira string vazia");

// --- título do PDF (= nome do arquivo baixado) ---
const t = tituloPdfContrato("CTR-2026-00035", andre);
ok(t === "CTR-2026-00035 — ANDRE GRACIANO DOS SANTOS", `título do PDF: "${t}"`);
ok(tituloPdfContrato("CTR-2026-00036", []) === "CTR-2026-00036",
   "sem signatário, cai no número puro em vez de ficar com sobra");
ok(!/[\/:*?"<>|]/.test(tituloPdfContrato("CTR-1", [{ name: 'A/B:C*D?E"F<G>H|I', status: "signed" }])),
   "tira caractere proibido em nome de arquivo");
ok(tituloPdfContrato("CTR-1", [{ name: "ANA", status: "signed" }]).includes(" "),
   "NÃO come o espaço nem o hífen (o nome tem que continuar legível)");
ok(!tituloPdfContrato("CTR-1", [{ name: "A\\B", status: "signed" }]).includes("\\"),
   "tira tambem a barra invertida (invalida em nome de arquivo no Windows)");

// --- busca ---
ok(normalizar("André") === "andre", "acento não atrapalha a busca");
ok(normalizar("  MARIA HELENA ") === "maria helena", "caixa e espaço nas pontas");

const contrato = {
  number: "CTR-2026-00035",
  title: "ASSESSORIA PRO",
  contract_signers: [{ name: "André Graciano", status: "signed" }],
};
const alvo = textoBuscavel(contrato);
ok(alvo.includes("andre"), "acha por nome sem acento");
ok(alvo.includes("ctr-2026-00035"), "acha por número");
ok(alvo.includes("assessoria"), "acha por título");

console.log(fail ? `\n${fail} falha(s)` : "\nTudo certo.");
process.exit(fail ? 1 : 0);
