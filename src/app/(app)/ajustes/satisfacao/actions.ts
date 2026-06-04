"use server";

import { revalidatePath } from "next/cache";
import { orgInsert, orgUpdate, orgDelete } from "@/lib/crud-helpers";

export async function createSurvey(fd: FormData) {
  await orgInsert("satisfaction_surveys", {
    name: String(fd.get("name") || "").trim(),
    question: String(fd.get("question") || "De 1 a 5, como você avalia o nosso atendimento?").trim(),
    scale_type: String(fd.get("scale_type") || "stars"),
    scale_max: parseInt(String(fd.get("scale_max") || "5"), 10),
    close_after_min: parseInt(String(fd.get("close_after_min") || "30"), 10),
    active: fd.get("active") === "on",
  });
  revalidatePath("/ajustes/satisfacao");
}

export async function updateSurvey(id: string, fd: FormData) {
  await orgUpdate("satisfaction_surveys", id, {
    name: String(fd.get("name") || "").trim(),
    question: String(fd.get("question") || "").trim(),
    scale_type: String(fd.get("scale_type") || "stars"),
    scale_max: parseInt(String(fd.get("scale_max") || "5"), 10),
    close_after_min: parseInt(String(fd.get("close_after_min") || "30"), 10),
    active: fd.get("active") === "on",
  });
  revalidatePath("/ajustes/satisfacao");
}

export async function deleteSurvey(id: string) {
  await orgDelete("satisfaction_surveys", id);
  revalidatePath("/ajustes/satisfacao");
}
