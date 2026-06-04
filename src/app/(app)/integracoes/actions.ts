"use server";

import { revalidatePath } from "next/cache";
import { orgInsert, orgDelete } from "@/lib/crud-helpers";

export async function createIntegration(fd: FormData) {
  await orgInsert("integrations", {
    type: String(fd.get("type") || "sgp"),
    config: {
      url: String(fd.get("url") || "").trim(),
      app: String(fd.get("app") || "").trim(),
      token: String(fd.get("token") || "").trim(),
      username: String(fd.get("username") || "").trim(),
      password: String(fd.get("password") || "").trim(),
    },
  });
  revalidatePath("/integracoes");
}
export async function deleteIntegration(id: string) {
  await orgDelete("integrations", id);
  revalidatePath("/integracoes");
}

/** Testa a conexão com a integração SGP. */
export async function testIntegration(id: string): Promise<{ ok: boolean; message: string }> {
  const { createClient } = await import("@/lib/supabase/server");
  const sb = await createClient();
  const { data } = await sb.from("integrations").select("config").eq("id", id).single();
  if (!data) return { ok: false, message: "Integração não encontrada." };
  try {
    const { sgpFromConfig } = await import("@/lib/sgp");
    const client = sgpFromConfig(data.config);
    // Tenta listar tipos de ocorrência como health check (endpoint leve).
    const tipos = await client.listarTiposOcorrencia();
    return { ok: true, message: `Conexão OK! ${tipos.length} tipos de ocorrência encontrados.` };
  } catch (e) {
    return { ok: false, message: `Falha: ${(e as Error)?.message ?? "erro desconhecido"}` };
  }
}
