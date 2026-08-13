/**
 * Jobs migrados do Chatwoot.
 *
 *  1. Disparos    — envia UMA mensagem por vez e se reagenda (pacing anti-bloqueio).
 *  2. Agendadas   — envia mensagens marcadas para uma data/hora.
 *  3. Vigia       — marca como falha o que saiu mas não foi entregue.
 *  4. Recorrência — recria a próxima ocorrência de tarefas recorrentes.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { getProvider } from "@/lib/whatsapp";
import type { Channel } from "@/lib/types";
import {
  personalize,
  randomInterval,
  isWithinWindow,
  secondsUntilWindow,
  phoneVariants,
  normalizePhone,
} from "@/lib/broadcast";
import { runHousekeeping } from "@/lib/housekeeping";
import { logEvent } from "@/lib/log";

type Db = ReturnType<typeof createServiceClient>;

/** Mensagem de saída não entregue após este tempo = falha. */
const DELIVERY_GRACE_MS = 10 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────
// 1. Disparos
// ─────────────────────────────────────────────────────────────────────

async function resolveContact(
  db: Db,
  org: string,
  phone: string,
  name?: string | null,
): Promise<string | null> {
  // Procura pelas variantes do 9º dígito ANTES de criar — duplicar contato
  // foi o que quebrou entregas no Chatwoot.
  const variants = phoneVariants(phone);
  const { data: found } = await db
    .from("contacts")
    .select("id")
    .eq("organization_id", org)
    .in("phone", variants)
    .limit(1)
    .maybeSingle();
  if (found?.id) return found.id;

  // Sem isto, um número digitado sem o "55" (planilha de disparo, agendamento
  // pra alguém que ainda não é contato) criava um contato novo já quebrado —
  // toda mensagem pra essa pessoa falhava, sempre, sem ninguém perceber
  // (caso real: 15 contatos assim achados numa varredura).
  const phoneNormalizado = normalizePhone(phone) ?? phone;
  const { data: created } = await db
    .from("contacts")
    .insert({ organization_id: org, phone: phoneNormalizado, name: name || phoneNormalizado })
    .select("id")
    .single();
  return created?.id ?? null;
}

async function ensureConversation(
  db: Db,
  org: string,
  channelId: string | null,
  contactId: string,
  assignedTo: string | null,
): Promise<string | null> {
  const { data: existing } = await db
    .from("conversations")
    .select("id")
    .eq("organization_id", org)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    // Reabre e atribui: conversa resolvida não aparece na lista do atendente.
    await db
      .from("conversations")
      .update({
        status: "open",
        ...(assignedTo ? { assigned_user_id: assignedTo } : {}),
        last_message_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data: created } = await db
    .from("conversations")
    .insert({
      organization_id: org,
      channel_id: channelId,
      contact_id: contactId,
      status: "open",
      ...(assignedTo ? { assigned_user_id: assignedTo } : {}),
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  return created?.id ?? null;
}

export async function runBroadcasts(db: Db): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data: broadcasts } = await db
    .from("broadcasts")
    .select("*")
    .eq("status", "running")
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
    .limit(20);

  let sent = 0;

  for (const b of broadcasts ?? []) {
    const now = new Date();

    // Fora da janela → reagenda para a abertura.
    if (!isWithinWindow(now, b.window_start, b.window_end, b.timezone)) {
      const wait = secondsUntilWindow(now, b.window_start, b.timezone);
      await db
        .from("broadcasts")
        .update({ next_run_at: new Date(now.getTime() + wait * 1000).toISOString() })
        .eq("id", b.id);
      continue;
    }

    // Teto diário atingido → tenta de novo amanhã na abertura da janela.
    const today = now.toISOString().slice(0, 10);
    if (b.sent_today_on === today && b.sent_today >= b.daily_cap) {
      const wait = secondsUntilWindow(now, b.window_start, b.timezone) + 86_400;
      await db
        .from("broadcasts")
        .update({ next_run_at: new Date(now.getTime() + wait * 1000).toISOString() })
        .eq("id", b.id);
      continue;
    }

    const { data: recipient } = await db
      .from("broadcast_recipients")
      .select("*")
      .eq("broadcast_id", b.id)
      .eq("status", "pending")
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!recipient) {
      await db
        .from("broadcasts")
        .update({ status: "completed", completed_at: now.toISOString(), next_run_at: null })
        .eq("id", b.id);
      continue;
    }

    const text = personalize(b.message_template, recipient);

    try {
      const { data: channel } = await db
        .from("channels")
        .select("*")
        .eq("id", b.channel_id)
        .maybeSingle();
      if (!channel) throw new Error("Canal não configurado");

      const res = await getProvider(channel as Channel).sendText({
        to: recipient.phone,
        text,
      });
      const externalId = res?.externalId ?? null;

      const contactId =
        recipient.contact_id ??
        (await resolveContact(db, b.organization_id, recipient.phone, recipient.name));
      const conversationId = contactId
        ? await ensureConversation(db, b.organization_id, b.channel_id, contactId, b.assigned_to)
        : null;

      if (conversationId) {
        await db.from("messages").insert({
          organization_id: b.organization_id,
          conversation_id: conversationId,
          direction: "out",
          sender_type: "agent",
          sender_id: b.assigned_to ?? b.created_by,
          content_type: "text",
          body: text,
          status: externalId ? "sent" : "failed",
          external_id: externalId,
        });
      }

      await db
        .from("broadcast_recipients")
        .update({
          status: externalId ? "sent" : "failed",
          personalized_message: text,
          contact_id: contactId,
          conversation_id: conversationId,
          external_id: externalId,
          error: externalId ? null : "Provedor não confirmou a entrega",
          sent_at: now.toISOString(),
        })
        .eq("id", recipient.id);

      sent += 1;
    } catch (err) {
      await db
        .from("broadcast_recipients")
        .update({
          status: "failed",
          error: err instanceof Error ? err.message.slice(0, 500) : "Falha no envio",
          sent_at: now.toISOString(),
        })
        .eq("id", recipient.id);
    }

    // Contadores + próximo horário (intervalo aleatório).
    const { count: sentCount } = await db
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", b.id)
      .eq("status", "sent");
    const { count: failedCount } = await db
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", b.id)
      .eq("status", "failed");

    const wait = randomInterval(b.min_interval, b.max_interval);
    await db
      .from("broadcasts")
      .update({
        sent_count: sentCount ?? 0,
        failed_count: failedCount ?? 0,
        sent_today: b.sent_today_on === today ? b.sent_today + 1 : 1,
        sent_today_on: today,
        next_run_at: new Date(now.getTime() + wait * 1000).toISOString(),
      })
      .eq("id", b.id);
  }

  return sent;
}

