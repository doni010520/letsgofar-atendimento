/**
 * Mede o botão de enviar DE VERDADE.
 *
 * A primeira tentativa cronometrou o campo de texto esvaziando — que é
 * otimista e acontece na hora, antes de o servidor responder. Deu "20ms" e
 * escondeu que a mensagem do computador nem foi gravada.
 *
 * Aqui o que conta é: (1) o estado de "ocupado" do botão, (2) a resposta da
 * server action na rede, (3) o que sobrou no banco. Sem os três, não dá para
 * dizer que enviou.
 */
import puppeteer from "puppeteer-core";

const SP = "C:/Users/adoni/AppData/Local/Temp/claude/C--Users-adoni/2933f6b4-4bd9-4351-9745-1803cbcefa7b/scratchpad";
const APP = "https://letsgofarchat.benitechlab.com";
const EMAIL = "donikasumii@gmail.com";
const SENHA = "Tusape-7235";
const CONVERSA = "fbc0464f-a306-4e1d-8bdc-41d588325580";
const ALVO = "7193061031";
const MOBILE = process.env.MOBILE === "1";

const nav = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const p = await nav.newPage();
  if (MOBILE) {
    await p.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  } else {
    await p.setViewport({ width: 1500, height: 950 });
  }

  const erros = [];
  p.on("console", (m) => { if (m.type() === "error") erros.push(m.text().slice(0, 160)); });
  p.on("pageerror", (e) => erros.push(`pageerror: ${String(e.message).slice(0, 160)}`));

  // A server action volta como POST para a própria URL, com content-type text/x-component.
  const respostas = [];
  p.on("response", async (r) => {
    if (r.request().method() === "POST" && r.url().includes("/atendimento")) {
      respostas.push({ status: r.status(), quando: Date.now() });
    }
  });

  await p.goto(`${APP}/login`, { waitUntil: "networkidle2", timeout: 60000 });
  await p.waitForSelector("input", { timeout: 30000 });
  await p.type('input[name="email"]', EMAIL, { delay: 20 });
  await p.type('input[name="password"]', SENHA, { delay: 20 });
  await (await p.$('button[type="submit"]'))?.click();
  await esperar(9000);
  if (/login/.test(p.url())) { console.log("NAO ENTROU"); process.exit(1); }

  await p.goto(`${APP}/atendimento?c=${CONVERSA}`, { waitUntil: "networkidle2", timeout: 60000 });
  await esperar(7000);
  const naTela = await p.evaluate(() => document.body.innerText.slice(0, 1500));
  if (!naTela.replace(/\D/g, "").includes(ALVO.slice(-8))) {
    console.log("ABORTADO: a tela não mostra o número alvo."); process.exit(1);
  }

  const marca = `MARCA${Date.now()}`;
  const texto = `Teste ${MOBILE ? "celular" : "computador"} ${marca}`;
  const campo = await p.$("textarea");
  await campo.type(texto, { delay: 8 });
  await esperar(700);

  // Fotografa os botões ANTES, para saber qual é o de enviar.
  const antes = await p.evaluate(() =>
    [...document.querySelectorAll("button")].filter((b) => b.offsetParent !== null)
      .map((b, i) => `${i}:${(b.getAttribute("title") || b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 18)}`),
  );
  console.log(`[${MOBILE ? "CELULAR" : "COMPUTADOR"}] botões visíveis:`, antes.slice(-6).join(" | "));

  const t0 = Date.now();
  const qual = await p.evaluate(() => {
    const vis = [...document.querySelectorAll("button")].filter((b) => b.offsetParent !== null);
    const alvo = vis.find((b) => /enviar/i.test((b.getAttribute("title") ?? "") + (b.getAttribute("aria-label") ?? "")));
    if (!alvo) return null;
    alvo.click();
    return (alvo.getAttribute("title") || alvo.getAttribute("aria-label") || "?").trim();
  });
  console.log("clicou em:", qual ?? "NENHUM BOTÃO 'ENVIAR' ENCONTRADO");
  if (!qual) process.exit(1);

  // Espera a resposta da server action (não o campo esvaziar).
  let respondeu = null;
  for (let i = 0; i < 160; i++) {
    if (respostas.length) { respondeu = respostas[respostas.length - 1].quando - t0; break; }
    await esperar(250);
  }
  console.log(respondeu !== null ? `resposta do servidor em: ${respondeu} ms` : "servidor NÃO respondeu em 40s");
  await esperar(4000);
  if (erros.length) console.log("erros no console:", erros.slice(0, 3));
  await p.screenshot({ path: `${SP}/botao2-${MOBILE ? "cel" : "pc"}.png` });
  console.log("MARCA para conferir no banco:", marca);
} catch (e) {
  console.error("ERRO:", e.message);
} finally {
  await nav.close();
}
