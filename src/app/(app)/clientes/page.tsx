import { Scroll } from "@/components/scroll";
import { PageHeader, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";
import { formatPhone } from "@/lib/utils";
import Link from "next/link";
import { Download, MessageSquareText } from "lucide-react";
import { BuscaContatos } from "@/components/busca-contatos";
import { AddToCrm } from "@/components/add-to-crm";

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
    .select("id, name, phone, email, city, avatar_url, created_at, stage_id", { count: "exact" })
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

/** Estágios do funil, para o botão "adicionar ao funil" de cada linha. */
async function getStages() {
  if (PREVIEW_MODE) return [] as { id: string; name: string }[];
  const sb = await createClient();
  const { data } = await sb.from("pipeline_stages").select("id, name").order("position");
  return (data ?? []) as { id: string; name: string }[];
}

/**
 * Última conversa de cada contato: serve ao botão "abrir conversa" e também ao
 * estágio do funil.
 *
 * O estágio vem da CONVERSA, não de `contacts.stage_id`: os cards importados do
 * Chatwoot gravaram só a conversa, e o kanban lê dela ([crm/page.tsx]). Ler do
 * contato mostraria "fora do funil" para quem já tem card.
 */
async function getConversas(ids: string[]) {
  if (PREVIEW_MODE || !ids.length)
    return {} as Record<string, { id: string; stageId: string | null }>;
  const sb = await createClient();
  const { data } = await sb
    .from("conversations")
    .select("id, contact_id, stage_id, last_message_at")
    .in("contact_id", ids)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  const mapa: Record<string, { id: string; stageId: string | null }> = {};
  for (const c of (data ?? []) as { id: string; contact_id: string; stage_id: string | null }[]) {
    if (!mapa[c.contact_id]) mapa[c.contact_id] = { id: c.id, stageId: c.stage_id };
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
  const stages = await getStages();
  const nomeDoEstagio = Object.fromEntries(stages.map((s) => [s.id, s.name]));
  // Conversa manda; o campo do contato só serve de reserva para quem ainda não
  // tem conversa aberta.
  const estagioDe = (c: { id: string; stage_id: string | null }) =>
    conversas[c.id]?.stageId ?? c.stage_id ?? null;
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
              {/* No celular ficam só nome, telefone e o botão da conversa: com
                  seis colunas a tabela ficava mais larga que a tela e o nome
                  saía cortado no meio. E-mail, cidade e data voltam no
                  computador, onde há espaço. */}
              <tr className="border-b border-border bg-gray-50 text-left text-xs font-medium text-ink-soft">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="hidden px-4 py-3 md:table-cell">E-mail</th>
                <th className="hidden px-4 py-3 lg:table-cell">Cidade</th>
                <th className="hidden px-4 py-3 text-right lg:table-cell">Desde</th>
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
                  <td className="hidden px-4 py-3 text-ink-soft md:table-cell">{c.email ?? "—"}</td>
                  <td className="hidden px-4 py-3 text-ink-soft lg:table-cell">{c.city ?? "—"}</td>
                  <td className="hidden px-4 py-3 text-right text-ink-soft lg:table-cell">
                    {new Date(c.created_at).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                    {/* Onde o contato entra no funil: sem isto, só entrava quem
                        veio da importação do Chatwoot. */}
                    <AddToCrm
                      contactId={c.id}
                      stageId={estagioDe(c)}
                      stageName={estagioDe(c) ? nomeDoEstagio[estagioDe(c)!] ?? null : null}
                      stages={stages}
                    />
                    {/* Achar o contato só serve se der para falar com ele. */}
                    {conversas[c.id] && (
                      <Link
                        href={`/atendimento?c=${conversas[c.id].id}`}
                        title="Abrir conversa"
                        className="inline-flex items-center gap-1 rounded-lg bg-brand/10 px-2 py-1 text-xs font-medium text-brand transition hover:bg-brand/20"
                      >
                        <MessageSquareText size={13} /> Conversa
                      </Link>
                    )}
                    </div>
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
