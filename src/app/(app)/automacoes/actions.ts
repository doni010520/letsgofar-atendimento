"use server";

import { revalidatePath } from "next/cache";
import { orgInsert, orgUpdate, orgDelete } from "@/lib/crud-helpers";

export async function createAutomation(fd: FormData) {
  await orgInsert("automations", {
    name: String(fd.get("name") || "").trim(),
    channel_id: String(fd.get("channel_id") || "") || null,
    trigger: String(fd.get("trigger") || "").trim() || null,
  });
  revalidatePath("/automacoes");
}
export async function toggleAutomation(id: string, active: boolean) {
  await orgUpdate("automations", id, { active, updated_at: new Date().toISOString() });
  revalidatePath("/automacoes");
}
export async function deleteAutomation(id: string) {
  await orgDelete("automations", id);
  revalidatePath("/automacoes");
}
