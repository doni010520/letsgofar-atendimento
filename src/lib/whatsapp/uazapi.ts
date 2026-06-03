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
    const dbg: string[] = [`mode=${digits ? "code(" + digits.length + "d)" : "qr"}`];

    // A UAZAPI só emite código/QR a partir de um estado LIMPO. Cada tentativa:
    // desconecta → confirma "disconnected" → aguarda → connect. Repete até obter o código/QR.
    let r = { connected: false, qr: undefined as string | undefined, code: undefined as string | undefined };
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.req("/instance/disconnect", { method: "POST", body: "{}" }).catch(() => {});
      // Confirma que desconectou de fato antes de reconectar (quebra no 1º status limpo).
      for (let j = 0; j < 4; j++) {
        await sleep(500);
        const s = await this.req("/instance/status").catch(() => null);
        const st = statusOf(s) ?? "";
        if (st === "disconnected" || st === "") break;
      }
      await sleep(800); // folga para o socket fechar

      const conn = await this.req("/instance/connect", { method: "POST", body }).catch((e) => {
        dbg.push(`connect#${attempt}:ERR ${e?.message}`);
        return null;
      });
      if (conn) {
        r = read(conn);
        dbg.push(`connect#${attempt}:st=${statusOf(conn)} code=${r.code ? "Y" : "n"} qr=${r.qr ? "Y" : "n"}`);
      }

      // O código/QR pode vir 1-2s depois — consulta o status até aparecer.
      for (let i = 0; i < 4 && !r.connected && !(digits ? r.code : r.qr); i++) {
        await sleep(1200);
        const s = await this.req("/instance/status").catch(() => null);
        if (s) {
          r = read(s);
          dbg.push(`poll#${attempt}.${i}:st=${statusOf(s)} code=${r.code ? "Y" : "n"} qr=${r.qr ? "Y" : "n"}`);
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
    const o = await this.req("/instance/status");
    const i = (o?.instance ?? o ?? {}) as { status?: string; connected?: boolean };
    if (o?.connected || i.connected || i.status === "connected") return "connected";
    if (i.status === "connecting") return "connecting";
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

  /**
   * Nome + imagem de um chat (contato ou grupo). Para grupos passe o JID
   * completo (`<id>@g.us`). Best-effort: retorna o que conseguir.
   */
  async getChatInfo(jid: string): Promise<{ name?: string; image?: string }> {
    try {
      const r = (await this.req("/chat/GetNameAndImageURL", {
        method: "POST",
        body: JSON.stringify({ number: jid, preview: false }),
      })) as Record<string, unknown>;
      const name =
        (r.name as string) ?? (r.Name as string) ?? (r.subject as string) ??
        (r.verifiedName as string) ?? (r.pushName as string) ?? undefined;
      const image =
        (r.imgUrl as string) ?? (r.imageUrl as string) ?? (r.image as string) ??
        (r.url as string) ?? (r.profilePicUrl as string) ?? (r.eurl as string) ?? undefined;
      return { name: name || undefined, image: image || undefined };
    } catch {
      return {};
    }
  }
}

/** Detecta se a mensagem veio de um GRUPO (chatid @g.us ou flag isGroup). */
function isGroupMessage(m: any): boolean {
  if (m?.isGroup === true) return true;
  const jid = String(
    m?.chatid ?? m?.chat ?? m?.remoteJid ?? m?.key?.remoteJid ?? m?.content?.key?.remoteJID ?? m?.from ?? "",
  );
  return /@g\.us/i.test(jid);
}

// Tipos que não devem virar conversa/mensagem de atendimento.
const SKIP_TYPES = new Set([
  "reactionmessage", "reaction", "protocolmessage", "senderkeydistributionmessage",
  "pollupdatemessage", "ephemeralmessage",
]);

/**
 * Número real do CONTATO numa conversa 1:1.
 * No WhatsApp novo o `sender` costuma ser um @lid (id privado), mas o `chatid`
 * traz o número real (`557181937254@s.whatsapp.net`). Então priorizamos o chatid.
 */
function contactNumber(m: any): string {
  const jid = String(
    m?.chatid ?? m?.chat ?? m?.key?.remoteJid ?? m?.content?.key?.remoteJID ?? m?.from ?? m?.sender ?? "",
  );
  // Ignora @lid (não disca) — se só houver lid, devolve vazio e a msg é descartada.
  if (/@lid/i.test(jid) && !/@s\.whatsapp\.net/i.test(jid)) {
    const alt = String(m?.sender ?? m?.from ?? "");
    if (/@s\.whatsapp\.net/i.test(alt)) return alt.replace(/@.*/, "").replace(/\D/g, "");
    return "";
  }
  return jid.replace(/@.*/, "").replace(/\D/g, "");
}

/** ID do grupo (dígitos do JID @g.us). */
function groupId(m: any): string {
  const jid = String(
    m?.chatid ?? m?.chat ?? m?.key?.remoteJid ?? m?.content?.key?.remoteJID ?? "",
  );
  return jid.replace(/@.*/, "").replace(/\D/g, "");
}

/** Nome do grupo, se vier no payload. */
function groupName(m: any): string | undefined {
  return m?.chatName ?? m?.groupName ?? m?.groupSubject ?? m?.subject ?? m?.group?.subject ?? undefined;
}

/** Nome de quem enviou (participante do grupo ou remetente 1:1). */
function authorName(m: any): string | undefined {
  return m?.senderName ?? m?.pushName ?? m?.notifyName ?? undefined;
}

/** Normaliza o payload de webhook da UAZAPI em mensagens internas. */
export function parseUazapiWebhook(payload: any): InboundMessage[] {
  const msgs = payload?.messages ?? (payload?.message ? [payload.message] : []);
  const token = payload?.token ?? payload?.instance ?? payload?.owner ?? "";
  return (Array.isArray(msgs) ? msgs : [])
    .filter((m: any) => !m?.fromMe) // ignora ecos do próprio número
    .filter((m: any) => !SKIP_TYPES.has(String(m?.type ?? m?.messageType ?? "").toLowerCase()))
    .map((m: any): InboundMessage => {
      const group = isGroupMessage(m);
      return {
        channelExternalId: token,
        from: group ? groupId(m) : contactNumber(m),
        contactName: group ? groupName(m) : authorName(m),
        isGroup: group,
        authorName: group ? authorName(m) : undefined,
        contentType: mapType(m?.type ?? m?.messageType),
        body: m?.text ?? m?.body ?? m?.caption ?? m?.content?.text,
        mediaUrl: m?.file ?? m?.mediaUrl ?? m?.fileURL,
        externalId: m?.id ?? m?.messageId ?? m?.messageid,
        timestamp: m?.timestamp
          ? String(m.timestamp)
          : m?.messageTimestamp
            ? String(m.messageTimestamp)
            : undefined,
      };
    })
    .filter((m: InboundMessage) => !!m.from); // precisa de número/id de contato válido
}

function mapType(t?: string): InboundMessage["contentType"] {
  const s = (t || "").toLowerCase();
  if (s.includes("image")) return "image";
  if (s.includes("audio") || s.includes("ptt")) return "audio";
  if (s.includes("video")) return "video";
  if (s.includes("document")) return "document";
  if (s.includes("sticker")) return "sticker";
  if (s.includes("location")) return "location";
  if (s.includes("contact") || s.includes("vcard")) return "contact";
  return "text";
}
