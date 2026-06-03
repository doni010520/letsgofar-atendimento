export type Role = "admin" | "supervisor" | "agent";
export type ChannelType = "meta_cloud" | "uazapi";
export type ChannelStatus = "pending" | "connecting" | "connected" | "disconnected" | "error";
export type ConversationStatus = "bot" | "queued" | "open" | "closed";
export type MessageDirection = "in" | "out";
export type SenderType = "contact" | "agent" | "bot" | "system";
export type ContentType =
  | "text" | "image" | "audio" | "video" | "document"
  | "location" | "contact" | "template" | "sticker";

export interface Organization {
  id: string;
  name: string;
  document: string | null;
  settings: Record<string, unknown>;
  created_at: string;
}

export interface Profile {
  id: string;
  organization_id: string | null;
  name: string;
  email: string | null;
  role: Role;
  department_id: string | null;
  avatar_url: string | null;
  status: "online" | "away" | "offline";
  whatsapp: string | null;
  notify: boolean;
  created_at: string;
}

export interface Department {
  id: string;
  organization_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export type TagScope = "conversation" | "contact" | "status";

export interface Tag {
  id: string;
  organization_id: string;
  name: string;
  color: string | null;
  scope: TagScope;
  created_at: string;
}

export interface QuickReply {
  id: string;
  organization_id: string;
  title: string;
  content: string;
  shortcut: string | null;
  kind: "model" | "macro" | "auto";
  created_at: string;
}

export interface Automation {
  id: string;
  organization_id: string;
  channel_id: string | null;
  name: string;
  trigger: string | null;
  flow: { nodes: unknown[]; edges: unknown[] };
  active: boolean;
  updated_at: string;
  created_at: string;
}

export interface Integration {
  id: string;
  organization_id: string;
  type: string;
  config: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

export type CampaignStatus = "draft" | "scheduled" | "running" | "paused" | "done" | "failed";

export interface Campaign {
  id: string;
  organization_id: string;
  automation_id: string | null;
  name: string;
  status: CampaignStatus;
  audience: unknown[];
  scheduled_at: string | null;
  progress: number;
  stats: Record<string, unknown>;
  created_at: string;
}

export interface Plan {
  id: string;
  organization_id: string;
  name: string;
  price: number | null;
  description: string | null;
  created_at: string;
}

export interface Channel {
  id: string;
  organization_id: string;
  name: string;
  type: ChannelType;
  phone: string | null;
  status: ChannelStatus;
  external_id: string | null;
  credentials: Record<string, unknown>;
  created_at: string;
}

export interface Contact {
  id: string;
  organization_id: string;
  name: string | null;
  phone: string;
  avatar_url: string | null;
  custom_fields: Record<string, unknown>;
  notes: string | null;
  is_group?: boolean;
  created_at: string;
}

export interface Conversation {
  id: string;
  organization_id: string;
  channel_id: string;
  contact_id: string;
  status: ConversationStatus;
  assigned_user_id: string | null;
  department_id: string | null;
  protocol: string | null;
  last_message_at: string | null;
  opened_at: string | null;
  closed_at: string | null;
  satisfaction: number | null;
  is_muted?: boolean;
  created_at: string;
}

export interface ConversationOverview {
  id: string;
  organization_id: string;
  status: ConversationStatus;
  assigned_user_id: string | null;
  department_id: string | null;
  channel_id: string;
  contact_id: string;
  protocol: string | null;
  last_message_at: string | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string;
  contact_name: string | null;
  contact_phone: string;
  contact_avatar: string | null;
  channel_name: string;
  channel_type: ChannelType;
  last_message_body: string | null;
  last_message_type: ContentType | null;
  last_message_direction: MessageDirection | null;
  is_group?: boolean;
  is_muted?: boolean;
  contact_jid?: string | null;
  last_message_author?: string | null;
}

export interface Message {
  id: string;
  organization_id: string;
  conversation_id: string;
  direction: MessageDirection;
  sender_type: SenderType;
  sender_id: string | null;
  content_type: ContentType;
  body: string | null;
  media_url: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  external_id: string | null;
  author_name?: string | null;
  author_phone?: string | null;
  author_lid?: string | null;
  reply_to_external?: string | null;
  reply_excerpt?: string | null;
  reply_author?: string | null;
  reactions?: { emoji: string; by: string }[];
  is_deleted?: boolean;
  edited?: boolean;
  created_at: string;
}
