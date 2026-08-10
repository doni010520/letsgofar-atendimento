import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n")
  .filter(l=>l.includes("=")).map(l=>[l.slice(0,l.indexOf("=")).trim(), l.slice(l.indexOf("=")+1).trim().replace(/^["']|["']$/g,"")]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const { data: c } = await db.from("channels").select("id,credentials").limit(1).single();
const tk = c.credentials?.token ?? c.credentials?.instanceToken;

const f = await fetch(`${env.UAZAPI_HOST}/message/find`, {
  method: "POST", headers: { "Content-Type": "application/json", token: tk },
  body: JSON.stringify({ sort: "-messageTimestamp", limit: 500 }),
});
const todas = (await f.json()).messages ?? [];
const desde = new Date("2026-08-07T22:00:00Z").getTime();
const ate = new Date("2026-08-09T16:00:00Z").getTime();
const noGap = todas.filter(m => m.messageTimestamp >= desde && m.messageTimestamp <= ate && !m.fromMe);

console.log(`checando ${noGap.length} mensagens do gap contra o banco...\n`);
for (const m of noGap) {
  const { data: ja } = await db.from("messages").select("id").eq("external_id", m.id).maybeSingle();
  console.log(`${ja ? "JA EXISTE" : "FALTANDO "}  ${new Date(m.messageTimestamp).toISOString().slice(0,19)}  ${m.chatid}`);
}
