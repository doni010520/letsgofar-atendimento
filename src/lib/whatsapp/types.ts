import type { Channel } from "@/lib/types";

export interface SendTextParams {
  to: string; // número no formato internacional, só dígitos
  text: string;
}

export interface SendMediaParams {
  to: string;
  url: string;
  caption?: string;
  kind: "image" | "audio" | "video" | "document";
}

export interface ConnectResult {
  status: Channel["status"];
  qrCode?: string; // base64/data-url quando aplicável (UAZAPI)
  pairCode?: string; // código de 8 dígitos para parear por número (UAZAPI)
  externalId?: string;
  debug?: string; // trilha de diagnóstico (temporário)
}

/** Contrato único para qualquer provedor de WhatsApp (Adapter). */
export interface ChannelProvider {
  /** Inicia/garante a conexão. Se `phone` vier, pede código de pareamento (UAZAPI). */
  connect(phone?: string): Promise<ConnectResult>;
  /** Consulta o status atual da conexão. */
  status(): Promise<Channel["status"]>;
  sendText(params: SendTextParams): Promise<{ externalId?: string }>;
  sendMedia(params: SendMediaParams): Promise<{ externalId?: string }>;
  /** URL da foto de perfil do contato (UAZAPI). Meta não expõe → null. */
  getProfilePicture?(phone: string): Promise<string | null>;
  /** Desconecta a sessão sem apagar (UAZAPI). */
  disconnect?(): Promise<void>;
  /** Apaga a instância no provedor (UAZAPI). */
  deleteInstance?(): Promise<void>;
}

/** Mensagem normalizada vinda de um webhook, independente do provedor. */
export interface InboundMessage {
  channelExternalId: string; // identifica o canal (instance/phone_number_id)
  from: string; // número do contato (dígitos)
  contactName?: string;
  contentType: "text" | "image" | "audio" | "video" | "document" | "location" | "contact" | "sticker";
  body?: string;
  mediaUrl?: string;
  externalId?: string; // id da mensagem no provedor
  timestamp?: string;
}
