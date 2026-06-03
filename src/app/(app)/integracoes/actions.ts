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
