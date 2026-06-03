import { NextResponse } from "next/server";
import { parseUazapiWebhook, parseUazapiStatus } from "@/lib/whatsapp/uazapi";
import { persistInbound, persistStatusUpdates } from "@/lib/whatsapp/inbound";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    // DEBUG temporário: registra eventos de status e mensagens de mídia para diagnóstico.
    if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.WEBHOOK_DEBUG === "1") {
      const ev = String(payload?.EventType ?? payload?.event ?? "").toLowerCase();
      const m = payload?.message;
      const isMedia = !!m && (!!m.mediaType || !!m?.content?.URL || /image|audio|video|document|sticker|ptt/i.test(String(m.messageType ?? "")));
      const isReact = !!m && (!!m.reaction || /reaction/i.test(String(m.messageType ?? m.type ?? "")));
      const isGroupMsg = !!m && (m.isGroup === true || /@g\.us/.test(String(m.chatid ?? "")));
      if (ev !== "messages" || isMedia || isReact || isGroupMsg) {
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
