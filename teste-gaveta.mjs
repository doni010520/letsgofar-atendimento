import puppeteer from "puppeteer-core";
const SP="C:/Users/adoni/AppData/Local/Temp/claude/C--Users-adoni/2933f6b4-4bd9-4351-9745-1803cbcefa7b/scratchpad";
const APP=process.env.ALVO ?? "http://localhost:3000", EMAIL="donikasumii@gmail.com", SENHA="Tusape-7235";
const nav=await puppeteer.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:"new",args:["--no-sandbox","--disable-dev-shm-usage"]});
const esperar=(ms)=>new Promise(r=>setTimeout(r,ms));
try{
  const p=await nav.newPage();
  await p.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1");
  await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await p.goto(`${APP}/login`,{waitUntil:"networkidle2",timeout:60000});
  await p.waitForSelector("input",{timeout:30000});
  await p.type('input[name="email"]',EMAIL,{delay:20}); await p.type('input[name="password"]',SENHA,{delay:20});
  await (await p.$('button[type="submit"]'))?.click(); await esperar(9000);
  await p.goto(`${APP}/ajustes`,{waitUntil:"networkidle2",timeout:60000}); await esperar(4000);

  const antes = await p.evaluate(()=>{
    const a=document.querySelector("aside");
    return a ? { display:getComputedStyle(a).display, x:Math.round(a.getBoundingClientRect().x) } : null;
  });
  console.log("gaveta FECHADA:", JSON.stringify(antes));
  await p.evaluate(()=>{const b=document.querySelector('button[aria-label="Abrir menu"]'); b?.click();});
  await esperar(1200);
  const depois = await p.evaluate(()=>{
    const a=document.querySelector("aside");
    if(!a) return null;
    const r=a.getBoundingClientRect();
    const itens=[...a.querySelectorAll("a")].filter(x=>x.offsetParent!==null).map(x=>x.textContent.trim()).filter(Boolean);
    return { display:getComputedStyle(a).display, x:Math.round(r.x), largura:Math.round(r.width), itens:itens.length, exemplos:itens.slice(0,4) };
  });
  console.log("gaveta ABERTA :", JSON.stringify(depois));
  console.log(depois && depois.display!=="none" && depois.x>=0 && depois.itens>5
    ? "-> MENU APARECE e tem itens clicáveis" : "-> AINDA QUEBRADO");
  await p.screenshot({path:`${SP}/gaveta.png`});
} catch(e){console.error("ERRO:",e.message);} finally{await nav.close();}
