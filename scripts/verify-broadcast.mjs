// Verificação das regras de disparo (rodar: npx tsx scripts/verify-broadcast.mjs)
import { resolveSpintax, personalize, phoneVariants, normalizePhone,
         isWithinWindow, parseRecipientsCsv, randomInterval } from "../src/lib/broadcast.ts";

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? "✅" : "❌"} ${msg}`); if (!cond) fail++; };

// spintax
const outs = new Set(Array.from({length: 40}, () => resolveSpintax("{Oi|Olá|E aí} pessoal")));
ok(outs.size > 1, `spintax gera variações (${outs.size} distintas)`);
ok([...outs].every(o => /^(Oi|Olá|E aí) pessoal$/.test(o)), "spintax mantém o restante do texto");

// personalização
const msg = personalize("Oi {primeiro_nome}, sobre {merge1}",
  { name: "Vinícius Cabral", phone: "5511999", merge_fields: { merge1: "inglês" } });
ok(msg === "Oi Vinícius, sobre inglês", `merge usa 1º nome: "${msg}"`);

// 9º dígito (o bug que quebrou entregas)
const v = phoneVariants("5571993061031");
ok(v.includes("5571993061031") && v.includes("557193061031"),
   `variantes com/sem o 9: ${v.join(" e ")}`);
ok(normalizePhone("(71) 99306-1031") === "5571993061031", "normaliza e completa DDI 55");
ok(normalizePhone("123") === null, "rejeita número curto");

// janela de horário
const noon = new Date("2026-07-25T15:00:00Z"); // 12h BRT
const dawn = new Date("2026-07-25T09:00:00Z"); // 6h BRT
ok(isWithinWindow(noon, 9, 18, "America/Sao_Paulo") === true, "12h BRT está na janela 9-18");
ok(isWithinWindow(dawn, 9, 18, "America/Sao_Paulo") === false, "6h BRT está FORA da janela 9-18");
ok(isWithinWindow(dawn, 22, 8, "America/Sao_Paulo") === true, "janela que cruza a meia-noite");

// intervalo
const ints = Array.from({length: 50}, () => randomInterval(300, 360));
ok(ints.every(i => i >= 300 && i <= 360), "intervalo respeita 5-6 min");

// CSV
const rows = parseRecipientsCsv("telefone,nome,merge1\n71993061031,Adonias,teste\nlixo,,\n");
ok(rows.length === 1 && rows[0].phone === "5571993061031" && rows[0].merge_fields.merge1 === "teste",
   "CSV: parseia válido, ignora inválido, captura merge");

console.log(fail ? `\n${fail} FALHA(S)` : "\nTodos os testes passaram");
process.exit(fail ? 1 : 0);
