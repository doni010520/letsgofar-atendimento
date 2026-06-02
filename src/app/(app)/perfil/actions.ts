"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";

export async function updateOwnProfile(fd: FormData) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Configure o Supabase.");
  const session = await getSession();
  if (!session) throw new Error("Sessão inválida.");
  const sb = await createClient();
  const { error } = await sb
    .from("profiles")
    .update({
      name: String(fd.get("name") || "").trim(),
      whatsapp: String(fd.get("whatsapp") || "").replace(/\D/g, "") || null,
      status: String(fd.get("status") || "offline"),
      notify: fd.get("notify") === "on",
    })
    .eq("id", session.userId);
  if (error) throw new Error(error.message);
  revalidatePath("/perfil");
}
