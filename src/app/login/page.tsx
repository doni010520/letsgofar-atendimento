"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      setError("Supabase não configurado (.env.local). Login real indisponível no modo preview.");
      return;
    }
    setPending(true);
    const form = new FormData(e.currentTarget);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) setError("E-mail ou senha inválidos.");
    else router.push("/dashboard");
  }

  return (
    <AuthShell title="Entrar" subtitle="Acesse o seu painel de atendimento">
      <form onSubmit={onSubmit} className="space-y-4">
        <AuthField name="email" type="email" label="E-mail" placeholder="voce@empresa.com" />
        <AuthField name="password" type="password" label="Senha" placeholder="••••••••" />
        {error && <p className="text-xs text-danger">{error}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Entrando..." : "Entrar"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-ink-soft">
        Não tem conta?{" "}
        <Link href="/cadastro" className="font-medium text-brand hover:underline">
          Cadastre-se
        </Link>
      </p>
    </AuthShell>
  );
}

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm rounded-card bg-surface p-8 shadow-lg">
        <div className="mb-6 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mvf.png" alt="MVF" className="mb-4 h-24 w-auto rounded-xl" />
          <h1 className="text-xl font-semibold text-ink">{title}</h1>
          <p className="text-sm text-ink-soft">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuthField({
  name,
  type,
  label,
  placeholder,
}: {
  name: string;
  type: string;
  label: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink-soft">{label}</label>
      <input
        name={name}
        type={type}
        required
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand"
      />
    </div>
  );
}
