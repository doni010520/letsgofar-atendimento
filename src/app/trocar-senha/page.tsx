import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ForcedPasswordForm } from "@/components/forced-password-form";

/**
 * Porta de troca de senha OBRIGATÓRIA no primeiro acesso. É para onde o layout
 * do app manda quem tem `must_change_password` (conta criada com senha
 * provisória). Fica fora do grupo (app) para não entrar em loop de redirect.
 * Ao concluir, a flag é limpa e a pessoa segue o fluxo normal (2FA → app).
 */
export default async function TrocarSenhaPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) redirect("/login");
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.mustChangePassword) redirect("/"); // já trocou — não precisa

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-ink">Crie sua senha</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Sua conta foi criada com uma senha provisória. Defina uma senha pessoal para continuar.
        </p>
        <ForcedPasswordForm />
      </div>
    </div>
  );
}
