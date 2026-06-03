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

  /** Cria a instância (se necessário) e retorna QR Code ou código de pareamento. */
  async connect(phone?: string): Promise<ConnectResult> {
    if (!this.token) {
      const created = await this.req(
        "/instance/init",
        { method: "POST", body: JSON.stringify({ name: this.channel.name }) },
        true,
      );
      this.token = created?.token ?? created?.instance?.token;
    }
    // Configura o webhook da instância para apontar para o nosso app (best-effort).
    await this.setWebhook().catch((e) => console.warn("uazapi setWebhook", e?.message));

    const digits = (phone || "").replace(/\D/g, "");
    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
    const read = (o: any) => {
      const i = o?.instance ?? o ?? {};
      return {
        connected: !!(i.connected || i.status === "connected" || o?.loggedIn),
        qr: i.qrcode ?? i.qrCode,
        code: i.paircode ?? i.pairCode ?? i.code,
      };
    };
    const body = digits ? JSON.stringify({ phone: digits }) : "{}";
    const statusOf = (o: any) => (o?.instance ?? o ?? {})?.status;
    const dbg: string[] = [];

    // A UAZAPI só emite código/QR a partir de um estado LIMPO. Cada tentativa:
    // desconecta → confirma "disconnected" → aguarda → connect. Repete até obter o código/QR.
    let r = { connected: false, qr: undefined as string | undefined, code: undefined as string | undefined };
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.req("/instance/disconnect", { method: "POST", body: "{}" }).catch(() => {});
      // Confirma que desconectou de fato antes de reconectar.
      let st = "";
      for (let j = 0; j < 6; j++) {
        await sleep(700);
        const s = await this.req("/instance/status").catch(() => null);
        st = statusOf(s) ?? "";
        if (st === "disconnected" || st === "" ) break;
      }
      await sleep(1500); // folga para o socket fechar totalmente

      const conn = await this.req("/instance/connect", { method: "POST", body }).catch((e) => {
        dbg.push(`a${attempt}:connErr=${(e as Error)?.message?.slice(0, 40)}`);
        return null;
      });
      if (conn) r = read(conn);
      dbg.push(`a${attempt}:st=${st}->${statusOf(conn) ?? "?"} code=${r.code ? 1 : 0} qr=${r.qr ? 1 : 0}`);

      // Modo QR: o QR pode vir alguns segundos depois — consulta o status.
      if (!digits) {
        for (let i = 0; i < 6 && !r.connected && !r.qr; i++) {
          await sleep(1500);
          const s = await this.req("/instance/status").catch(() => null);
          if (s) r = read(s);
        }
      }

      if (r.connected || (digits ? r.code : r.qr)) break;
    }

    return {
      status: r.connected ? "connected" : "connecting",
      qrCode: r.qr || undefined,
      pairCode: r.code || undefined,
      externalId: this.token,
      debug: dbg.join(" | "),
    };
  }

  /** Desconecta a instância (sem apagá-la). */
  async disconnect(): Promise<void> {
    if (!this.token) return;
    await this.req("/instance/disconnect", { method: "POST", body: "{}" }).catch(() => {});
  }

  /** Apaga a instância na UAZAPI (DELETE /instance, com token). */
  async deleteInstance(): Promise<void> {
    if (!this.token) return;
    await this.req("/instance", { method: "DELETE" }).catch(() => {});
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
