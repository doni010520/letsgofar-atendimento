import { NextResponse } from "next/server";
import { parseUazapiWebhook, parseUazapiStatus } from "@/lib/whatsapp/uazapi";
import { persistInbound, persistStatusUpdates } from "@/lib/whatsapp/inbound";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
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
