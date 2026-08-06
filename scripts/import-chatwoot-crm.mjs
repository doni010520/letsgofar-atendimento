/**
 * Segunda parte da migração: traz do Chatwoot o que o importador de conversas
 * não cobria — CRM (pipelines, estágios, campos, cards), tarefas e contratos.
 *
 * Uso:
 *   CHATWOOT_URL=... CHATWOOT_TOKEN=... SUPABASE_DB_URL=... ORG_ID=<uuid> \
 *   node scripts/import-chatwoot-crm.mjs [--dry]
 *
 * É idempotente: casa por nome (pipelines/estágios/campos), por título+data
 * (tarefas) e por número (contratos). Rodar de novo não duplica.
 */

import pg from "pg";

const CW_URL = process.env.CHATWOOT_URL;
const CW_TOKEN = process.env.CHATWOOT_TOKEN;
const CW_ACCOUNT = process.env.CHATWOOT_ACCOUNT_ID ?? "1";
const DB_URL = process.env.SUPABASE_DB_URL;
const ORG_ID = process.env.ORG_ID;
const DRY = process.argv.includes("--dry");

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

/** Desembrulha as duas formas de resposta do Chatwoot ({data:[…]} ou […]). */
const lista = (d) => (Array.isArray(d) ? d : (d?.data ?? d?.payload ?? []));

/** Mesma normalização do importador de conversas. */
function normalizePhone(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.length <= 11) d = `55${d}`;
  return d;
}

const db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const stats = {};
const conta = (k, n = 1) => (stats[k] = (stats[k] ?? 0) + n);
const q = async (sql, params) => (DRY ? { rows: [] } : db.query(sql, params));

// ── Agentes do Chatwoot → perfis do app (casados por nome) ───────────────
console.log("▸ Agentes → perfis");
const { rows: perfis } = await db.query(
  `select id, name from profiles where organization_id = $1`,
  [ORG_ID],
);
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const perfilPorNome = new Map(perfis.map((p) => [norm(p.name), p.id]));
/** Casa "Vanessa- Financeiro" com "Vanessa", "Ianka Cavalcante" com "Ianka", etc. */
function acharPerfil(nome) {
  if (!nome) return null;
  const alvo = norm(nome);
  if (perfilPorNome.has(alvo)) return perfilPorNome.get(alvo);
  for (const [n, id] of perfilPorNome) {
    if (n.startsWith(alvo.split(/[\s-]/)[0]) || alvo.startsWith(n.split(/[\s-]/)[0])) return id;
  }
  return null;
}

// ── Contatos por telefone (para casar cards e contratos) ─────────────────
const { rows: contatos } = await db.query(
  `select id, phone from contacts where organization_id = $1`,
  [ORG_ID],
);
const contatoPorFone = new Map(contatos.map((c) => [c.phone, c.id]));

// ── 1. Pipelines, estágios e campos ──────────────────────────────────────
console.log("\n▸ Pipelines, estágios e campos personalizados");
const stageMap = new Map(); // id do estágio no Chatwoot → id no app
const fieldMap = new Map(); // "pipelineCw:field_key" → id do campo no app

