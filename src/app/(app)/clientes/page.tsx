import { Scroll } from "@/components/scroll";
import { PageHeader, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";
import { formatPhone } from "@/lib/utils";
import Link from "next/link";
import { Download, MessageSquareText } from "lucide-react";
import { BuscaContatos } from "@/components/busca-contatos";

const POR_PAGINA = 100;

/**
 * Busca no banco, não na tela.
 *
 * A versão anterior trazia 500 contatos e não tinha campo de busca — com 1.032
 * cadastrados, metade simplesmente não aparecia, e achar alguém salvo só pela
 * rolagem era impossível. Era isso que a Luana procurava quando disse que "no
 * Chatwoot tinha uma parte só de contatos".
 */
async function getContacts(termo: string, pagina: number) {
  if (PREVIEW_MODE) return { linhas: [], total: 0 };
  const sb = await createClient();
  let q = sb
    .from("contacts")
    .select("id, name, phone, email, city, avatar_url, created_at", { count: "exact" })
    .neq("is_group", true);

  if (termo) {
    // Telefone é comparado só por dígitos: quem busca "71 99999-9999" digita a
    // máscara, e o banco guarda cru.
    const digitos = termo.replace(/\D/g, "");
    const alvos = [`name.ilike.%${termo}%`, `email.ilike.%${termo}%`];
    if (digitos) alvos.push(`phone.ilike.%${digitos}%`);
    q = q.or(alvos.join(","));
  }

  const de = (pagina - 1) * POR_PAGINA;
  const { data, count } = await q.order("name").range(de, de + POR_PAGINA - 1);
  return { linhas: data ?? [], total: count ?? 0 };
}

/** Última conversa de cada contato, para o botão "abrir conversa". */
async function getConversas(ids: string[]) {
  if (PREVIEW_MODE || !ids.length) return {} as Record<string, string>;
  const sb = await createClient();
  const { data } = await sb
    .from("conversations")
    .select("id, contact_id, last_message_at")
    .in("contact_id", ids)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  const mapa: Record<string, string> = {};
  for (const c of (data ?? []) as { id: string; contact_id: string }[]) {
    if (!mapa[c.contact_id]) mapa[c.contact_id] = c.id;
  }
  return mapa;
}

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string }>;
}) {
  const sp = await searchParams;
  const termo = (sp.q ?? "").trim();
  const pagina = Math.max(1, Number(sp.p ?? 1) || 1);

  const { linhas, total } = await getContacts(termo, pagina);
  const conversas = await getConversas(linhas.map((c) => c.id));
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <Scroll>
      <PageHeader
        title="Contatos"
        subtitle={
          termo
            ? `${total} contato(s) para "${termo}".`
            : `${total} contatos cadastrados. Busque por nome, telefone ou e-mail.`
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <BuscaContatos termoInicial={termo} />
        <Link
          href="/api/export-contacts"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink transition hover:border-brand hover:text-brand"
        >
          <Download size={14} /> Exportar CSV
        </Link>
      </div>

      {linhas.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-sm text-ink-soft">
            {termo ? `Nenhum contato encontrado para "${termo}".` : "Nenhum contato cadastrado."}
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-gray-50 text-left text-xs font-medium text-ink-soft">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Cidade</th>
                <th className="px-4 py-3 text-right">Desde</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {linhas.map((c) => (
                <tr key={c.id} className="border-b border-border hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {c.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-[10px] font-semibold text-gray-600">
                          {(c.name ?? "?").slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <span className="font-medium text-ink">{c.name ?? "—"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{formatPhone(c.phone)}</td>
                  <td className="px-4 py-3 text-ink-soft">{c.email ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{c.city ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-ink-soft">
                    {new Date(c.created_at).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {/* Achar o contato só serve se der para falar com ele. */}
                    {conversas[c.id] && (
                      <Link
                        href={`/atendimento?c=${conversas[c.id]}`}
                        title="Abrir conversa"
                        className="inline-flex items-center gap-1 rounded-lg bg-brand/10 px-2 py-1 text-xs font-medium text-brand transition hover:bg-brand/20"
                      >
                        <MessageSquareText size={13} /> Conversa
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paginas > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          {pagina > 1 && (
            <Link
              href={`/clientes?${new URLSearchParams({ ...(termo ? { q: termo } : {}), p: String(pagina - 1) })}`}
              className="rounded-lg border border-border px-3 py-1.5 text-ink-soft hover:text-ink"
            >
              ← anterior
            </Link>
          )}
          <span className="text-ink-soft">
            página {pagina} de {paginas}
          </span>
          {pagina < paginas && (
            <Link
              href={`/clientes?${new URLSearchParams({ ...(termo ? { q: termo } : {}), p: String(pagina + 1) })}`}
              className="rounded-lg border border-border px-3 py-1.5 text-ink-soft hover:text-ink"
            >
              próxima →
            </Link>
          )}
        </div>
      )}
    </Scroll>
  );
}
