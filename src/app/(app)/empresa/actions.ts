"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";

export async function updateOrg(fd: FormData) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Configure o Supabase.");
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();
  const { error } = await sb
    .from("organizations")
    .update({
      name: String(fd.get("name") || "").trim(),
      document: String(fd.get("document") || "").trim() || null,
    })
    .eq("id", session.organization.id);
  if (error) throw new Error(error.message);
  revalidatePath("/empresa");
}
