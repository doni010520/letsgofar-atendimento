/**
 * Auditoria da versão mobile num Chrome de verdade, em tela de celular.
 *
 * Mede em vez de opinar: estouro horizontal, alvos de toque pequenos demais,
 * texto miúdo e o que sobra de espaço útil depois das barras. Só LÊ.
 */
import puppeteer from "puppeteer-core";

const SP = "C:/Users/adoni/AppData/Local/Temp/claude/C--Users-adoni/2933f6b4-4bd9-4351-9745-1803cbcefa7b/scratchpad";
const APP = process.env.ALVO ?? "https://letsgofarchat.benitechlab.com";
const EMAIL = "donikasumii@gmail.com";
const SENHA = "Tusape-7235";

// iPhone 14: a tela mais estreita que a equipe usa de fato.
const CELULAR = {
  viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

const nav = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** O que dói no dedo e no olho, medido na página. */
const MEDIR = () => {
  const vw = window.innerWidth;
  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.offsetParent !== null;
  };
  const clicaveis = [...document.querySelectorAll("button, a, input, select, textarea, [role='button']")].filter(visivel);

  // 44px é o mínimo recomendado para o dedo (Apple HIG / Material).
  const pequenos = clicaveis.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.height < 40 || r.width < 32;
  });

  // Quem empurra a página para os lados.
  const vazando = [...document.querySelectorAll("*")].filter(visivel).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.right > vw + 2 || r.left < -2;
  }).slice(0, 8).map((el) => ({
    tag: el.tagName.toLowerCase(),
    cls: String(el.className ?? "").slice(0, 60),
    larg: Math.round(el.getBoundingClientRect().width),
    texto: (el.textContent ?? "").trim().slice(0, 30),
  }));

  const miudo = [...document.querySelectorAll("p, span, td, li, label")].filter(visivel).filter((el) => {
    const t = (el.textContent ?? "").trim();
    return t.length > 4 && parseFloat(getComputedStyle(el).fontSize) < 12;
  }).length;

  return {
    larguraPagina: document.documentElement.scrollWidth,
    viewport: vw,
    estouro: document.documentElement.scrollWidth - vw,
    clicaveis: clicaveis.length,
    alvosPequenos: pequenos.length,
    exemplosPequenos: pequenos.slice(0, 5).map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.getAttribute("title") || el.textContent || "").trim().slice(0, 18)}"`;
    }),
    vazando,
    textoMiudo: miudo,
    temTabelaLarga: [...document.querySelectorAll("table")].some((t) => t.getBoundingClientRect().width > vw),
  };
};

try {
  const p = await nav.newPage();
  await p.setUserAgent(CELULAR.ua);
  await p.setViewport(CELULAR.viewport);

  await p.goto(`${APP}/login`, { waitUntil: "networkidle2", timeout: 60000 });
  await p.waitForSelector("input", { timeout: 30000 });
  await p.type('input[name="email"]', EMAIL, { delay: 20 });
  await p.type('input[name="password"]', SENHA, { delay: 20 });
  await p.screenshot({ path: `${SP}/mob-login.png` });
  await (await p.$('button[type="submit"]'))?.click();
  await esperar(9000);
  if (/login/.test(p.url())) { console.log("NAO ENTROU"); process.exit(1); }

  const telas = [
    ["dashboard", "/dashboard"],
    ["atendimento", "/atendimento"],
    ["tarefas", "/tarefas"],
    ["contatos", "/clientes"],
    ["crm", "/crm"],
    ["contratos", "/contratos"],
  ];

  for (const [nome, rota] of telas) {
    await p.goto(`${APP}${rota}`, { waitUntil: "networkidle2", timeout: 60000 });
    await esperar(5500);
    const m = await p.evaluate(MEDIR);
    await p.screenshot({ path: `${SP}/mob-${nome}.png` });

    console.log(`\n═══ ${nome.toUpperCase()} (${rota})`);
    console.log(`  largura da página: ${m.larguraPagina}px  (tela: ${m.viewport}px)  ${m.estouro > 2 ? `→ VAZA ${m.estouro}px para o lado` : "→ cabe"}`);
    console.log(`  alvos de toque pequenos: ${m.alvosPequenos} de ${m.clicaveis}`);
    for (const e of m.exemplosPequenos) console.log(`      ${e}`);
    if (m.textoMiudo) console.log(`  trechos com fonte < 12px: ${m.textoMiudo}`);
    if (m.temTabelaLarga) console.log(`  TABELA mais larga que a tela`);
    if (m.vazando.length) {
      console.log(`  o que vaza:`);
      for (const v of m.vazando) console.log(`      <${v.tag}> ${v.larg}px "${v.texto}" ${v.cls ? `[${v.cls}]` : ""}`);
    }
  }

  /* A tela mais usada: dá para ler a conversa E a lista no celular? */
  await p.goto(`${APP}/atendimento`, { waitUntil: "networkidle2", timeout: 60000 });
  await esperar(6000);
  const layout = await p.evaluate(() => {
    const vw = window.innerWidth;
    const cols = [...document.querySelectorAll("div")].filter((d) => {
      const r = d.getBoundingClientRect();
      return r.height > 300 && r.width > 80 && r.width < vw * 0.95 && d.offsetParent;
    }).slice(0, 6).map((d) => `${Math.round(d.getBoundingClientRect().width)}px`);
    return { colunas: cols, textoTopo: document.body.innerText.slice(0, 160).replace(/\n+/g, " | ") };
  });
  console.log("\n═══ ATENDIMENTO — colunas lado a lado na tela de 390px:");
  console.log(`  ${layout.colunas.join("  ")}`);
  console.log(`  topo: ${layout.textoTopo}`);
} catch (e) {
  console.error("ERRO:", e.message);
} finally {
  await nav.close();
}
