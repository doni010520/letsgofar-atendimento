"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";

/** Cria ou atualiza um agente de IA. */
export async function saveAiAgent(fd: FormData) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Configure o Supabase.");
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();

  const id = String(fd.get("id") || "").trim();
  const channelId = String(fd.get("channel_id") || "").trim() || null;
  const temperature = Math.min(2, Math.max(0, Number(fd.get("temperature") || 0.4)));
  const values = {
    name: String(fd.get("name") || "").trim() || "Agente de IA",
    prompt: String(fd.get("prompt") || "").trim() || null,
    model: String(fd.get("model") || "gpt-4o-mini"),
    channel_id: channelId,
    active: fd.get("active") === "on",
    config: {
      temperature,
      knowledge: String(fd.get("knowledge") || "").trim() || undefined,
      greeting: String(fd.get("greeting") || "").trim() || undefined,
      use_emojis: fd.get("use_emojis") === "on",
      execute_actions: fd.get("execute_actions") === "on",
      single_message: fd.get("single_message") === "on",
    },
  };

  if (id) {
    const { error } = await sb.from("ai_agents").update(values).eq("id", id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb
      .from("ai_agents")
      .insert({ organization_id: session.organization.id, ...values });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/ajustes/ia");
}

/** Deleta um agente de IA. */
export async function deleteAiAgent(id: string) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Configure o Supabase.");
  const sb = await createClient();
  const { error } = await sb.from("ai_agents").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/ajustes/ia");
}
