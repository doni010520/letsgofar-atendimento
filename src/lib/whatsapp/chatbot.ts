import type { createServiceClient } from "@/lib/supabase/server";
import { getProvider } from "./index";
import type { Channel } from "@/lib/types";

type DB = ReturnType<typeof createServiceClient>;

interface FlowNode {
  id: string;
  data?: { kind?: string; content?: string; label?: string };
}
interface FlowEdge {
  source: string;
  target: string;
}
interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface ConvState {
  id: string;
  organization_id: string;
  channel_id: string;
  contact_phone: string;
  is_group: boolean;
  bot_node_id: string | null;
}

const node = (f: Flow, id: string) => f.nodes.find((n) => n.id === id);
const outgoing = (f: Flow, id: string) => f.edges.filter((e) => e.source === id);
const startNode = (f: Flow) => f.nodes.find((n) => n.data?.kind === "start") ?? f.nodes.find((n) => n.id === "start");
const kindOf = (n?: FlowNode) => n?.data?.kind ?? "message";

/**
 * Executa o fluxo de automação para uma conversa, a partir do estado salvo
 * (bot_node_id) e da última mensagem do contato. Envia as mensagens dos nós,
 * pausa em "menu" (aguarda resposta), resolve "condition" pela mensagem,
 * e em "transfer" / fim entrega para a fila humana.
 *
 * Retorna o novo status sugerido para a conversa: "bot" (segue no bot),
 * "queued" (transferida p/ humano) ou null (sem mudança).
 */
export async function runChatbot(
  db: DB,
  channel: Channel,
  conv: ConvState,
  automation: { id: string; flow: Flow },
  userText: string,
): Promise<"bot" | "queued" | null> {
  const flow: Flow = {
    nodes: Array.isArray(automation.flow?.nodes) ? automation.flow.nodes : [],
    edges: Array.isArray(automation.flow?.edges) ? automation.flow.edges : [],
  };
  if (!flow.nodes.length) return null;

  const provider = getProvider(channel);
  const to = conv.is_group && channel.type === "uazapi" ? `${conv.contact_phone}@g.us` : conv.contact_phone;

  const send = async (text: string) => {
    if (!text?.trim()) return;
    const res = await provider.sendText({ to, text }).catch(() => ({ externalId: undefined }));
    await db.from("messages").insert({
      organization_id: conv.organization_id,
      conversation_id: conv.id,
      direction: "out",
      sender_type: "bot",
      content_type: "text",
      body: text,
      external_id: res.externalId ?? null,
      status: "sent",
    });
  };

  // Descobre o nó atual a processar.
  let currentId: string | null;
  if (!conv.bot_node_id) {
    const start = startNode(flow);
    currentId = start ? outgoing(flow, start.id)[0]?.target ?? null : null;
  } else {
    // Estamos parados num nó (menu/condition) aguardando a mensagem do contato → escolhe o ramo.
    const cur = node(flow, conv.bot_node_id);
    const outs = outgoing(flow, conv.bot_node_id);
    const txt = userText.trim().toLowerCase();
    let chosen: FlowEdge | undefined;
    if (kindOf(cur) === "menu") {
      const n = parseInt(txt, 10);
      chosen =
        !Number.isNaN(n) && outs[n - 1]
          ? outs[n - 1]
          : outs.find((o) => (node(flow, o.target)?.data?.label ?? "").toLowerCase().includes(txt));
      if (!chosen) {
        await send("Opção inválida. Responda com o número da opção desejada.");
        return "bot";
      }
    } else if (kindOf(cur) === "condition") {
      const keys = (cur?.data?.content ?? "").toLowerCase().split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
      const match = keys.some((k) => txt.includes(k));
      chosen = match ? outs[0] : outs[1] ?? outs[0];
    } else {
      chosen = outs[0];
    }
    currentId = chosen?.target ?? null;
  }

  // Caminha pelos nós, enviando mensagens, até pausar (menu) ou terminar/transferir.
  let guard = 0;
  while (currentId && guard++ < 25) {
    const n = node(flow, currentId);
    if (!n) break;
    const k = kindOf(n);

    if (k === "message" || k === "ai") {
      await send(n.data?.content ?? "");
      const next = outgoing(flow, currentId)[0];
      if (!next) {
        await clearState(db, conv.id);
        return "queued";
      }
      currentId = next.target;
      continue;
    }
    if (k === "menu") {
      await send(n.data?.content ?? "");
      await saveState(db, conv.id, automation.id, currentId);
      return "bot";
    }
    if (k === "condition") {
      // Sem nova entrada aqui: avalia pela última mensagem e segue.
      const keys = (n.data?.content ?? "").toLowerCase().split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
      const match = keys.some((key) => userText.toLowerCase().includes(key));
      const outs = outgoing(flow, currentId);
      currentId = (match ? outs[0] : outs[1] ?? outs[0])?.target ?? null;
      continue;
    }
    if (k === "transfer") {
      await send(n.data?.content ?? "");
      await clearState(db, conv.id);
      return "queued";
    }
    if (k === "wait") {
      // v1: não pausa em tempo real; apenas segue para o próximo nó.
      currentId = outgoing(flow, currentId)[0]?.target ?? null;
      continue;
    }
    break;
  }
  await clearState(db, conv.id);
  return "queued";
}

async function saveState(db: DB, convId: string, automationId: string, nodeId: string) {
  await db.from("conversations").update({ bot_automation_id: automationId, bot_node_id: nodeId, status: "bot" }).eq("id", convId);
}
async function clearState(db: DB, convId: string) {
  await db.from("conversations").update({ bot_node_id: null }).eq("id", convId);
}