// ─────────────────────────────────────────────────────────────────────
// 2. Mensagens agendadas
// ─────────────────────────────────────────────────────────────────────

export async function runScheduledMessages(db: Db): Promise<number> {
  const now = new Date();
  const { data: due } = await db
    .from("scheduled_messages")
    .select("*, conversations(id, contact_id, channel_id)")
    .eq("status", "pending")
    .lte("scheduled_at", now.toISOString())
    .limit(50);

  let sent = 0;

  for (const m of due ?? []) {
    try {
      const conv = m.conversations as { channel_id: string; contact_id: string } | null;
      const { data: contact } = await db
        .from("contacts")
        .select("phone")
        .eq("id", conv?.contact_id ?? "")
        .maybeSingle();
      const { data: channel } = await db
        .from("channels")
        .select("*")
        .eq("id", conv?.channel_id ?? "")
        .maybeSingle();
      if (!contact?.phone || !channel) throw new Error("Conversa sem canal ou contato");

      const res = await getProvider(channel as Channel).sendText({
        to: contact.phone,
        text: m.content,
      });
      const externalId = res?.externalId ?? null;

      await db.from("messages").insert({
        organization_id: m.organization_id,
        conversation_id: m.conversation_id,
        direction: "out",
        sender_type: "agent",
        sender_id: m.created_by,
        content_type: "text",
        body: m.content,
        status: externalId ? "sent" : "failed",
        external_id: externalId,
      });

      await db
        .from("scheduled_messages")
        .update({
          status: externalId ? "sent" : "failed",
          error: externalId ? null : "Provedor não confirmou a entrega",
          sent_at: now.toISOString(),
        })
        .eq("id", m.id);

      if (externalId) sent += 1;
    } catch (err) {
      await db
        .from("scheduled_messages")
        .update({
          status: "failed",
          error: err instanceof Error ? err.message.slice(0, 500) : "Falha no envio",
        })
        .eq("id", m.id);
    }
  }

  return sent;
}

// ─────────────────────────────────────────────────────────────────────
// 3. Vigia de entregas
// ─────────────────────────────────────────────────────────────────────

/**
 * Mensagem de saída sem id do provedor depois da carência não foi entregue.
 * Marca como falha para o atendente VER na conversa (nada de falso sucesso).
 */
