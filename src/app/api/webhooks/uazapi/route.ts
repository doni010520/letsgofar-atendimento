import { NextResponse } from "next/server";
import { parseUazapiWebhook, parseUazapiStatus } from "@/lib/whatsapp/uazapi";
import { persistInbound, persistStatusUpdates } from "@/lib/whatsapp/inbound";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    // DEBUG temporário: registra payloads de mídia para diagnóstico.
    if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.WEBHOOK_DEBUG === "1") {
      const raw = JSON.stringify(payload);
      if (/image|audio|video|document|ptt|sticker|media/i.test(raw)) {
        await createServiceClient().from("webhook_log").insert({ payload }).then(() => {}, () => {});
      }
    }
    const messages = parseUazapiWebhook(payload);
    if (messages.length) await persistInbound(messages);
    const updates = parseUazapiStatus(payload);
    if (updates.length) await persistStatusUpdates(updates);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("uazapi webhook error", e);
    return NextResponse.json({ ok: false }, { status: 200 }); // 200 evita reenvio em loop
  }
}
