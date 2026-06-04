import type { createServiceClient } from "@/lib/supabase/server";
import { sgpForOrg, type SgpClient } from "@/lib/sgp";

type DB = ReturnType<typeof createServiceClient>;

/** Configuração do agente de IA (tabela ai_agents). */
export interface AiAgentConfig {
  prompt: string;
  model: string;
  temperature: number;
  knowledge?: string;
}

/** Decisão de controle do fluxo após um turno do agente. */
export type AiDecision = "wait" | "transfer" | "done";

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/** Lê o agente de IA ativo da organização (casando o canal, ou global). */
export async function getAiAgent(db: DB, orgId: string, channelId: string): Promise<AiAgentConfig | null> {
  const { data } = await db
    .from("ai_agents")
    .select("prompt, model, config, active, channel_id")
    .eq("organization_id", orgId)
    .eq("active", true)
    .or(`channel_id.eq.${channelId},channel_id.is.null`)
    .order("channel_id", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const cfg = (data.config ?? {}) as { temperature?: number; knowledge?: string };
  return {
    prompt: (data.prompt as string) || "",
    model: (data.model as string) || "gpt-4o-mini",
    temperature: typeof cfg.temperature === "number" ? cfg.temperature : 0.4,
    knowledge: cfg.knowledge,
  };
}

/* ----------------------------- ferramentas (tools) ----------------------------- */

const TOOLS = [
  {
    type: "function",
    function: {
      name: "consultar_cliente",
      description:
        "Consulta o cadastro do assinante no SGP por CPF/CNPJ, telefone ou número de contrato. Use para identificar o cliente e listar seus contratos.",
      parameters: {
        type: "object",
        properties: {
          cpfcnpj: { type: "string", description: "CPF ou CNPJ (só números)" },
          telefone: { type: "string", description: "Telefone com DDD" },
          contrato: { type: "number", description: "Número do contrato (contratoId)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "faturas_em_aberto",
      description: "Lista as faturas/títulos em aberto (vencidos ou a vencer) de um contrato ou CPF/CNPJ.",
      parameters: {
        type: "object",
        properties: {
          contrato: { type: "number" },
          cpfcnpj: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "segunda_via",
      description: "Gera a 2ª via das faturas (linha digitável + link de pagamento) de um contrato ou CPF/CNPJ.",
      parameters: {
        type: "object",
        properties: {
          contrato: { type: "number" },
          cpfcnpj: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gerar_pix",
      description: "Gera o código PIX copia-e-cola de uma fatura específica.",
      parameters: {
        type: "object",
        properties: {
          fatura: { type: "number", description: "Número da fatura" },
          contrato: { type: "number" },
        },
        required: ["fatura"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "liberacao_confianca",
      description:
        "Libera o acesso à internet por confiança (promessa de pagamento) para um contrato bloqueado por falta de pagamento. Use quando o cliente pede para desbloquear prometendo pagar.",
      parameters: {
        type: "object",
        properties: { contrato: { type: "number" } },
        required: ["contrato"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "status_conexao",
      description: "Verifica se a conexão do contrato está online/offline (diagnóstico de sem internet).",
      parameters: {
        type: "object",
        properties: { contrato: { type: "number" }, telefone: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "abrir_chamado",
      description:
        "Abre um chamado/ordem de serviço de suporte técnico para um contrato (ex.: defeito persistente que a IA não resolveu).",
      parameters: {
        type: "object",
        properties: {
          contrato: { type: "number" },
          ocorrenciatipo: { type: "number", description: "Tipo de ocorrência (id). Use 1 se não souber." },
          conteudo: { type: "string", description: "Descrição do problema relatado pelo cliente." },
        },
        required: ["contrato", "conteudo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "transferir_para_humano",
      description:
        "Transfere o atendimento para um atendente humano quando você não consegue resolver, o cliente pede um humano, ou o assunto exige intervenção manual.",
      parameters: {
        type: "object",
        properties: { motivo: { type: "string", description: "Motivo da transferência." } },
        required: ["motivo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finalizar_atendimento",
      description: "Encerra o atendimento quando o problema do cliente foi resolvido e ele não precisa de mais nada.",
      parameters: {
        type: "object",
        properties: { resumo: { type: "string", description: "Breve resumo do que foi resolvido." } },
      },
    },
  },
] as const;

/** Executa uma ferramenta do SGP e devolve um resultado serializável p/ o modelo. */
async function executeTool(name: string, args: Record<string, unknown>, sgp: SgpClient | null): Promise<unknown> {
  if (name === "transferir_para_humano" || name === "finalizar_atendimento") {
    return { ok: true };
  }
  if (!sgp) {
    return { erro: "Integração SGP não configurada. Não é possível consultar o sistema." };
  }
  const num = (v: unknown) => (v == null ? undefined : Number(v));
  const str = (v: unknown) => (v == null ? undefined : String(v));
  try {
    switch (name) {
      case "consultar_cliente": {
        const c = await sgp.consultarCliente({
          cpfcnpj: str(args.cpfcnpj),
          telefone: str(args.telefone),
          contrato: num(args.contrato),
        });
        return {
          encontrado: c.encontrado,
          nome: c.nome,
          cpfcnpj: c.cpfcnpj,
          contratos: c.contratos.map((ct) => ({
            contrato: ct.contrato,
            status: ct.status,
            plano: ct.plano,
            valorEmAberto: ct.valorEmAberto,
            endereco: ct.endereco,
          })),
        };
      }
      case "faturas_em_aberto": {
        const t = await sgp.titulosEmAberto({ contrato: num(args.contrato), cpfcnpj: str(args.cpfcnpj) });
        return {
          faturas: t.map((f) => ({
            fatura: f.fatura,
            valor: f.valor,
            vencimento: f.vencimento,
            diasAtraso: f.diasAtraso,
            linhaDigitavel: f.linhaDigitavel,
          })),
        };
      }
      case "segunda_via": {
        const sv = await sgp.segundaVia({ contrato: num(args.contrato), cpfcnpj: str(args.cpfcnpj) });
        return { ok: sv.ok, protocolo: sv.protocolo, faturas: sv.faturas };
      }
      case "gerar_pix": {
        const px = await sgp.gerarPix(num(args.fatura)!, num(args.contrato));
        return { ok: px.ok, codigoPix: px.codigoPix };
      }
      case "liberacao_confianca": {
        const r = await sgp.liberacaoConfianca({ contrato: num(args.contrato)! });
        return { ok: r.ok, protocolo: r.protocolo, mensagem: r.mensagem };
      }
      case "status_conexao": {
        const r = await sgp.statusConexao({ contrato: num(args.contrato), telefone: str(args.telefone) });
        return { online: r.online, mensagem: r.mensagem };
      }
      case "abrir_chamado": {
        const r = await sgp.abrirChamado({
          contrato: num(args.contrato)!,
          ocorrenciatipo: num(args.ocorrenciatipo) ?? 1,
          conteudo: str(args.conteudo),
        });
        return { ok: r.ok, protocolo: r.protocolo, mensagem: r.mensagem };
      }
      default:
        return { erro: `Ferramenta desconhecida: ${name}` };
    }
  } catch (e) {
    return { erro: (e as Error)?.message ?? "Falha ao executar a ferramenta." };
  }
}

/* ----------------------------- loop do agente ----------------------------- */

export interface AiTurnContext {
  db: DB;
  organizationId: string;
  conversationId: string;
  contactPhone: string;
  contactName?: string | null;
  agent: AiAgentConfig;
  nodeInstruction?: string;
  userText: string;
  /** Envia a mensagem ao cliente (e registra como mensagem do bot). */
  sendToCustomer: (text: string) => Promise<void>;
}

/** Roda UM turno do agente de IA (uma mensagem do cliente → resposta + ações). */
export async function runAiTurn(ctx: AiTurnContext): Promise<AiDecision> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await ctx.sendToCustomer("No momento não consigo te atender automaticamente. Vou te transferir para um atendente.");
    return "transfer";
  }

  const sgp = await sgpForOrg(ctx.db, ctx.organizationId).catch(() => null);

  // Histórico recente (exclui notas internas).
  const { data: hist } = await ctx.db
    .from("messages")
    .select("direction, sender_type, body, content_type, is_internal")
    .eq("conversation_id", ctx.conversationId)
    .order("created_at", { ascending: true })
    .limit(30);

  const history: OpenAIMessage[] = ((hist ?? []) as {
    direction: string;
    sender_type: string;
    body: string | null;
    content_type: string;
    is_internal?: boolean;
  }[])
    .filter((m) => !m.is_internal)
    .map((m): OpenAIMessage => ({
      role: m.sender_type === "contact" ? "user" : "assistant",
      content: m.body ?? (m.content_type !== "text" ? `[${m.content_type}]` : ""),
    }))
    .filter((m) => m.content);

  const system = [
    ctx.agent.prompt?.trim() ||
      "Você é um atendente virtual cordial e objetivo de um provedor de internet. Ajude o cliente usando as ferramentas do sistema (SGP). Responda em português do Brasil, de forma curta e clara para WhatsApp.",
    ctx.agent.knowledge?.trim() ? `\n\nBase de conhecimento:\n${ctx.agent.knowledge.trim()}` : "",
    ctx.nodeInstruction?.trim() ? `\n\nInstrução desta etapa: ${ctx.nodeInstruction.trim()}` : "",
    `\n\nDados do contato atual — nome: ${ctx.contactName ?? "desconhecido"}; telefone: ${ctx.contactPhone}.`,
    "\n\nRegras: nunca invente dados; sempre confirme via ferramentas. Se não puder resolver ou o cliente pedir um humano, use transferir_para_humano. Quando o problema for resolvido, use finalizar_atendimento. Envie códigos PIX e linhas digitáveis em mensagem própria, sem formatação extra.",
  ].join("");

  const messages: OpenAIMessage[] = [
    { role: "system", content: system },
    ...history,
  ];
  // Garante que a última mensagem do usuário esteja presente (caso ainda não no histórico).
  if (history[history.length - 1]?.content !== ctx.userText && ctx.userText.trim()) {
    messages.push({ role: "user", content: ctx.userText });
  }

  let decision: AiDecision = "wait";

  for (let step = 0; step < 6; step++) {
    let data: { choices?: { message: OpenAIMessage }[] };
    try {
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ctx.agent.model || "gpt-4o-mini",
          temperature: ctx.agent.temperature,
          messages,
          tools: TOOLS,
        }),
      });
      if (!res.ok) {
        console.error("openai", res.status, (await res.text()).slice(0, 300));
        await ctx.sendToCustomer("Tive um problema técnico. Vou te transferir para um atendente.");
        return "transfer";
      }
      data = await res.json();
    } catch (e) {
      console.error("openai net", (e as Error)?.message);
      await ctx.sendToCustomer("Tive um problema técnico. Vou te transferir para um atendente.");
      return "transfer";
    }

    const choice = data.choices?.[0]?.message;
    if (!choice) break;
    messages.push(choice);

    if (choice.tool_calls?.length) {
      for (const tc of choice.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          /* ignora args inválidos */
        }
        if (tc.function.name === "transferir_para_humano") decision = "transfer";
        if (tc.function.name === "finalizar_atendimento") decision = "done";
        const result = await executeTool(tc.function.name, args, sgp);
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      continue; // deixa o modelo redigir a resposta ao cliente após as ferramentas
    }

    // Sem tool calls → resposta final ao cliente.
    if (choice.content?.trim()) await ctx.sendToCustomer(choice.content.trim());
    break;
  }

  return decision;
}
