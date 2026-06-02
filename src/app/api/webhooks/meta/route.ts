import { NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  parseMetaWebhook,
  parseMetaEchoes,
  parseMetaStateSync,
} from "@/lib/whatsapp/meta";
import { persistInbound } from "@/lib/whatsapp/inbound";
import { persistEchoes, persistContactSync } from "@/lib/whatsapp/coexistence";

// Verificação do webhook (handshake da Meta).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

/** Valida a assinatura X-Hub-Signature-256 (HMAC-SHA256 com o App Secret). */
function validSignature(raw: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return true; // sem secret configurado (dev): não bloqueia
  if (!header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (!validSignature(raw, request.headers.get("x-hub-signature-256"))) {
      return new NextResponse("invalid signature", { status: 401 });
    }
    const payload = JSON.parse(raw);

    // Mensagens recebidas (inbound) + status.
    const inbound = parseMetaWebhook(payload);
    if (inbound.length) await persistInbound(inbound);

    // Coexistência: ecos de mensagens enviadas pelo app WhatsApp Business.
    const echoes = parseMetaEchoes(payload);
    if (echoes.length) await persistEchoes(echoes);

    // Coexistência: sincronização de contatos.
    const contacts = parseMetaStateSync(payload);
    if (contacts.length) await persistContactSync(contacts);

    // TODO(history): importar histórico (~6 meses) do webhook `history` quando
    // o usuário aprova. Estrutura por contato/threads — implementar ao testar com conta real.

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("meta webhook error", e);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
