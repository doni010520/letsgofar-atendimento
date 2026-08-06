/**
 * Testa o envio de arquivo pela interface real, num Chrome de verdade —
 * exatamente o caminho que a equipe usa. Envia para o número de teste.
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const SP = "C:/Users/adoni/AppData/Local/Temp/claude/C--Users-adoni/2933f6b4-4bd9-4351-9745-1803cbcefa7b/scratchpad";
const APP = "https://letsgofarchat.benitechlab.com";
const EMAIL = "donikasumii@gmail.com";
const SENHA = "Tusape-7235";
const ALVO = "557193061031";

const nav = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1500, height: 950 },
});

try {
  const p = await nav.newPage();
  const erros = [];
  p.on("console", (m) => { if (m.type() === "error") erros.push(m.text().slice(0, 200)); });
  p.on("response", async (r) => {
    if (r.url().includes("enviar-midia")) {
      console.log(`  [rede] ${r.status()} ${r.url().split("?")[0]}`);
      try { console.log("  [resposta]", (await r.text()).slice(0, 300)); } catch { /* sem corpo */ }
    }
  });

  await p.goto(`${APP}/login`, { waitUntil: "networkidle2", timeout: 60000 });
  await p.waitForSelector("input", { timeout: 30000 });
  const campos = await p.evaluate(() =>
    [...document.querySelectorAll("input")].map((i) => ({ t: i.type, n: i.name, ph: i.placeholder })),
  );
  console.log("campos do login:", JSON.stringify(campos));

  // Digitação real: preencher por setter não dispara os handlers do React.
  await p.type('input[name="email"]', EMAIL, { delay: 30 });
  await p.type('input[name="password"]', SENHA, { delay: 30 });
  const btn = await p.$('button[type="submit"]');
  if (btn) await btn.click();
  else   await p.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 9000));
  console.log("depois do login:", p.url());
  if (/login/.test(p.url())) {
    console.log("NÃO ENTROU:", (await p.evaluate(() => document.body.innerText)).slice(0, 300));
    await p.screenshot({ path: `${SP}/app-login.png` });
    process.exit(1);
  }

  // Abre a conversa do número de teste pela busca.
  await p.goto(`${APP}/atendimento`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 6000));

  // Link direto para a conversa: buscar por texto falhou porque o contato
  // está sem nome, e cair na primeira da lista já mandou arquivo para o
  // cliente errado uma vez. Aqui o destino é explícito.
  const CONVERSA = "fbc0464f-a306-4e1d-8bdc-41d588325580";
  await p.goto(`${APP}/atendimento?c=${CONVERSA}`, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 7000));

  // Confere na tela que é o número certo ANTES de anexar qualquer coisa.
  const naTela = await p.evaluate(() => document.body.innerText.slice(0, 1200));
  if (!naTela.replace(/\D/g, "").includes(ALVO.slice(-8))) {
    console.log("ABORTADO: a tela não mostra o número alvo. Nada foi enviado.");
    console.log("  visível:", naTela.slice(0, 200));
    await p.screenshot({ path: `${SP}/app-conversa-errada.png` });
    process.exit(1);
  }
  console.log("conversa confirmada na tela: 71 9306-1031");
  await p.screenshot({ path: `${SP}/app-conversa.png` });

  // Arquivo a enviar: por argumento, ou o PDF de teste gerado.
  const pdf = process.argv[2] ?? `${SP}/contrato-teste.pdf`;
  if (!fs.existsSync(pdf)) { console.log("arquivo nao encontrado:", pdf); process.exit(1); }
  console.log("arquivo de teste:", pdf.split(/[\/]/).pop(),
              `(${(fs.statSync(pdf).size / 1024 / 1024).toFixed(2)} MB)`);

  const inputs = await p.$$('input[type="file"]');
  console.log("campos de arquivo na tela:", inputs.length);
  if (!inputs.length) {
    console.log("nenhum campo de arquivo — a conversa abriu?");
    process.exit(1);
  }
  await inputs[0].uploadFile(pdf);
  await new Promise((r) => setTimeout(r, 3000));
  await p.screenshot({ path: `${SP}/app-preview.png` });

  // Confirma o envio: primeiro mostra o que apareceu na tela.
  const controles = await p.evaluate(() =>
    [...document.querySelectorAll("button")]
      .filter((b) => b.offsetParent !== null)
      .map((b) => (b.getAttribute("title") || b.textContent || "").trim().slice(0, 30))
      .filter(Boolean),
  );
  console.log("botões visíveis:", JSON.stringify(controles.slice(-14)));

  const enviou = await p.evaluate(() => {
    const vis = [...document.querySelectorAll("button")].filter((b) => b.offsetParent !== null);
    const alvo =
      vis.find((b) => /^enviar$/i.test((b.textContent ?? "").trim())) ??
      vis.find((b) => /enviar/i.test((b.getAttribute("title") ?? "") + (b.textContent ?? ""))) ??
      vis[vis.length - 1];
    if (!alvo) return null;
    alvo.click();
    return (alvo.getAttribute("title") || alvo.textContent || "?").trim();
  });
  console.log("botão de envio clicado:", enviou);
  await new Promise((r) => setTimeout(r, 12000));
  await p.screenshot({ path: `${SP}/app-depois.png`, fullPage: false });

  const aviso = await p.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/Não foi possível[^\n]*/);
    return m ? m[0] : null;
  });
  console.log("\naviso de erro na tela:", aviso ?? "(nenhum)");
  if (erros.length) console.log("erros do console:", erros.slice(0, 4));
} catch (e) {
  console.error("ERRO:", e.message);
} finally {
  await nav.close();
}
