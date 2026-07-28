"use server";

import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_COPILOT_MODEL ?? "gpt-4o-mini";

type Msg = { direction: string; body: string | null };

async function ask(system: string, user: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}

/** Transcrição enxuta da conversa, para dar contexto ao modelo. */
async function transcript(conversationId: string, limit = 20): Promise<string> {
  const sb = await createClient();
  const { data } = await sb
    .from("messages")
    .select("direction, body")
    .eq("conversation_id", conversationId)
    .eq("is_internal", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  return ((data as Msg[]) ?? [])
    .reverse()
    .filter((m) => (m.body ?? "").trim())
    .map((m) => `${m.direction === "in" ? "Cliente" : "Atendente"}: ${m.body}`)
    .join("\n");
}

/**
 * Copiloto (B7): sugere uma resposta para o atendente.
 * Devolve texto para o atendente revisar — nunca envia sozinho.
 */
export async function suggestReply(conversationId: string, instruction?: string) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");

  const chat = await transcript(conversationId);
  if (!chat) return { text: null, error: "Ainda não há conversa para analisar." };

  const text = await ask(
    `Você ajuda atendentes de uma escola de idiomas brasileira a responder no WhatsApp.
Escreva em português do Brasil, em tom cordial e direto, no máximo 3 frases curtas.
Não invente preços, prazos, datas ou promessas que não estejam na conversa.
Responda apenas com a mensagem sugerida, sem aspas e sem comentários.`,
    `Conversa até agora:\n${chat}\n\n${
      instruction?.trim()
        ? `O atendente quer responder assim: "${instruction.trim()}". Reescreva de forma clara e cordial.`
        : "Sugira a próxima resposta do atendente."
    }`,
  );

  if (!text) return { text: null, error: "Copiloto indisponível (configure OPENAI_API_KEY)." };
  return { text, error: null };
}

/**
 * Sugestão automática de etiquetas (B7): escolhe entre as etiquetas
 * existentes da organização — não cria etiqueta nova.
 */
export async function suggestLabels(conversationId: string) {
  const session = await getSession();
  if (!session?.organization) throw new Error("Sessão inválida.");
  const sb = await createClient();

  const { data: tags } = await sb.from("tags").select("id, name").order("name");
  const list = (tags as { id: string; name: string }[]) ?? [];
  if (!list.length) return { tags: [], error: "Nenhuma etiqueta cadastrada." };

  const chat = await transcript(conversationId, 15);
  if (!chat) return { tags: [], error: "Ainda não há conversa para analisar." };

  const answer = await ask(
    `Classifique a conversa escolhendo APENAS entre as etiquetas informadas.
Responda somente com os nomes escolhidos, separados por vírgula. No máximo 3.
Se nenhuma servir, responda "nenhuma".`,
    `Etiquetas disponíveis: ${list.map((t) => t.name).join(", ")}\n\nConversa:\n${chat}`,
  );

  if (!answer) return { tags: [], error: "Copiloto indisponível (configure OPENAI_API_KEY)." };

  const escolhidas = answer
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "nenhuma");

  return {
    tags: list.filter((t) => escolhidas.includes(t.name.toLowerCase())),
    error: null,
  };
}
