import type { Channel } from "@/lib/types";
import type {
  ChannelProvider,
  ConnectResult,
  SendMediaParams,
  SendTextParams,
  InboundMessage,
} from "./types";

// Cliente UAZAPI. Os caminhos seguem o padrão da uazapi.com; confirme contra a
// sua instância/documentação se a versão divergir (são facilmente ajustáveis aqui).
interface UazapiCreds {
  token?: string; // token da instância
}

export class UazapiProvider implements ChannelProvider {
  private host: string;
  private token?: string;
  private channel: Channel;

  constructor(channel: Channel) {
    this.channel = channel;
    this.host = (process.env.UAZAPI_HOST || "").replace(/\/$/, "");
    this.token = (channel.credentials as UazapiCreds)?.token;
  }

  private async req(path: string, init: RequestInit = {}, useAdmin = false) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string>),
    };
    if (useAdmin) headers["admintoken"] = process.env.UAZAPI_ADMIN_TOKEN || "";
    else if (this.token) headers["token"] = this.token;

    const res = await fetch(`${this.host}${path}`, { ...init, headers });
    if (!res.ok) throw new Error(`UAZAPI ${path} -> ${res.status}`);
    return res.json();
  }

  /** Cria a instância (se necessário) e retorna o QR Code para parear. */
  async connect(): Promise<ConnectResult> {
    if (!this.token) {
      const created = await this.req(
        "/instance/init",
        { method: "POST", body: JSON.stringify({ name: this.channel.name }) },
        true,
      );
      this.token = created?.token ?? created?.instance?.token;
    }
    // Configura o webhook da instância para apontar para o nosso app (best-effort;
    // ajuste o path conforme a versão da sua UAZAPI se necessário).
    await this.setWebhook().catch((e) => console.warn("uazapi setWebhook", e?.message));

    const conn = await this.req("/instance/connect", { method: "POST", body: "{}" });
    return {
      status: conn?.connected ? "connected" : "connecting",
      qrCode: conn?.qrcode ?? conn?.qrCode ?? conn?.instance?.qrcode,
      externalId: this.token,
    };
  }

  /** Aponta o webhook da instância para /api/webhooks/uazapi. */
  private async setWebhook() {
    const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
    if (!base || !this.token) return;
    await this.req("/webhook", {
      method: "POST",
      body: JSON.stringify({
        enabled: true,
        url: `${base}/api/webhooks/uazapi`,
        events: ["messages", "messages_update", "connection"],
        excludeMessages: ["wasSentByApi"],
      }),
    });
  }

  async status(): Promise<Channel["status"]> {
    const s = await this.req("/instance/status");
    if (s?.connected || s?.status === "connected") return "connected";
    if (s?.status === "connecting") return "connecting";
    return "disconnected";
  }

  async sendText({ to, text }: SendTextParams) {
    const r = await this.req("/send/text", {
      method: "POST",
      body: JSON.stringify({ number: to, text }),
    });
    return { externalId: r?.id ?? r?.messageId };
  }

  async sendMedia({ to, url, caption, kind }: SendMediaParams) {
    const r = await this.req("/send/media", {
      method: "POST",
      body: JSON.stringify({ number: to, type: kind, file: url, text: caption }),
    });
    return { externalId: r?.id ?? r?.messageId };
  }

  /**
   * Retorna a URL da foto de perfil do contato.
   * Endpoint do uazapiGO: POST /chat/GetNameAndImageURL { number, preview }.
   * Confirme o path/campos no swagger (/docs) da sua instância — variam por versão.
   * Tenta também /chat/getProfileImage como fallback.
   */
  async getProfilePicture(phone: string): Promise<string | null> {
    const tryParse = (r: unknown): string | null => {
      const o = (r ?? {}) as Record<string, unknown>;
      return (
        (o.imgUrl as string) ?? (o.imageUrl as string) ?? (o.image as string) ??
        (o.url as string) ?? (o.profilePicUrl as string) ?? (o.eurl as string) ?? null
      );
    };
    try {
      const r = await this.req("/chat/GetNameAndImageURL", {
        method: "POST",
        body: JSON.stringify({ number: phone, preview: false }),
      });
      const url = tryParse(r);
      if (url) return url;
    } catch { /* tenta fallback */ }
    try {
      const r = await this.req("/chat/getProfileImage", {
        method: "POST",
        body: JSON.stringify({ number: phone }),
      });
      return tryParse(r);
    } catch {
      return null;
    }
  }
}

/** Normaliza o payload de webhook da UAZAPI em mensagens internas. */
export function parseUazapiWebhook(payload: any): InboundMessage[] {
  const msgs = payload?.messages ?? (payload?.message ? [payload.message] : []);
  return (Array.isArray(msgs) ? msgs : [])
    .filter((m: any) => !m?.fromMe)
    .map((m: any) => ({
      channelExternalId: payload?.token ?? payload?.instance ?? "",
      from: String(m?.sender ?? m?.from ?? "").replace(/\D/g, ""),
      contactName: m?.senderName ?? m?.pushName,
      contentType: mapType(m?.type ?? m?.messageType),
      body: m?.text ?? m?.body ?? m?.caption,
      mediaUrl: m?.file ?? m?.mediaUrl,
      externalId: m?.id ?? m?.messageId,
      timestamp: m?.timestamp ? String(m.timestamp) : undefined,
    }));
}

function mapType(t?: string): InboundMessage["contentType"] {
  switch ((t || "").toLowerCase()) {
    case "image":
      return "image";
    case "audio":
    case "ptt":
      return "audio";
    case "video":
      return "video";
    case "document":
      return "document";
    case "sticker":
      return "sticker";
    case "location":
      return "location";
    default:
      return "text";
  }
}
