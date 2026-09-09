import { InboxLoader } from "@/components/inbox/inbox-loader";
import { getConversations, getClosedCount, getConversationById, getMessages } from "@/lib/data/conversations";
import { getTags, getAgents, getDepartments, getQuickReplies } from "@/lib/data/management";
import { getChannels } from "@/lib/data/channels";
import { getApprovedTemplates } from "@/app/(app)/atendimento/actions";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PREVIEW_MODE } from "@/lib/mock";
import { deveAssinar } from "@/lib/assinatura";

export const revalidate = 0;

export default async function AtendimentoPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const [conversations, closedCount, tags, agents, departments, quickReplies, channels, templates] = await Promise.all([
    getConversations({ includeClosed: false }),
    getClosedCount(),
    getTags("conversation"),
    getAgents(),
    getDepartments(),
    getQuickReplies(),
    getChannels(),
    getApprovedTemplates(),
  ]);
  // Deep-link ?c=<convId> (ex.: clique numa menção do sino) abre essa conversa.
  const requested = (await searchParams)?.c;
  // A lista traz só as ATIVAS. Se a menção aponta para uma conversa que já foi
  // encerrada, ela não está aqui — busca essa uma e põe na frente, em vez de
  // abrir a primeira conversa qualquer sem avisar.
  let lista = conversations;
  if (requested && !lista.some((c) => c.id === requested)) {
    const avulsa = await getConversationById(requested);
    if (avulsa) lista = [avulsa, ...lista];
  }
  const first = (requested && lista.some((c) => c.id === requested) ? requested : lista[0]?.id) ?? null;
  const initialMessages = first ? await getMessages(first) : [];

  let userId: string | null = null;
  let hideAi = false;
  let isAdmin = false;
  let identifyAgentEnabled = false;
  if (!PREVIEW_MODE) {
    const session = await getSession();
    userId = session?.userId ?? null;
    identifyAgentEnabled = deveAssinar(
      session?.profile?.identify_agent,
      (session?.organization?.settings as Record<string, unknown> | undefined)?.identify_agent,
    );
    if (userId) {
      const sb = await createClient();
      const { data: me } = await sb
        .from("profiles")
        .select("hide_ai, role, super_admin")
        .eq("id", userId)
        .maybeSingle();
      const p = me as { hide_ai?: boolean; role?: string; super_admin?: boolean } | null;
      hideAi = !!p?.hide_ai;
      // Só admin vê o conteúdo de mensagens apagadas (visão de auditoria).
      isAdmin = p?.role === "admin" || !!p?.super_admin;
    }
  }

  return (
    <InboxLoader
      initialConversations={lista}
      closedCount={closedCount}
      initialSelectedId={first}
      initialMessages={initialMessages}
      userId={userId}
      hideAi={hideAi}
      isAdmin={isAdmin}
      identifyAgentEnabled={identifyAgentEnabled}
      tags={tags}
      agents={agents}
      departments={departments}
      channels={channels}
      quickReplies={quickReplies.map((q) => ({ title: q.title, content: q.content, shortcut: q.shortcut }))}
      templates={templates}
      live={!PREVIEW_MODE}
    />
  );
}
