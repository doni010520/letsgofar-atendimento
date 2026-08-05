/**
 * Importa a operação do Chatwoot para o letsgofar-atendimento.
 *
 * Traz: times → departamentos, respostas rápidas, etiquetas, agentes
 * (como convites pendentes), contatos e o histórico de conversas/mensagens.
 *
 * Uso:
 *   CHATWOOT_URL=... CHATWOOT_TOKEN=... ORG_ID=<uuid> \
 *   node scripts/import-chatwoot.mjs [--dry] [--sem-conversas]
 *
 * É idempotente: rodar de novo não duplica (casa por telefone/nome/atalho).
 */

import pg from "pg";

const CW_URL = process.env.CHATWOOT_URL;
const CW_TOKEN = process.env.CHATWOOT_TOKEN;
const CW_ACCOUNT = process.env.CHATWOOT_ACCOUNT_ID ?? "1";
const DB_URL = process.env.SUPABASE_DB_URL;
const ORG_ID = process.env.ORG_ID;

const DRY = process.argv.includes("--dry");
const SKIP_CONVERSATIONS = process.argv.includes("--sem-conversas");

// --limite N: traz só as N conversas mais recentes. O Chatwoot já devolve
// ordenado da mais recente para a mais antiga, então isso permite migrar em
// lotes ("as últimas 50", depois mais 50) sem travar o banco de uma vez.
const limiteArg = process.argv.find((a) => a.startsWith("--limite="));
const LIMITE = limiteArg ? Number(limiteArg.split("=")[1]) : Infinity;
if (Number.isNaN(LIMITE) || LIMITE <= 0) {
  console.error("--limite= precisa ser um número maior que zero.");
  process.exit(1);
}

if (!CW_URL || !CW_TOKEN || !DB_URL || !ORG_ID) {
  console.error("Defina CHATWOOT_URL, CHATWOOT_TOKEN, SUPABASE_DB_URL e ORG_ID.");
  process.exit(1);
}

async function cw(path) {
  const res = await fetch(`${CW_URL}/api/v1/accounts/${CW_ACCOUNT}/${path}`, {
    headers: { api_access_token: CW_TOKEN, "User-Agent": "curl/8.4.0" },
  });
  if (!res.ok) throw new Error(`Chatwoot ${path}: HTTP ${res.status}`);
  return res.json();
}

/** Normaliza telefone para só dígitos com DDI (mesma regra do app). */
function normalizePhone(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.length <= 11) d = `55${d}`;
  return d;
}

const db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const stats = {};
const count = (k, n = 1) => (stats[k] = (stats[k] ?? 0) + n);

async function run(sql, params) {
  if (DRY) return { rows: [] };
  return db.query(sql, params);
}

// ── 1. Times → departamentos ─────────────────────────────────────────
console.log("\n▸ Times → departamentos");
const teams = await cw("teams");
const deptByTeam = new Map();
for (const t of teams) {
  // Não há unique em departments: procura por nome (sem acento/caixa) antes
  // de criar, senão rodar duas vezes duplicaria tudo.
  let id = null;
  if (!DRY) {
    const achou = await db.query(
      `select id from departments where organization_id=$1 and lower(name)=lower($2) limit 1`,
      [ORG_ID, t.name],
    );
    id = achou.rows[0]?.id ?? null;
  }
  if (!id) {
    const { rows } = await run(
      `insert into departments (organization_id, name) values ($1,$2) returning id`,
      [ORG_ID, t.name],
    );
    id = rows[0]?.id ?? null;
    console.log(`  + ${t.name}`);
    count("departamentos_criados");
  } else {
    console.log(`  = ${t.name} (já existia)`);
    count("departamentos_existentes");
  }
  deptByTeam.set(t.id, id);
}

// ── 2. Respostas rápidas ─────────────────────────────────────────────
console.log("\n▸ Respostas rápidas");
const canned = await cw("canned_responses");
for (const c of canned) {
  let existe = false;
  if (!DRY) {
    const r = await db.query(
      `select id from quick_replies where organization_id=$1 and shortcut=$2 limit 1`,
      [ORG_ID, c.short_code],
    );
    existe = r.rows.length > 0;
  }
  if (existe) { count("respostas_existentes"); continue; }
  await run(
    `insert into quick_replies (organization_id, title, content, shortcut) values ($1,$2,$3,$4)`,
    [ORG_ID, c.short_code, c.content, c.short_code],
  );
  console.log(`  + /${c.short_code}`);
  count("respostas_rapidas");
}

// ── 3. Etiquetas ─────────────────────────────────────────────────────
console.log("\n▸ Etiquetas");
const labels = await cw("labels");
const labelList = labels.payload ?? labels;
for (const l of labelList) {
  if (!DRY) {
    const r = await db.query(
      `select id from tags where organization_id=$1 and lower(name)=lower($2) limit 1`,
      [ORG_ID, l.title],
    );
    if (r.rows.length) { count("etiquetas_existentes"); continue; }
  }
  await run(
    `insert into tags (organization_id, name, color) values ($1,$2,$3)`,
    [ORG_ID, l.title, l.color ?? "#6366F1"],
  );
  console.log(`  + ${l.title}`);
  count("etiquetas");
}

