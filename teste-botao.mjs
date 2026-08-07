/**
 * Cronometra o botão de enviar numa tela de CELULAR, no app em produção.
 *
 * A queixa era "o botão só fica carregando". Aqui a medida é o tempo entre o
 * clique e o botão voltar a ficar disponível — que é o que a pessoa sente.
 * Envia para o número do próprio dono, com texto marcado como teste.
 */
import puppeteer from "puppeteer-core";

const SP = "C:/Users/adoni/AppData/Local/Temp/claude/C--Users-adoni/2933f6b4-4bd9-4351-9745-1803cbcefa7b/scratchpad";
const APP = "https://letsgofarchat.benitechlab.com";
const EMAIL = "donikasumii@gmail.com";
const SENHA = "Tusape-7235";
const CONVERSA = "fbc0464f-a306-4e1d-8bdc-41d588325580"; // 71 9306-1031, o número do dono
const ALVO = "7193061031";

const nav = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const p = await nav.newPage();
  await p.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await p.goto(`${APP}/login`, { waitUntil: "networkidle2", timeout: 60000 });
  await p.waitForSelector("input", { timeout: 30000 });
  await p.type('input[name="email"]', EMAIL, { delay: 20 });
  await p.type('input[name="password"]', SENHA, { delay: 20 });
  await (await p.$('button[type="submit"]'))?.click();
  await esperar(9000);
  if (/login/.test(p.url())) { console.log("NAO ENTROU"); process.exit(1); }

  await p.goto(`${APP}/atendimento?c=${CONVERSA}`, { waitUntil: "networkidle2", timeout: 60000 });
  await esperar(7000);

  // Confere o destino ANTES de digitar — já mandei para o cliente errado uma vez.
  const naTela = await p.evaluate(() => document.body.innerText.slice(0, 1500));
  if (!naTela.replace(/\D/g, "").includes(ALVO.slice(-8))) {
    console.log("ABORTADO: a tela não mostra o número alvo. Nada foi enviado.");
    process.exit(1);
  }
  console.log("conversa confirmada: 71 9306-1031");

  const texto = `Teste do app — conferindo o tempo do botao de enviar (${new Date().toISOString().slice(11, 19)}).`;
  const campo = await p.$("textarea");
  if (!campo) { console.log("campo de texto não encontrado"); process.exit(1); }
  await campo.type(texto, { delay: 8 });
  await esperar(600);

  const t0 = Date.now();
  // O botão de enviar é o último visível da barra do compositor.
  const clicou = await p.evaluate(() => {
    const vis = [...document.querySelectorAll("button")].filter((b) => b.offsetParent !== null);
    const alvo = vis.find((b) => /enviar/i.test((b.getAttribute("title") ?? "") + (b.getAttribute("aria-label") ?? ""))) ?? vis[vis.length - 1];
    if (!alvo) return null;
    alvo.click();
    return (alvo.getAttribute("title") || alvo.getAttribute("aria-label") || "último botão").trim();
  });
  console.log("botão clicado:", clicou);

  // Espera o campo esvaziar — é o sinal de que a tela liberou.
  let liberou = null;
  for (let i = 0; i < 120; i++) {
    const vazio = await p.evaluate(() => {
      const ta = document.querySelector("textarea");
      return !ta || ta.value.trim() === "";
    });
    if (vazio) { liberou = Date.now() - t0; break; }
    await esperar(250);
  }
  console.log(liberou !== null
    ? `TEMPO ATÉ A TELA LIBERAR: ${liberou} ms`
    : "A TELA NÃO LIBEROU em 30s — o problema continua");
  await p.screenshot({ path: `${SP}/botao-depois.png` });
} catch (e) {
  console.error("ERRO:", e.message);
} finally {
  await nav.close();
}
