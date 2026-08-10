import { NextResponse } from "next/server";
import { parseUazapiWebhook, parseUazapiStatus } from "@/lib/whatsapp/uazapi";
import { persistInbound, persistStatusUpdates } from "@/lib/whatsapp/inbound";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { logEvent } from "@/lib/log";

export async function POST(request: Request) {
  // Rate limit: 300 req/min por IP (uazapi envia múltiplos eventos em rajadas).
  const rl = rateLimit(`uazapi:${getClientIp(request)}`, 300, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too Many Requests" }, {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
    });
  }

  // Verifica token compartilhado (configurado no painel uazapi e em UAZAPI_WEBHOOK_TOKEN).
  const webhookToken = process.env.UAZAPI_WEBHOOK_TOKEN;
  if (webhookToken) {
    const incoming =
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      request.headers.get("x-webhook-token") ??
      new URL(request.url).searchParams.get("token");
    if (incoming !== webhookToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let payload: unknown = null;
  try {
    payload = await request.json();
    const messages = parseUazapiWebhook(payload);
    if (messages.length) await persistInbound(messages);
    const updates = parseUazapiStatus(payload);
    if (updates.length) await persistStatusUpdates(updates);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Foi ISTO que escondeu o bug do Matheus por dias: o erro real ia só para
    // `console.error`, que não chega no app_logs — o log que eu de fato
    // acompanho. Mensagem inteira sumia sem NENHUM rastro visível, e a uazapi
    // nunca reenviava porque o 200 abaixo diz "entreguei com sucesso".
    // Continua devolvendo 200 de propósito (não queremos loop de reenvio),
    // mas agora o erro fica registrado — a próxima falha destas aparece no
    // log em vez de exigir replay manual do payload para achar a causa.
    const raw = payload as { message?: { chatid?: string; id?: string; text?: string } } | null;
    console.error("uazapi webhook error", e);
    void logEvent("error", "webhook_uazapi", `Falha ao processar webhook: ${(e as Error)?.message ?? e}`, {
      chatid: raw?.message?.chatid,
      messageId: raw?.message?.id,
      texto: raw?.message?.text?.slice(0, 100),
    });
    return NextResponse.json({ ok: false }, { status: 200 }); // 200 evita reenvio em loop
  }
}
