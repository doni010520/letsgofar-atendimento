import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { tituloPdfContrato } from "@/lib/contract-nome";

export const dynamic = "force-dynamic";

/**
 * O título da página É o nome do arquivo baixado.
 *
 * "Imprimir -> Salvar como PDF" usa o `document.title` como nome sugerido.
 * Esta página não definia título nenhum, então herdava o do layout raiz e TODO
 * contrato baixava como "Let's Go Far — Atendimento.pdf": na pasta de
 * Downloads ficavam vários arquivos de nome idêntico, indistinguíveis. Era
 * isso o "se precisarmos consultar um aluno específico, não aparece o nome, aí
 * teríamos que baixar um por um até achar".
 *
 * Consulta enxuta e à parte da página (número + signatários, nada de HTML do
 * contrato): é uma tela aberta a mão, uma vez, não um caminho quente.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const db = await createClient();
  const { data } = await db
    .from("contracts")
    .select("number, contract_signers(name, status)")
    .eq("id", id)
    .maybeSingle();

  const c = data as { number: string; contract_signers: { name: string; status: string }[] } | null;
  return { title: c ? tituloPdfContrato(c.number, c.contract_signers) : "Contrato" };
}

/**
 * Versão imprimível do contrato (A2).
 * Abre e usa "Imprimir → Salvar como PDF" — evita empacotar um gerador de
 * PDF só para isso, e sai com a mesma fidelidade do documento assinado.
 */
export default async function ContratoPdfPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await createClient();

  const { data } = await db
    .from("contracts")
    .select("number, title, content_html, status, created_at, contract_signers(name, email, document, status, signed_at)")
    .eq("id", id)
    .maybeSingle();

  if (!data) {
    return <main style={{ padding: 40, fontFamily: "system-ui" }}>Contrato não encontrado.</main>;
  }

  const contract = data as {
    number: string;
    title: string;
    content_html: string;
    status: string;
    created_at: string;
    contract_signers: {
      name: string; email: string; document: string | null;
      status: string; signed_at: string | null;
    }[];
  };

  const assinados = contract.contract_signers.filter((s) => s.status === "signed");

  return (
    <main className="mx-auto max-w-3xl bg-white p-10 text-[13px] leading-relaxed text-gray-900 print:p-0">
      <header className="mb-6 border-b border-gray-200 pb-4">
        <p className="text-xs uppercase tracking-wide text-gray-500">{contract.number}</p>
        <h1 className="mt-1 text-xl font-semibold">{contract.title}</h1>
        <p className="mt-1 text-xs text-gray-500">
          Emitido em {new Date(contract.created_at).toLocaleDateString("pt-BR")}
        </p>
      </header>

      <article
        className="prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: contract.content_html }}
      />

      <section className="mt-10 border-t border-gray-200 pt-4">
        <h2 className="text-sm font-semibold">Assinaturas</h2>
        {assinados.length ? (
          <ul className="mt-2 space-y-2">
            {assinados.map((s) => (
              <li key={s.email} className="text-xs">
                <strong>{s.name}</strong> — {s.email}
                {s.document ? ` · ${s.document}` : ""}
                <br />
                <span className="text-gray-500">
                  Assinado eletronicamente em{" "}
                  {s.signed_at ? new Date(s.signed_at).toLocaleString("pt-BR") : "—"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-gray-500">Ainda sem assinaturas registradas.</p>
        )}

        <p className="mt-6 text-[11px] leading-relaxed text-gray-500">
          Documento assinado eletronicamente, com registro de data/hora, endereço IP e
          confirmação de identidade do signatário, nos termos da MP 2.200-2/2001 e da
          Lei 14.063/2020.
        </p>
      </section>

      <div className="mt-8 print:hidden">
        <p className="text-xs text-gray-500">
          Use <strong>Imprimir → Salvar como PDF</strong> para baixar este contrato.
        </p>
      </div>
    </main>
  );
}
