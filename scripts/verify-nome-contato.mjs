// Regra do nome do contato (rodar: npx tsx scripts/verify-nome-contato.mjs)
import { nomeParaGravar } from "../src/lib/whatsapp/nome-contato.ts";

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? "✅" : "❌"} ${msg}`); if (!cond) fail++; };

// O BUG: nome digitado pela atendente sendo desfeito pelo push name.
ok(nomeParaGravar({ atual: "Antônio", contactName: "️" }) === null,
   "nome digitado NAO e sobrescrito pelo push name (o bug da Luana)");
ok(nomeParaGravar({ atual: "Antônio", contactName: "Tonho do Zap" }) === null,
   "nem por um push name que parece um nome de verdade");
ok(nomeParaGravar({ atual: "️", contactName: "Qualquer" }) === null,
   "nome esquisito ja gravado tambem se mantem (pode ter sido escolhido)");

// Preencher o que esta vazio continua funcionando.
ok(nomeParaGravar({ atual: null, contactName: "Maria" }) === "Maria", "contato novo pega o push name");
ok(nomeParaGravar({ atual: "", contactName: "Maria" }) === "Maria", "nome vazio pega o push name");
ok(nomeParaGravar({ atual: "   ", contactName: "Maria" }) === "Maria", "nome so com espaco conta como vazio");
ok(nomeParaGravar({ atual: null, contactName: null, chatName: "Maria Chat" }) === "Maria Chat",
   "sem push name, cai no nome do chat");
ok(nomeParaGravar({ atual: null, contactName: "  Maria  " }) === "Maria", "apara espacos");

// Eco de mensagem nossa em 1:1 traria o nome do DONO.
ok(nomeParaGravar({ atual: null, contactName: "LET'S GO FAR", fromMe: true, isGroup: false }) === null,
   "eco fromMe em 1:1 nao grava (viria o nome do dono da conta)");
ok(nomeParaGravar({ atual: null, chatName: "Turma A", fromMe: true, isGroup: true }) === "Turma A",
   "em GRUPO o eco fromMe pode nomear (e o nome do grupo)");

// Nada pra gravar.
ok(nomeParaGravar({ atual: null, contactName: null, chatName: null }) === null, "sem nome nenhum, nao mexe");
ok(nomeParaGravar({ atual: null, contactName: "", chatName: "" }) === null, "strings vazias nao gravam");

console.log(fail ? `\n${fail} falha(s)` : "\nTudo certo.");
process.exit(fail ? 1 : 0);
