import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { getProvider } from "@/lib/whatsapp";
import type { Channel } from "@/lib/types";
import { logEvent } from "@/lib/log";

/**
 * Envio de arquivo pela conversa.
 *
 * Vive numa ROTA e não numa server action de propósito: server action tem
 * limite de corpo (1 MB por padrão) e a requisição é recusada pelo próprio
 * Next ANTES de chegar no nosso código — sem erro legível e sem registro.
 * Foi isso que travou o envio de foto da equipe e resistiu a dois ajustes de
 * `bodySizeLimit`. Rota não tem esse limite (testado: 8 MB passam).
 */

export const runtime = "nodejs";
export const maxDuration = 60;

function kindFromMime(mime: string): { kind: "image" | "audio" | "video" | "document"; content: string } {
  if (mime.startsWith("image")) return { kind: "image", content: "image" };
  if (mime.startsWith("audio")) return { kind: "audio", content: "audio" };
  if (mime.startsWith("video")) return { kind: "video", content: "video" };
  return { kind: "document", content: "document" };
}

export async function POST(request: Request) {
  const t0 = Date.now();
  let nomeArquivo = "?";
  let bytes = 0;

  try {
    const session = await getSession();
    if (!session?.organization) {
      return NextResponse.json({ ok: false, error: "Sessão inválida." }, { status: 401 });
    }

    // O arquivo vem como corpo CRU e os dados na URL. Multipart foi tentado
    // antes e quebrava com "Failed to parse body as FormData" — o corpo
    // chegava, mas o parser não reconstruía o arquivo. Sem formulário não há
    // fronteira a interpretar: bytes entram, bytes saem.
    const url = new URL(request.url);
    const conversationId = String(url.searchParams.get("conversationId") || "");
    const caption = String(url.searchParams.get("caption") || "").trim();
    const override = String(url.searchParams.get("kind") || "");
    nomeArquivo = String(url.searchParams.get("nome") || "arquivo");
    const mime = request.headers.get("content-type") || "application/octet-stream";

    // Lê por fluxo e CONFERE o tamanho. `arrayBuffer()` resolvia com o corpo
    // pela metade quando a conexão engasgava: o mesmo PDF chegou três vezes
    // com tamanhos diferentes (10.465.715 / 10.469.318 / 10.465.947) e o
    // arquivo ia truncado para o cliente, que não conseguia abrir.
    const esperado = Number(request.headers.get("content-length") || 0);
    const partes: Uint8Array[] = [];
    let lidos = 0;
    if (request.body) {
      const reader = request.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) { partes.push(value); lidos += value.length; }
      }
    }
    const buf = Buffer.concat(partes);
    bytes = buf.length;

    if (!conversationId || !bytes) {
      return NextResponse.json({ ok: false, error: "Arquivo ou conversa ausente." }, { status: 400 });
    }
    if (esperado && bytes !== esperado) {
      const msg = `Transferência incompleta: recebi ${bytes} de ${esperado} bytes.`;
      void logEvent("error", "midia", msg,
        { arquivo: nomeArquivo, esperado, recebido: bytes, conversationId }, session.organization.id);
      // Falhar aqui é melhor que entregar um arquivo que não abre.
      return NextResponse.json({ ok: false, error: `${msg} Tente enviar de novo.` }, { status: 400 });
    }
    const file = { name: nomeArquivo, type: mime, size: bytes };

    const supabase = await createClient();
    const { data: conv } = await supabase
      .from("conversation_overview")
      .select("contact_phone, channel_id, status, is_group, contact_jid")
      .eq("id", conversationId)
      .single();
    if (!conv) {
      return NextResponse.json({ ok: false, error: "Conversa não encontrada." }, { status: 404 });
    }

    const { kind, content } =
      override === "sticker"
        ? ({ kind: "sticker", content: "sticker" } as const)
        : kindFromMime(file.type || "");

    const svc = createServiceClient();
    const ext = (file.name?.split(".").pop() || (file.type.split("/")[1] ?? "bin")).slice(0, 5);
    const caminho = `${session.organization.id}/out/${conversationId}-${Date.now()}.${ext}`;

    const up = await svc.storage
      .from("media")
      .upload(caminho, buf, { contentType: file.type || "application/octet-stream", upsert: true });
    if (up.error) {
      void logEvent("error", "midia", `Falha no upload: ${up.error.message}`,
        { arquivo: nomeArquivo, bytes, conversationId }, session.organization.id);
      return NextResponse.json({ ok: false, error: "Falha ao subir o arquivo." }, { status: 500 });
    }
    const publicUrl = svc.storage.from("media").getPublicUrl(caminho).data.publicUrl;

    const { data: msg } = await supabase
      .from("messages")
      .insert({
        organization_id: session.organization.id,
        conversation_id: conversationId,
        direction: "out",
        sender_type: "agent",
        sender_id: session.userId,
        content_type: content,
        body: caption || null,
        media_url: publicUrl,
        status: "pending",
      })
      .select("id")
      .single();

    const { data: channel } = await supabase
      .from("channels").select("*").eq("id", conv.channel_id).single();
    const to = conv.is_group
      ? (conv.contact_jid || `${conv.contact_phone}@g.us`)
      : conv.contact_phone;

    try {
      const res = await getProvider(channel as Channel).sendMedia({
        to, url: publicUrl, caption, kind: kind as "image" | "audio" | "video" | "document",
      });
      await supabase
        .from("messages")
        .update({ status: "sent", external_id: res.externalId ?? null })
        .eq("id", msg!.id);

      void logEvent("info", "midia",
        `Enviado ${kind}: ${nomeArquivo} (${(bytes / 1024 / 1024).toFixed(2)} MB) em ${Date.now() - t0}ms`,
        { arquivo: nomeArquivo, bytes, conversationId, recibo: res.externalId ?? null },
        session.organization.id);

      await supabase
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          status: conv.status === "closed" ? "open" : conv.status,
        })
        .eq("id", conversationId);

      return NextResponse.json({ ok: true, externalId: res.externalId ?? null });
    } catch (e) {
      await supabase.from("messages").update({ status: "failed" }).eq("id", msg!.id);
      const erro = e instanceof Error ? e.message : String(e);
      void logEvent("error", "midia", `Provedor recusou ${kind}: ${erro}`,
        { arquivo: nomeArquivo, bytes, conversationId }, session.organization.id);
      return NextResponse.json({ ok: false, error: `Não foi entregue: ${erro}` }, { status: 502 });
    }
  } catch (e) {
    const erro = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    void logEvent("error", "midia", `Envio abortado: ${erro}`, { arquivo: nomeArquivo, bytes });
    return NextResponse.json({ ok: false, error: erro }, { status: 500 });
  }
}