for (const p of lista(await cw("kanban/pipelines"))) {
  let pipeId = null;
  if (!DRY) {
    const achou = await db.query(
      `select id from pipelines where organization_id=$1 and lower(name)=lower($2) limit 1`,
      [ORG_ID, p.name],
    );
    pipeId = achou.rows[0]?.id ?? null;
  }
  if (!pipeId) {
    const { rows } = await q(
      `insert into pipelines (organization_id, name, description, kind, is_default, position)
       values ($1,$2,$3,$4,$5,0) returning id`,
      [ORG_ID, p.name, p.description ?? null, p.pipeline_type ?? "both", !!p.is_default],
    );
    pipeId = rows[0]?.id ?? null;
    console.log(`  + pipeline ${p.name}`);
    conta("pipelines");
  } else {
    console.log(`  = pipeline ${p.name} (já existia)`);
  }
  if (!pipeId) continue;

  // Estágios
  for (const s of lista(await cw(`kanban/pipelines/${p.id}/stages`))) {
    let sid = null;
    if (!DRY) {
      const a = await db.query(
        `select id from pipeline_stages where organization_id=$1 and pipeline_id=$2 and lower(name)=lower($3) limit 1`,
        [ORG_ID, pipeId, s.name],
      );
      sid = a.rows[0]?.id ?? null;
    }
    if (!sid) {
      const { rows } = await q(
        `insert into pipeline_stages (organization_id, pipeline_id, name, color, position)
         values ($1,$2,$3,$4,$5) returning id`,
        [ORG_ID, pipeId, s.name, s.color ?? null, s.position ?? 0],
      );
      sid = rows[0]?.id ?? null;
      conta("estagios");
    }
    if (sid) stageMap.set(s.id, sid);
  }

  // Campos personalizados
  let campos = [];
  try {
    campos = lista(await cw(`kanban/pipelines/${p.id}/custom_fields`));
  } catch {
    /* pipeline sem campos */
  }
  for (const f of campos) {
    let fid = null;
    if (!DRY) {
      const a = await db.query(
        `select id from pipeline_fields where organization_id=$1 and pipeline_id=$2 and key=$3 limit 1`,
        [ORG_ID, pipeId, f.field_key],
      );
      fid = a.rows[0]?.id ?? null;
    }
    if (!fid) {
      const { rows } = await q(
        `insert into pipeline_fields (organization_id, pipeline_id, name, key, field_type, options, required, position)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [
          ORG_ID, pipeId, f.name, f.field_key, f.field_type ?? "text",
          JSON.stringify(f.select_options?.length ? { choices: f.select_options } : (f.options ?? {})),
          !!f.required, f.position ?? 0,
        ],
      );
      fid = rows[0]?.id ?? null;
      conta("campos");
    }
    if (fid) fieldMap.set(`${p.id}:${f.field_key}`, fid);
  }

  // ── 2. Cards do board → CRM na conversa ────────────────────────────────
  const board = await cw(`kanban/pipelines/${p.id}/board`);
  const colunas = (Array.isArray(board) ? board[0] : board)?.board ?? [];
  for (const col of colunas) {
    for (const item of col.items ?? []) {
      const fone = normalizePhone(item.contact?.phone_number);
      const contatoId = fone ? contatoPorFone.get(fone) : null;
      if (!contatoId) { conta("cards_sem_contato"); continue; }

      // A conversa mais recente daquele contato recebe o card.
      const { rows: cvs } = await db.query(
        `select id from conversations
          where organization_id=$1 and contact_id=$2
          order by created_at desc limit 1`,
        [ORG_ID, contatoId],
      );
      const convId = cvs[0]?.id;
      if (!convId) { conta("cards_sem_conversa"); continue; }

      await q(
        `update conversations
            set stage_id = $1,
                deal_value = coalesce($2, deal_value),
                closed_won = coalesce($3, closed_won)
          where id = $4`,
        [stageMap.get(item.kanban_stage_id) ?? null, item.deal_value, item.closed_won, convId],
      );
      conta("cards");

      // Valores dos campos personalizados do card
      for (const cf of item.custom_field_values ?? []) {
        const fid = fieldMap.get(`${p.id}:${cf.field_key}`);
        if (!fid || cf.value == null || cf.value === "") continue;
        const jaTem = DRY ? { rows: [] } : await db.query(
          `select id from pipeline_field_values where organization_id=$1 and field_id=$2 and conversation_id=$3 limit 1`,
          [ORG_ID, fid, convId],
        );
        if (jaTem.rows.length) continue;
        await q(
          `insert into pipeline_field_values (organization_id, field_id, conversation_id, contact_id, value)
           values ($1,$2,$3,$4,$5)`,
          [ORG_ID, fid, convId, contatoId, String(cf.value)],
        );
        conta("valores_de_campo");
      }
    }
  }
}

// ── 3. Tarefas ───────────────────────────────────────────────────────────
console.log("\n▸ Tarefas");
const { rows: tagsApp } = await db.query(
  `select id, name from tags where organization_id = $1`,
  [ORG_ID],
);
const tagPorNome = new Map(tagsApp.map((t) => [norm(t.name), t.id]));

for (const t of lista(await cw("agent_tasks"))) {
  // Detalhe traz itens e comentários que a listagem às vezes omite.
  let det = t;
  try {
    det = (await cw(`agent_tasks/${t.id}`))?.data ?? t;
  } catch {
    /* usa o que veio da listagem */
  }

  let taskId = null;
  if (!DRY) {
    const a = await db.query(
      `select id from tasks where organization_id=$1 and title=$2 and created_at=$3 limit 1`,
      [ORG_ID, det.title, det.created_at],
    );
    taskId = a.rows[0]?.id ?? null;
  }
  if (taskId) { conta("tarefas_existentes"); continue; }

  const { rows } = await q(
    `insert into tasks
       (organization_id, created_by, assigned_to, title, description, priority, status,
        due_date, due_time, reminder_at, recurrence_type, recurrence_config,
        started_at, completed_at, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     returning id`,
    [
      ORG_ID,
      acharPerfil(det.created_by?.name),
      acharPerfil(det.assigned_to?.name),
      det.title,
      det.description ?? null,
      det.priority ?? "medium",
      det.status ?? "pending",
      det.due_date ?? null,
      det.due_time ?? null,
      det.reminder_at ?? null,
      det.recurrence_type ?? "none",
      JSON.stringify(det.recurrence_config ?? {}),
      det.started_at ?? null,
      det.completed_at ?? null,
      det.created_at ?? new Date().toISOString(),
    ],
  );
  taskId = rows[0]?.id;
  if (!taskId) continue;
  conta("tarefas");

  // `created_at` é NOT NULL nas tabelas filhas e nem todo registro do Chatwoot
  // traz a data; cai para a data da tarefa e, no limite, para agora.
  const quando = (v) => v ?? det.created_at ?? new Date().toISOString();

  for (const it of det.items ?? []) {
    await q(
      `insert into task_items (organization_id, task_id, title, completed, position, created_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [ORG_ID, taskId, it.title, !!it.completed, it.position ?? 0, quando(it.created_at)],
    );
    conta("itens_de_checklist");
  }
  for (const cm of det.comments ?? []) {
    await q(
      `insert into task_comments (organization_id, task_id, profile_id, content, created_at)
       values ($1,$2,$3,$4,$5)`,
      [ORG_ID, taskId, acharPerfil(cm.user?.name ?? cm.author), cm.content ?? "", quando(cm.created_at)],
    );
    conta("comentarios");
  }
  for (const lb of det.labels ?? []) {
    const nome = typeof lb === "string" ? lb : (lb.title ?? lb.name);
    const tagId = tagPorNome.get(norm(nome));
    if (!tagId) continue;
    await q(
      `insert into task_tags (organization_id, task_id, tag_id) values ($1,$2,$3)
       on conflict do nothing`,
      [ORG_ID, taskId, tagId],
    );
    conta("etiquetas_de_tarefa");
  }
}

// ── 4. Contratos ─────────────────────────────────────────────────────────
console.log("\n▸ Contratos");
// PAGINADO: a API devolve 20 por página. Ler só a primeira deixou 12
// contratos para trás — o mesmo erro que escondeu 412 tarefas.
const todosContratos = [];
for (let p = 1; p <= 50; p += 1) {
  const pagina = lista(await cw(`contracts?page=${p}`));
  if (!pagina.length) break;
  todosContratos.push(...pagina);
}
console.log(`  encontrados no Chatwoot: ${todosContratos.length}`);

for (const c of todosContratos) {
  let det = c;
  try {
    det = (await cw(`contracts/${c.id}`))?.data ?? c;
  } catch {
    /* usa o resumo */
  }

  const numero = det.contract_number ?? String(det.id);
  if (!DRY) {
    const a = await db.query(
      `select id from contracts where organization_id=$1 and number=$2 limit 1`,
      [ORG_ID, numero],
    );
    if (a.rows.length) { conta("contratos_existentes"); continue; }
  }

  const fone = normalizePhone(det.contractor_phone ?? det.contact?.phone_number);
  const contatoId = fone ? (contatoPorFone.get(fone) ?? null) : null;

  // O que não tem coluna própria (dados do contratante, sessões, parcelas)
  // é preservado em `variables` — nada do contrato se perde.
  const variables = {
    ...(det.variables ?? {}),
    contractor_name: det.contractor_name,
    contractor_email: det.contractor_email,
    contractor_cpf: det.contractor_cpf,
    contractor_phone: det.contractor_phone,
    plan_name: det.plan_name,
    plan_value: det.plan_value,
    plan_duration: det.plan_duration,
    installments_count: det.installments_count,
    first_installment_value: det.first_installment_value,
    installment_due_day: det.installment_due_day,
    chatwoot_id: det.id,
  };

  const { rows } = await q(
    `insert into contracts
       (organization_id, created_by, contact_id, number, title, content_html, variables,
        status, document_hash, plan_start_date, plan_end_date, sent_at, signed_at,
        expires_at, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     returning id`,
    [
      ORG_ID,
      acharPerfil(det.created_by?.name),
      contatoId,
      numero,
      det.title,
      det.content_html ?? null,
      JSON.stringify(variables),
      det.status ?? "draft",
      det.document_hash ?? null,
      det.plan_start_date ?? null,
      det.plan_end_date ?? null,
      det.sent_at ?? null,
      det.signed_at ?? null,
      det.expires_at ?? null,
      det.created_at ?? new Date().toISOString(),
    ],
  );
  const contratoId = rows[0]?.id;
  if (!contratoId) continue;
  conta("contratos");

  let ordem = 1;
  for (const s of det.signers ?? []) {
    const { rows: sr } = await q(
      `insert into contract_signers
         (organization_id, contract_id, name, email, phone, document, role, sign_token,
          status, sign_order, viewed_at, signed_at, refused_at, refusal_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       returning id`,
      [
        ORG_ID, contratoId, s.name, s.email ?? null, s.phone ?? null, s.document ?? null,
        s.role ?? "contractor", s.sign_token ?? null, s.status ?? "pending", ordem++,
        s.viewed_at ?? null, s.signed_at ?? null, s.refused_at ?? null, s.refusal_reason ?? null,
      ],
    );
    const signerId = sr[0]?.id;
    conta("signatarios");

    // Evidência jurídica — é o que não dá para recriar depois.
    if (signerId && s.signature) {
      await q(
        `insert into contract_signatures
           (organization_id, signer_id, ip_address, user_agent, confirmation_name,
            signature_hash, signed_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          ORG_ID, signerId, s.signature.ip_address ?? null,
          s.signature.user_agent ?? null, s.name ?? null,
          s.signature.signature_hash ?? null, s.signature.signed_at ?? null,
        ],
      );
      conta("assinaturas_com_evidencia");
    }
  }
}

console.log(`\n${DRY ? "SIMULAÇÃO (nada gravado)" : "Importação concluída"}:`);
for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);

await db.end();
