"use server";

import { revalidatePath } from "next/cache";
import { orgInsert, orgUpdate, orgDelete } from "@/lib/crud-helpers";

export async function createCampaign(fd: FormData) {
  await orgInsert("campaigns", {
    name: String(fd.get("name") || "").trim(),
    status: String(fd.get("status") || "draft"),
  });
  revalidatePath("/campanhas");
}
export async function updateCampaignStatus(id: string, status: string) {
  await orgUpdate("campaigns", id, { status });
  revalidatePath("/campanhas");
}
export async function deleteCampaign(id: string) {
  await orgDelete("campaigns", id);
  revalidatePath("/campanhas");
}
