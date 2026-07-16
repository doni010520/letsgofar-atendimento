"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { setTotpEnabled } from "@/app/(app)/perfil/actions";
import { Button } from "@/components/ui";

type Factor = { id: string; status: string };

/**
 * Porta de 2FA obrigatório. É para onde o layout do app manda quem ainda não
 * está em AAL2 quando REQUIRE_2FA está ligado:
 *  - já tem um autenticador verificado → pede o código (challenge);
 *  - não tem → força o cadastro (enroll com QR) e verifica.
 * Ao concluir, a sessão sobe para AAL2 e volta ao dashboard.
 */
export default function TwoFactorGate() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"loading" | "enroll" | "challenge">("loading");
  const [enroll, setEnroll] = useState<{ qr: string; secret: string } | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `known` = lista de fatores já buscada (evita re-consultar). Fatores TOTP
  // não verificados pendentes são removidos EM PARALELO (eles se acumulam a cada
  // tentativa não concluída e a remoção sequencial era o que travava o QR).
  async function startEnroll(known?: Factor[]) {
    const totp = known ?? (((await supabase.auth.mfa.listFactors()).data?.totp ?? []) as Factor[]);
    const unverified = totp.filter((f) => f.status !== "verified");
    if (unverified.length) {
      await Promise.all(unverified.map((f) => supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {})));
    }
    // friendlyName ÚNICO: o Supabase exige nome único por usuário. Sem isso, o
    // enroll padrão usa "" e colide com um fator "" pendente ("A factor with the
    // friendly name '' already exists"), travando o 2FA. Nome único nunca colide.
    const { data: en, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `totp-${Date.now()}` });
    if (error) { setError(error.message); return; }
    setEnroll({ qr: en.totp.qr_code, secret: en.totp.secret });
    setFactorId(en.id);
    setMode("enroll");
  }

  // Prepara a tela (challenge se já tem fator verificado; senão enroll com QR).
  // Erros ficam VISÍVEIS + com "Tentar novamente" (antes travava em "Carregando…").
  async function load() {
    setError(null);
    setMode("loading");
    try {
      // Timeout de 15s: se alguma chamada ao Supabase pendurar, vira erro + retry
      // (antes ficava em "Carregando…" pra sempre).
      await Promise.race([
        (async () => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) { router.replace("/login"); return; }
          // AAL e fatores em paralelo (não dependem um do outro).
          const [aalRes, factorsRes] = await Promise.all([
            supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
            supabase.auth.mfa.listFactors(),
          ]);
          if (aalRes.data?.currentLevel === "aal2") { router.replace("/dashboard"); return; }
          const totp = (factorsRes.data?.totp ?? []) as Factor[];
          const verified = totp.find((f) => f.status === "verified");
          if (verified) { setFactorId(verified.id); setMode("challenge"); }
          else { await startEnroll(totp); } // reusa a lista já buscada
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
      ]);
    } catch {
      setError("Não consegui preparar a verificação. Toque em Tentar novamente.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify() {
    if (!factorId || code.trim().length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const ch = await supabase.auth.mfa.challenge({ factorId });
      if (ch.error) throw ch.error;
      const v = await supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: code.trim() });
      if (v.error) throw v.error;
      if (mode === "enroll") await setTotpEnabled(true);
      router.replace("/dashboard");
    } catch {
      setBusy(false);
      setError("Código inválido. Verifique o app autenticador e tente novamente.");
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const codeBox = (
    <div className="space-y-3">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        onKeyDown={(e) => { if (e.key === "Enter") verify(); }}
        inputMode="numeric"
        autoFocus
        placeholder="000000"
        className="w-full rounded-lg border border-border px-3 py-2 text-center font-mono text-lg tracking-[0.3em] outline-none focus:border-brand"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <Button onClick={verify} className="w-full" disabled={busy || code.length < 6}>
        {busy ? "Verificando…" : "Confirmar"}
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm rounded-card bg-surface p-8 shadow-lg">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-light text-brand">
            <ShieldCheck size={26} />
          </div>
          <h1 className="text-xl font-semibold text-ink">Verificação em duas etapas</h1>
          <p className="text-sm text-ink-soft">
            {mode === "enroll"
              ? "Sua conta exige 2FA. Configure para continuar."
              : "Digite o código do seu app autenticador."}
          </p>
        </div>

        {mode === "loading" && (
          error ? (
            <div className="space-y-3 text-center">
              <p className="text-sm text-danger">{error}</p>
              <Button onClick={load} className="w-full">Tentar novamente</Button>
            </div>
          ) : (
            <p className="flex items-center justify-center gap-2 text-sm text-ink-soft">
              <Loader2 size={16} className="animate-spin" /> Carregando…
            </p>
          )
        )}

        {mode === "enroll" && enroll && (
          <div className="space-y-3">
            <p className="text-xs text-ink-soft">1. Escaneie no Google Authenticator, Authy ou similar:</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enroll.qr} alt="QR Code 2FA" className="mx-auto h-44 w-44 rounded-lg border border-border bg-white p-1" />
            <p className="text-xs text-ink-soft break-all">
              Ou o código manual: <code className="rounded bg-gray-100 px-1 font-mono text-[11px]">{enroll.secret}</code>
            </p>
            <p className="text-xs text-ink-soft">2. Digite o código de 6 dígitos:</p>
            {codeBox}
          </div>
        )}

        {mode === "challenge" && codeBox}

        <button onClick={logout} className="mt-4 w-full text-center text-xs text-ink-soft hover:text-ink hover:underline">
          Sair e entrar com outra conta
        </button>
      </div>
    </div>
  );
}