// ── 4. Contatos ──────────────────────────────────────────────────────
console.log("\n▸ Contatos");
const contactIdMap = new Map();
for (let page = 1; page <= 60; page += 1) {
  const data = await cw(`contacts?page=${page}`);
  const list = data.payload ?? [];
  if (!list.length) break;

  for (const c of list) {
    const phone = normalizePhone(c.phone_number);
    if (!phone) continue;
    const { rows } = await run(
      `insert into contacts (organization_id, name, phone, notes)
         values ($1, $2, $3, $4)
       on conflict (organization_id, phone) do update
         set name = coalesce(nullif(excluded.name,''), contacts.name)
       returning id`,
      [ORG_ID, c.name ?? phone, phone, c.additional_attributes?.description ?? null],
    );
    if (rows[0]?.id) contactIdMap.set(c.id, rows[0].id);
    count("contatos");
  }
  process.stdout.write(`\r  ${stats.contatos ?? 0} contatos...`);
}
console.log("");

// ── 5. Conversas + mensagens ─────────────────────────────────────────
if (!SKIP_CONVERSATIONS) {
  console.log("\n▸ Conversas e mensagens (histórico)");
  const { rows: chRows } = DRY
    ? { rows: [] }
    : await db.query(`select id from channels where organization_id=$1 limit 1`, [ORG_ID]);
  const channelId = chRows[0]?.id ?? null;

  let vistas = 0;
  for (let page = 1; page <= 60 && vistas < LIMITE; page += 1) {
    const data = await cw(`conversations?status=all&assignee_type=all&page=${page}`);
    const list = (data.data?.payload ?? []).sort(
      (a, b) => (b.last_activity_at ?? 0) - (a.last_activity_at ?? 0),
    );
    if (!list.length) break;

    for (const conv of list) {
      if (vistas >= LIMITE) break;
      vistas += 1;
      const cwContactId = conv.meta?.sender?.id;
      const contactId = contactIdMap.get(cwContactId);
      if (!contactId) continue;

      const status =
        conv.status === "open" ? "open" : conv.status === "pending" ? "queued" : "closed";

      // Reaproveita a conversa que o app já tem para este contato. Sem isso, um
      // contato que escreveu durante o paralelo ganharia uma segunda conversa.
      let convId = null;
      if (!DRY) {
        const existente = await db.query(
          `select id from conversations
            where organization_id=$1 and contact_id=$2
            order by created_at limit 1`,
          [ORG_ID, contactId],
        );
        convId = existente.rows[0]?.id ?? null;
      }
      if (convId) {
        count("conversas_reaproveitadas");
      } else {
        const { rows } = await run(
          `insert into conversations
             (organization_id, channel_id, contact_id, status, last_message_at, created_at)
           values ($1,$2,$3,$4,to_timestamp($5),to_timestamp($6))
           returning id`,
          [ORG_ID, channelId, contactId, status, conv.last_activity_at ?? 0, conv.created_at ?? 0],
        );
        convId = rows[0]?.id ?? null;
        if (!convId) continue;
        count("conversas");
      }

      // Mensagens da conversa
      try {
        const msgs = await cw(`conversations/${conv.id}/messages`);
        for (const m of msgs.payload ?? []) {
          if (m.message_type === 2) continue; // atividade interna do Chatwoot
          // Já gravada (chegou pelo paralelo ou por uma execução anterior)?
          if (!DRY) {
            let ja;
            if (m.source_id) {
              // O app grava "<numero>:<id>"; o Chatwoot guarda só "<id>".
              ja = await db.query(
                `select 1 from messages
                  where organization_id=$1
                    and (external_id=$2 or external_id like '%:' || $2)
                  limit 1`,
                [ORG_ID, m.source_id],
              );
            } else {
              // Mensagem que FALHOU não tem recibo. Sem esta segunda checagem,
              // cada execução do importador a inseria de novo — foi o que gerou
              // 63 duplicatas. Casa por conversa + texto + instante.
              ja = await db.query(
                `select 1 from messages
                  where organization_id=$1 and conversation_id=$2
                    and coalesce(body,'') = coalesce($3,'')
                    and created_at = to_timestamp($4)
                  limit 1`,
                [ORG_ID, convId, m.content ?? "", m.created_at ?? 0],
              );
            }
            if (ja.rows.length) { count("mensagens_ja_existentes"); continue; }
          }
          await run(
            `insert into messages
               (organization_id, conversation_id, direction, sender_type, content_type,
                body, status, external_id, created_at)
             values ($1,$2,$3,$4,'text',$5,$6,$7,to_timestamp($8))`,
            [
              ORG_ID,
              convId,
              m.message_type === 1 ? "out" : "in",
              m.message_type === 1 ? "agent" : "contact",
              m.content ?? "",
              m.status ?? "sent",
              // string vazia vira null: "" agruparia mensagens distintas e
              // atrapalharia qualquer consulta por id externo
              m.source_id || null,
              m.created_at ?? 0,
            ],
          );
          count("mensagens");
        }
      } catch {
        /* conversa sem mensagens acessíveis — segue */
      }
    }
    process.stdout.write(`\r  ${stats.conversas ?? 0} conversas, ${stats.mensagens ?? 0} mensagens...`);
  }
  console.log("");
}

// ── Resumo ───────────────────────────────────────────────────────────
console.log(`\n${DRY ? "SIMULAÇÃO (nada gravado)" : "Importação concluída"}:`);
for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);

await db.end();
