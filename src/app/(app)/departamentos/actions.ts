"use server";

import { revalidatePath } from "next/cache";
import { orgInsert, orgUpdate, orgDelete } from "@/lib/crud-helpers";

export async function createDepartment(fd: FormData) {
  await orgInsert("departments", {
    name: String(fd.get("name") || "").trim(),
    color: String(fd.get("color") || "#00a8ff"),
  });
  revalidatePath("/departamentos");
}

export async function updateDepartment(id: string, fd: FormData) {
  await orgUpdate("departments", id, {
    name: String(fd.get("name") || "").trim(),
    color: String(fd.get("color") || "#00a8ff"),
  });
  revalidatePath("/departamentos");
}

export async function deleteDepartment(id: string) {
  await orgDelete("departments", id);
  revalidatePath("/departamentos");
}
