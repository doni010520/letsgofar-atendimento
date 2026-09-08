// Recortes e busca de tarefas (rodar: npx tsx scripts/verify-task-filtros.mjs)
import { noEscopo, casaBusca, chaveDaColuna } from "../src/lib/task-filtros.ts";

let fail = 0;
const ok = (c, m) => { console.log(`${c ? "OK " : "XX "} ${m}`); if (!c) fail++; };

const EU = "u-ianka", OUTRA = "u-luana";
const minhaPropria = { assigned_to: EU, created_by: EU };
const queEuDei     = { assigned_to: OUTRA, created_by: EU };
const queRecebi    = { assigned_to: EU, created_by: OUTRA };
const deTerceiros  = { assigned_to: OUTRA, created_by: OUTRA };

// --- o pedido da Ianka: separar o que ela RECEBEU ---
ok(noEscopo(queRecebi, "recebidas", EU) === true, "recebidas PEGA a que outra pessoa me passou");
ok(noEscopo(queEuDei, "recebidas", EU) === false, "recebidas NAO pega a que eu deleguei (era o filtro invertido)");
ok(noEscopo(minhaPropria, "recebidas", EU) === false, "recebidas NAO pega a que eu criei pra mim (= 'as nossas')");
ok(noEscopo(deTerceiros, "recebidas", EU) === false, "recebidas NAO pega tarefa de outra pessoa");

// --- delegadas continua sendo o espelho, intacto ---
ok(noEscopo(queEuDei, "delegadas", EU) === true, "delegadas pega a que eu dei");
ok(noEscopo(queRecebi, "delegadas", EU) === false, "delegadas nao pega a que eu recebi");

// --- minhas engloba as duas pontas do que e meu ---
ok(noEscopo(minhaPropria, "minhas", EU) === true, "minhas pega a que eu criei pra mim");
ok(noEscopo(queRecebi, "minhas", EU) === true, "minhas pega a recebida (recebidas e um subconjunto de minhas)");
ok(noEscopo(queEuDei, "minhas", EU) === false, "minhas nao pega a que saiu pra outra pessoa");

// --- bordas ---
ok(noEscopo(queRecebi, "todas", EU) === true, "todas nao filtra nada");
ok(noEscopo(queRecebi, "recebidas", null) === true, "sem 'eu' definido, nao esvazia a tela");
ok(noEscopo({ assigned_to: null, created_by: null }, "recebidas", EU) === false, "tarefa sem dono nao vira recebida");

// --- busca ---
const t = { title: "Preparar material do André", description: "Turma de conversação", assigned_to: EU };
ok(casaBusca(t, "andre") === true, "busca ignora acento");
ok(casaBusca(t, "ANDRE") === true, "busca ignora caixa");
ok(casaBusca(t, "conversacao") === true, "busca acha na descricao");
ok(casaBusca(t, "  ") === true, "termo vazio nao filtra");
ok(casaBusca(t, "financeiro") === false, "termo que nao existe nao casa");
ok(casaBusca(t, "luana", "Luana Lima") === true, "acha pelo NOME de quem e responsavel");
ok(casaBusca(t, "luana") === false, "sem o nome do responsavel, nao inventa correspondencia");
ok(casaBusca({ title: null, description: null }, "x") === false, "titulo/descricao nulos nao quebram");


// --- posicionamento no quadro unico ---
const COLS = new Set(["col-delegadas", "col-espera"]);
ok(chaveDaColuna({ status: "pending", column_id: null }, COLS) === "pending",
   "sem coluna propria, cai na coluna do STATUS");
ok(chaveDaColuna({ status: "in_progress", column_id: "col-delegadas" }, COLS) === "col-delegadas",
   "com coluna propria, aparece nela (e o status continua gravado)");
ok(chaveDaColuna({ status: "completed", column_id: "col-que-foi-apagada" }, COLS) === "completed",
   "coluna apagada nao some com a tarefa: volta pro status");
ok(chaveDaColuna({ status: null, column_id: null }, COLS) === "pending",
   "sem status nenhum, assume 'a fazer' em vez de sumir");
ok(chaveDaColuna({ status: "pending", column_id: null }, []) === "pending",
   "sem nenhuma coluna propria criada, o quadro e so o de status");

console.log(fail ? `\n${fail} falha(s)` : "\nTudo certo.");
process.exit(fail ? 1 : 0);
