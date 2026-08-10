import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n")
  .filter(l=>l.includes("=")).map(l=>[l.slice(0,l.indexOf("=")).trim(), l.slice(l.indexOf("=")+1).trim().replace(/^["']|["']$/g,"")]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}});

// variantes do numero do Matheus
const base = "5531971625679";
const semNove = "553171625679";
console.log("procurando contatos com esses telefones:", base, "|", semNove);

const { data: contatos } = await db.from("contacts").select("id,name,phone,created_at").in("phone",[base, semNove]);
console.log(`\nCONTATOS encontrados: ${contatos?.length ?? 0}`);
for (const c of contatos ?? []) console.log(`  ${c.id}  ${c.phone}  "${c.name}"  criado ${c.created_at}`);

for (const c of contatos ?? []) {
  const { data: convs } = await db.from("conversations").select("id,status,created_at,last_message_at").eq("contact_id", c.id);
  console.log(`\n  conversas do contato ${c.phone} (${c.id.slice(0,8)}):`, convs?.length ?? 0);
  for (const cv of convs ?? []) {
    console.log(`    conversa ${cv.id}  status=${cv.status}  last=${cv.last_message_at}`);
    const { data: msgs } = await db.from("messages").select("created_at,direction,status,external_id,body")
      .eq("conversation_id", cv.id).order("created_at",{ascending:true});
    for (const m of msgs ?? []) console.log(`      ${m.created_at.slice(0,19).replace("T"," ")} ${m.direction} status=${m.status} recibo=${m.external_id?"sim":"NAO"} "${(m.body??"").slice(0,50).replace(/\n/g," ")}"`);
  }
}
