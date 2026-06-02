"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";

function ensureReal() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Configure o Supabase para gerenciar atendentes.");
}

export async function createAgent(fd: FormData) {
  ensureReal();
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");

  const name = String(fd.get("name") || "").trim();
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const password = String(fd.get("password") || "");
  const role = String(fd.get("role") || "agent");
  const department_id = String(fd.get("department_id") || "") || null;
  if (!email || password.length < 6) throw new Error("Informe e-mail e uma senha de no mínimo 6 caracteres.");

  const admin = createServiceClient();
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (authErr) throw new Error(authErr.message);

  const { error } = await admin.from("profiles").upsert({
    id: created.user!.id,
    organization_id: session.organization.id,
    name,
    email,
    role,
    department_id,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/atendentes");
}

export async function updateAgent(id: string, fd: FormData) {
  ensureReal();
  const sb = await createClient();
  const { error } = await sb
    .from("profiles")
    .update({
      name: String(fd.get("name") || "").trim(),
      role: String(fd.get("role") || "agent"),
      department_id: String(fd.get("department_id") || "") || null,
      status: String(fd.get("status") || "offline"),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/atendentes");
}

export async function deleteAgent(id: string) {
  ensureReal();
  const session = await getSession();
  if (session?.userId === id) throw new Error("Você não pode excluir o próprio usuário.");
  const admin = createServiceClient();
  // Remover o usuário do Auth remove o profile em cascata.
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) throw new Error(error.message);
  revalidatePath("/atendentes");
}
