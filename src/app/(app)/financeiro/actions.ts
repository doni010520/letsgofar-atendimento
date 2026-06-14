"use server";

import { revalidatePath } from "next/cache";
import { orgInsert, orgUpdate, orgDelete } from "@/lib/crud-helpers";

export async function createInvoice(fd: FormData) {
  await orgInsert("invoices", {
    description: String(fd.get("description") || "").trim(),
    amount: parseFloat(String(fd.get("amount") || "0").replace(",", ".")) || 0,
    due_date: String(fd.get("due_date") || "").trim() || null,
    status: "open",
  });
  revalidatePath("/financeiro");
}

export async function setInvoiceStatus(id: string, status: "open" | "paid" | "cancelled") {
  await orgUpdate("invoices", id, {
    status,
    paid_at: status === "paid" ? new Date().toISOString() : null,
  });
  revalidatePath("/financeiro");
}

export async function deleteInvoice(id: string) {
  await orgDelete("invoices", id);
  revalidatePath("/financeiro");
}
