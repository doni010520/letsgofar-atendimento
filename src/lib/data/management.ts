import { createClient } from "@/lib/supabase/server";
import {
  MOCK_DEPARTMENTS,
  MOCK_TAGS,
  MOCK_AGENTS,
  MOCK_QUICK_REPLIES,
  PREVIEW_MODE,
} from "@/lib/mock";
import type { Department, Tag, TagScope, Profile, QuickReply } from "@/lib/types";

export async function getDepartments(): Promise<Department[]> {
  if (PREVIEW_MODE) return MOCK_DEPARTMENTS;
  const sb = await createClient();
  const { data } = await sb.from("departments").select("*").order("name");
  return (data as Department[]) ?? [];
}

export async function getTags(scope?: TagScope): Promise<Tag[]> {
  if (PREVIEW_MODE) return scope ? MOCK_TAGS.filter((t) => t.scope === scope) : MOCK_TAGS;
  const sb = await createClient();
  let q = sb.from("tags").select("*").order("name");
  if (scope) q = q.eq("scope", scope);
  const { data } = await q;
  return (data as Tag[]) ?? [];
}

export async function getAgents(): Promise<Profile[]> {
  if (PREVIEW_MODE) return MOCK_AGENTS;
  const sb = await createClient();
  const { data } = await sb.from("profiles").select("*").order("name");
  return (data as Profile[]) ?? [];
}

export async function getQuickReplies(kind?: QuickReply["kind"]): Promise<QuickReply[]> {
  if (PREVIEW_MODE) return kind ? MOCK_QUICK_REPLIES.filter((q) => q.kind === kind) : MOCK_QUICK_REPLIES;
  const sb = await createClient();
  let q = sb.from("quick_replies").select("*").order("title");
  if (kind) q = q.eq("kind", kind);
  const { data } = await q;
  return (data as QuickReply[]) ?? [];
}