export async function runDeliveryWatchdog(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - DELIVERY_GRACE_MS).toISOString();
  const floor = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: stuck } = await db
    .from("messages")
    .select("id")
    .eq("direction", "out")
    .eq("status", "sent")
    .is("external_id", null)
    .lte("created_at", cutoff)
    .gte("created_at", floor)
    .limit(200);

  if (!stuck?.length) return 0;

  await db
    .from("messages")
    .update({ status: "failed", delivery_checked_at: new Date().toISOString() })
    .in("id", stuck.map((m: { id: string }) => m.id));

  return stuck.length;
}

// ─────────────────────────────────────────────────────────────────────
// 4. Tarefas recorrentes
// ─────────────────────────────────────────────────────────────────────

function nextDueDate(due: string, type: string, config: Record<string, unknown>): string | null {
  const d = new Date(`${due}T12:00:00Z`);
  if (type === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (type === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (type === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (type === "custom") {
    const days = (config.days as number[]) ?? [];
    if (!days.length) return null;
    for (let i = 1; i <= 30; i += 1) {
      const c = new Date(d.getTime() + i * 86_400_000);
      if (days.includes(c.getUTCDay())) return c.toISOString().slice(0, 10);
    }
    return null;
  } else return null;
  return d.toISOString().slice(0, 10);
}

/** Cria a próxima ocorrência de tarefas recorrentes concluídas. */
export async function runRecurringTasks(db: Db): Promise<number> {
  const { data: done } = await db
    .from("tasks")
    .select("*")
    .eq("status", "completed")
    .neq("recurrence_type", "none")
    .not("due_date", "is", null)
    .gte("completed_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(100);

  let created = 0;

  for (const t of done ?? []) {
    const next = nextDueDate(t.due_date, t.recurrence_type, t.recurrence_config ?? {});
    if (!next) continue;

    // Não duplica se a próxima ocorrência já existe.
    const { data: exists } = await db
      .from("tasks")
      .select("id")
      .eq("organization_id", t.organization_id)
      .eq("title", t.title)
      .eq("due_date", next)
      .in("status", ["pending", "in_progress"])
      .limit(1)
      .maybeSingle();
    if (exists) continue;

    await db.from("tasks").insert({
      organization_id: t.organization_id,
      created_by: t.created_by,
      assigned_to: t.assigned_to,
      contact_id: t.contact_id,
      conversation_id: t.conversation_id,
      pipeline_id: t.pipeline_id,
      title: t.title,
      description: t.description,
      priority: t.priority,
      status: "pending",
      due_date: next,
      due_time: t.due_time,
      recurrence_type: t.recurrence_type,
      recurrence_config: t.recurrence_config,
    });
    created += 1;
  }

  return created;
}


// ─────────────────────────────────────────────────────────────────────
// 5. Lembretes de tarefa
// ─────────────────────────────────────────────────────────────────────

/**
 * Marca as tarefas que precisam de atenção:
 *  - chegou a hora do lembrete configurado;
 *  - venceu e ninguém concluiu.
 * A marcação viaja pelo realtime até a tela de quem é responsável.
 */
export async function runTaskReminders(db: Db): Promise<number> {
  const agora = new Date();
  const hoje = agora.toISOString().slice(0, 10);
  let marcadas = 0;

  const { data: comLembrete } = await db
    .from("tasks")
    .select("id")
    .lte("reminder_at", agora.toISOString())
    .is("reminder_sent_at", null)
    .in("status", ["pending", "in_progress"])
    .limit(200);

  if (comLembrete?.length) {
    await db
      .from("tasks")
      .update({ reminder_sent_at: agora.toISOString() })
      .in("id", comLembrete.map((t: { id: string }) => t.id));
    marcadas += comLembrete.length;
  }

  const { data: vencidas } = await db
    .from("tasks")
    .select("id")
    .lt("due_date", hoje)
    .is("overdue_notified_at", null)
    .in("status", ["pending", "in_progress"])
    .limit(200);

  if (vencidas?.length) {
    await db
      .from("tasks")
      .update({ overdue_notified_at: agora.toISOString() })
      .in("id", vencidas.map((t: { id: string }) => t.id));
    marcadas += vencidas.length;
  }

  return marcadas;
}

/** Roda todos os jobs migrados do Chatwoot. */
export async function runMigratedJobs() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { broadcasts: 0, scheduled: 0, undelivered: 0, recurring: 0 };
  }
  const db = createServiceClient();
  return {
    broadcasts: await runBroadcasts(db),
    scheduled: await runScheduledMessages(db),
    undelivered: await runDeliveryWatchdog(db),
    recurring: await runRecurringTasks(db),
    reminders: await runTaskReminders(db),
    watchdog: await runInboundWatchdog(db),
    housekeeping: await runHousekeeping(),
  };
}

// ─────────────────────────────────────────────────────────────────────
// 7. Vigia de entrada — o alarme que faltava
//
// Em 05/08 o webhook da UAZAPI ficou apontando para um host morto por 1h35 e
// NINGUÉM percebeu: mensagens enviadas continuavam aparecendo (o app grava
// as suas na hora), então a tela parecia normal enquanto nada entrava.
//
// Este job vigia o silêncio: se passar tempo demais em horário comercial sem
// nenhuma mensagem recebida, avisa no WhatsApp de quem administra. Alerta no
// próprio sistema não serve — se a entrada morreu, é do sistema que se
// desconfia.
// ─────────────────────────────────────────────────────────────────────

/** Minutos de silêncio que disparam o alerta. */
const SILENCIO_MIN = Number(process.env.WATCHDOG_SILENCE_MIN ?? 45);
/** Só vigia neste intervalo (hora local de Brasília), seg–sáb. */
const HORA_INICIO = Number(process.env.WATCHDOG_START_HOUR ?? 8);
const HORA_FIM = Number(process.env.WATCHDOG_END_HOUR ?? 20);
/** Não repete o alerta antes disso, para não virar spam. */
const REPETIR_APOS_MIN = 60;

function dentroDoExpediente(agora: Date): boolean {
  // -3h = Brasília. O servidor roda em UTC.
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const dia = brasilia.getUTCDay(); // 0 = domingo
  const hora = brasilia.getUTCHours();
  return dia >= 1 && dia <= 6 && hora >= HORA_INICIO && hora < HORA_FIM;
}

/**
 * Avisa quando a entrada de mensagens fica muda em horário comercial.
 * Devolve 1 se alertou.
 */
export async function runInboundWatchdog(db: Db): Promise<number> {
  const agora = new Date();
  if (!dentroDoExpediente(agora)) return 0;

  const { data: orgs } = await db.from("organizations").select("id, settings");
  let alertas = 0;

  for (const org of orgs ?? []) {
    const destino = String(
      ((org.settings ?? {}) as Record<string, unknown>).watchdog_phone ?? "",
    ).replace(/\D/g, "");
    if (!destino) continue; // sem número configurado, não há a quem avisar

    const { data: ultima } = await db
      .from("messages")
      .select("created_at")
      .eq("organization_id", org.id)
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const desde = ultima?.created_at ? new Date(ultima.created_at) : null;
    const minutos = desde ? (agora.getTime() - desde.getTime()) / 60000 : Infinity;
    if (minutos < SILENCIO_MIN) continue;

    // Já avisei há pouco? Evita repetir a cada volta do cron.
    const { data: recente } = await db
      .from("app_logs")
      .select("created_at")
      .eq("organization_id", org.id)
      .eq("source", "vigia")
      .gte("created_at", new Date(agora.getTime() - REPETIR_APOS_MIN * 60000).toISOString())
      .limit(1);
    if (recente?.length) continue;

    const { data: canal } = await db
      .from("channels")
      .select("*")
      .eq("organization_id", org.id)
      .limit(1)
      .maybeSingle();
    if (!canal) continue;

    // Se a instância caiu, o motivo já vai no aviso — poupa investigação.
    let estado = "desconhecido";
    try {
      estado = await getProvider(canal as Channel).status();
    } catch {
      estado = "sem resposta";
    }

    const texto =
      `⚠️ *Nenhuma mensagem recebida há ${Math.round(minutos)} minutos.*\n\n` +
      `Conexão do WhatsApp: *${estado}*.\n\n` +
      `Pode ser silêncio normal, mas já houve falha em que o sistema parecia ` +
      `funcionando e nada entrava. Vale mandar uma mensagem de teste para o ` +
      `número da escola e conferir se ela aparece no atendimento.`;

    try {
      await getProvider(canal as Channel).sendText({ to: destino, text: texto });
      alertas += 1;
    } catch {
      /* se nem o aviso sai, o log abaixo ainda registra */
    }

    await logEvent(
      "warn",
      "vigia",
      `Entrada muda há ${Math.round(minutos)} min (conexão: ${estado})`,
      { minutos: Math.round(minutos), estado, ultima: ultima?.created_at ?? null },
      org.id,
    );
  }

  return alertas;
}
