import { createClient } from "@/lib/supabase/server";
import type { Organization, Profile } from "@/lib/types";

/** Retorna o usuário autenticado + seu profile + a organização. Null se não logado. */
export async function getSession(): Promise<{
  userId: string;
  profile: Profile | null;
  organization: Organization | null;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  let organization: Organization | null = null;
  if (profile?.organization_id) {
    const { data: org } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", profile.organization_id)
      .maybeSingle();
    organization = org ?? null;
  }

  return { userId: user.id, profile: (profile as Profile) ?? null, organization };
}

/** true se o profile tem privilégio de admin: admin da org OU super_admin da plataforma. */
export function isAdmin(profile: Profile | null): boolean {
  if (!profile) return false;
  return profile.role === "admin" || (profile as { super_admin?: boolean }).super_admin === true;
}

/**
 * Garante que a sessão atual é de um administrador; lança se não for.
 * Use em Server Actions sensíveis (ex.: configurar o agente de IA).
 */
export async function requireAdmin() {
  const session = await getSession();
  if (!session || !isAdmin(session.profile)) {
    throw new Error("Acesso restrito a administradores.");
  }
  return session;
}
