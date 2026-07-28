import { headers } from "next/headers";
import { loadSignerByToken, signContract, refuseContract } from "@/lib/contracts";

export const dynamic = "force-dynamic";

async function clientIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip");
}

export default async function AssinarPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ erro?: string; ok?: string }>;
}) {
  const { token } = await params;
  const { erro, ok } = await searchParams;
  const signer = await loadSignerByToken(token);

  if (!signer) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Link inválido</h1>
        <p className="mt-2 text-sm text-gray-600">
          Este link de assinatura não existe ou expirou. Fale com quem enviou o contrato.
        </p>
      </Shell>
    );
  }

  if (ok === "1" || signer.status === "signed") {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-green-700">Contrato assinado ✅</h1>
        <p className="mt-2 text-sm text-gray-600">
          Obrigado, {signer.name}. Sua assinatura do contrato {signer.contract.number} foi registrada.
        </p>
      </Shell>
    );
  }

  if (signer.status === "refused") {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Contrato recusado</h1>
        <p className="mt-2 text-sm text-gray-600">Sua recusa foi registrada.</p>
      </Shell>
    );
  }

  async function assinar(fd: FormData) {
    "use server";
    const h = await headers();
    const res = await signContract({
      token,
      confirmationName: String(fd.get("confirmation_name") || ""),
      confirmationDocument: String(fd.get("confirmation_document") || ""),
      ip: await clientIp(),
      userAgent: h.get("user-agent"),
    });
    const { redirect } = await import("next/navigation");
    redirect(res.ok ? `/assinar/${token}?ok=1` : `/assinar/${token}?erro=${encodeURIComponent(res.error ?? "")}`);
  }

  async function recusar(fd: FormData) {
    "use server";
    const res = await refuseContract({
      token,
      reason: String(fd.get("reason") || "Sem motivo informado"),
      ip: await clientIp(),
    });
    const { redirect } = await import("next/navigation");
    redirect(res.ok ? `/assinar/${token}` : `/assinar/${token}?erro=${encodeURIComponent(res.error ?? "")}`);
  }

  return (
    <Shell wide>
      <p className="text-xs uppercase tracking-wide text-gray-500">{signer.contract.number}</p>
      <h1 className="mt-1 text-xl font-semibold">{signer.contract.title}</h1>
      <p className="mt-1 text-sm text-gray-600">
        Olá, {signer.name}. Leia o contrato abaixo e confirme sua assinatura.
      </p>

      <article
        className="prose prose-sm mt-6 max-w-none rounded-lg border border-gray-200 bg-white p-6"
        dangerouslySetInnerHTML={{ __html: signer.contract.content_html }}
      />

      {erro && <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <form action={assinar} className="mt-6 space-y-3 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Confirmar assinatura</h2>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Digite seu nome completo</label>
          <input
            name="confirmation_name"
            defaultValue={signer.name}
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">CPF (opcional)</label>
          <input
            name="confirmation_document"
            defaultValue={signer.document ?? ""}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <p className="text-xs leading-relaxed text-gray-500">
          Ao assinar, registramos data e hora, seu endereço IP e o navegador utilizado, para dar
          validade jurídica ao documento (MP 2.200-2/2001 e Lei 14.063/2020).
        </p>
        <button className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white">
          Assinar contrato
        </button>
      </form>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-gray-500">Não concordo com este contrato</summary>
        <form action={recusar} className="mt-3 space-y-2 rounded-lg border border-gray-200 p-4">
          <textarea
            name="reason"
            rows={3}
            placeholder="Conte o motivo da recusa"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700">
            Recusar contrato
          </button>
        </form>
      </details>
    </Shell>
  );
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className={`mx-auto ${wide ? "max-w-3xl" : "max-w-md"} rounded-xl bg-white p-8 shadow-sm`}>
        {children}
      </div>
    </main>
  );
}
