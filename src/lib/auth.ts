import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Organization, Profile } from "@/lib/types";

/** Retorna o usuário autenticado + seu profile + a organização. Null se não logado. */
export async function getSession(): Promise<{
  userId: string;
  profile: Profile | null;
  organization: Organization | null;
  /** true quando a conta foi criada com senha provisória e ainda não foi trocada. */
  mustChangePassword: boolean;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const mustChangePassword =
    (user.user_metadata as { must_change_password?: boolean } | null | undefined)?.must_change_password === true;

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

  return { userId: user.id, profile: (profile as Profile) ?? null, organization, mustChangePassword };
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

/**
 * Mesmas checagens de acesso do layout do app (sessão, onboarding, senha
 * provisória e 2FA/AAL2) — extraído para dar pra reusar em layouts que NÃO
 * mostram a casca com sidebar (ex.: páginas de impressão), sem abrir mão de
 * nenhuma das proteções. Redireciona e nunca retorna quando bloqueia.
 */
export async function requireAppSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.organization) redirect("/onboarding");
  const org = session.organization;
  if (session.mustChangePassword) redirect("/trocar-senha");

  if (process.env.REQUIRE_2FA !== "false") {
    const DEFAULT_EXEMPT = ["admin@mvf.com.br", "revisor@benitechlab.com"];
    const exempt = [
      ...DEFAULT_EXEMPT,
      ...(process.env.MFA_EXEMPT_EMAILS ?? "").split(","),
    ].map((s) => s.trim().toLowerCase()).filter(Boolean);
    const emailLc = (session.profile?.email ?? "").toLowerCase();
    if (!emailLc || !exempt.includes(emailLc)) {
      let needs2fa = false;
      try {
        const sb = await createClient();
        const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
        needs2fa = !!aal && aal.currentLevel !== "aal2";
      } catch {
        needs2fa = false;
      }
      if (needs2fa) redirect("/2fa");
    }
  }

  return { ...session, organization: org };
}
