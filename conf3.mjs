import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n")
  .filter(l=>l.includes("=")).map(l=>[l.slice(0,l.indexOf("=")).trim(), l.slice(l.indexOf("=")+1).trim().replace(/^["']|["']$/g,"")]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});
const marca = process.argv[2];
const { data } = await db.from("messages").select("created_at,body,status,external_id").ilike("body",`%${marca}%`);
console.log(`gravado no banco? ${data?.length ? "SIM" : "NAO"}  (${data?.length ?? 0} linha(s))`);
for (const m of data ?? []) console.log(`   ${m.created_at.slice(11,23)} status=${m.status} recibo=${m.external_id?"sim":"NENHUM"}`);
