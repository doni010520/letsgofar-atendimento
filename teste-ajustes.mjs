/**
 * Confere na interface real o que a v1.8.1 prometeu — em vez de deduzir do
 * código. Só LÊ: nada é criado, enviado ou apagado.
 */
import puppeteer from "puppeteer-core";

const SP = "C:/Users/adoni/AppData/Local/Temp/claude/C--Users-adoni/2933f6b4-4bd9-4351-9745-1803cbcefa7b/scratchpad";
const APP = "https://letsgofarchat.benitechlab.com";
const EMAIL = "donikasumii@gmail.com";
const SENHA = "Tusape-7235";

const nav = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1000 },
});
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const p = await nav.newPage();
  await p.goto(`${APP}/login`, { waitUntil: "networkidle2", timeout: 60000 });
  await p.waitForSelector("input", { timeout: 30000 });
  await p.type('input[name="email"]', EMAIL, { delay: 25 });
  await p.type('input[name="password"]', SENHA, { delay: 25 });
  await (await p.$('button[type="submit"]'))?.click();
  await esperar(9000);
  if (/login/.test(p.url())) { console.log("NAO ENTROU"); process.exit(1); }

  /* 1) Abas Minhas / Sem responsável / Todas ------------------------------ */
  await p.goto(`${APP}/atendimento`, { waitUntil: "networkidle2", timeout: 60000 });
  await esperar(7000);
  const abas = await p.evaluate(() =>
    [...document.querySelectorAll("button")]
      .map((b) => (b.textContent ?? "").trim())
      .filter((t) => /^(Minhas|Sem responsável|Todas)\s*\d*$/.test(t)),
  );
  console.log("1) ABAS DE RESPONSÁVEL:", abas.length ? abas.join("  |  ") : "NÃO APARECERAM");
  await p.screenshot({ path: `${SP}/v181-atendimento.png` });

  const temGrupo = await p.evaluate(() => /GRUPO|Turma|English for/i.test(document.body.innerText));
  console.log("   grupos na lista:", temGrupo ? "aparecem" : "não vi nenhum (pode ser a aba Minhas)");

  /* 2) Contatos: busca ---------------------------------------------------- */
  await p.goto(`${APP}/clientes`, { waitUntil: "networkidle2", timeout: 60000 });
  await esperar(5000);
  const cabecalho = await p.evaluate(() => document.body.innerText.split("\n").filter(Boolean).slice(0, 3).join(" | "));
  console.log("\n2) CONTATOS:", cabecalho);
  const campoBusca = await p.$('input[placeholder*="Buscar"]');
  if (!campoBusca) console.log("   BUSCA NÃO ENCONTRADA");
  else {
    await campoBusca.type("luana", { delay: 40 });
    await esperar(3500);
    const res = await p.evaluate(() => {
      const linhas = [...document.querySelectorAll("tbody tr")].map((t) => t.innerText.replace(/\s+/g, " ").slice(0, 60));
      return { qtd: linhas.length, amostra: linhas.slice(0, 3) };
    });
    console.log(`   busca "luana": ${res.qtd} resultado(s)`);
    for (const l of res.amostra) console.log("     " + l);
  }
  await p.screenshot({ path: `${SP}/v181-contatos.png` });

  /* 3) Contratos: campos do modelo ---------------------------------------- */
  await p.goto(`${APP}/contratos`, { waitUntil: "networkidle2", timeout: 60000 });
  await esperar(5000);
  const novo = await p.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /novo contrato|\+ /i.test(x.textContent ?? ""));
    if (b) { b.click(); return (b.textContent ?? "").trim(); }
    return null;
  });
  console.log("\n3) CONTRATOS — botão clicado:", novo ?? "não achei o botão");
  await esperar(3000);

  const modelos = await p.evaluate(() =>
    [...document.querySelectorAll('select[name="template_id"] option')].map((o) => ({ v: o.value, t: (o.textContent ?? "").trim() })),
  );
  console.log("   modelos:", modelos.map((m) => m.t).join(" | "));
  const assessoria = modelos.find((m) => /assessoria/i.test(m.t));
  if (assessoria) {
    await p.select('select[name="template_id"]', assessoria.v);
    await esperar(2500);
    const campos = await p.evaluate(() =>
      [...document.querySelectorAll('input[name^="var_"]')].map((i) => {
        const lab = i.closest("div")?.querySelector("label");
        return `${i.getAttribute("name")?.slice(4)} (${(lab?.textContent ?? "").trim()}, ${i.type})`;
      }),
    );
    console.log(`   campos do modelo "${assessoria.t}": ${campos.length}`);
    for (const c of campos.slice(0, 8)) console.log("     " + c);
    if (campos.length > 8) console.log(`     ... e mais ${campos.length - 8}`);
  }
  await p.screenshot({ path: `${SP}/v181-contratos.png`, fullPage: true });

  /* 4) Tarefas: esconder concluídas --------------------------------------- */
  await p.goto(`${APP}/tarefas`, { waitUntil: "networkidle2", timeout: 60000 });
  await esperar(5000);
  const botao = await p.evaluate(() =>
    [...document.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim())
      .find((t) => /esconder concluídas|concluídas escondidas/i.test(t)) ?? null,
  );
  console.log("\n4) TAREFAS — botão de esconder:", botao ?? "NÃO APARECEU");
  await p.screenshot({ path: `${SP}/v181-tarefas.png` });
} catch (e) {
  console.error("ERRO:", e.message);
} finally {
  await nav.close();
}
