"use server";

import { revalidatePath } from "next/cache";
import { orgInsert, orgUpdate, orgDelete } from "@/lib/crud-helpers";

export async function createTemplate(fd: FormData) {
  await orgInsert("wa_templates", {
    name: String(fd.get("name") || "").trim(),
    language: String(fd.get("language") || "pt_BR"),
    category: String(fd.get("category") || "UTILITY"),
    status: "pending",
    components: JSON.parse(String(fd.get("components") || "[]")),
  });
  revalidatePath("/mensagens/templates");
}

export async function updateTemplate(id: string, fd: FormData) {
  await orgUpdate("wa_templates", id, {
    name: String(fd.get("name") || "").trim(),
    language: String(fd.get("language") || "pt_BR"),
    category: String(fd.get("category") || "UTILITY"),
    components: JSON.parse(String(fd.get("components") || "[]")),
  });
  revalidatePath("/mensagens/templates");
}

export async function deleteTemplate(id: string) {
  await orgDelete("wa_templates", id);
  revalidatePath("/mensagens/templates");
}
