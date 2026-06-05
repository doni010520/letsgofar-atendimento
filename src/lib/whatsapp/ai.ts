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

/** Setor de destino quando o agente transfere para humano. */
export type AiSetor = "financeiro" | "suporte" | "comercial";

/** Resultado de um turno do agente. */
export interface AiTurnResult {
  decision: AiDecision;
  /** Preenchido quando decision === "transfer". */
  transfer?: { setor?: AiSetor; cidade?: string; motivo?: string };
  /** Resumo, quando o agente finaliza. */
  summary?: string;
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const BUSINESS_HOURS = "Segunda a sexta: das 07:30 às 21:00\nSábado: das 07:30 às 17:30\n(Domingos e feriados: fechado)";

/** Hora atual no fuso da operação (Bahia, sem horário de verão). */
function nowBR(): { saudacao: string; descricao: string } {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", hour: "2-digit", hour12: false }).format(now),
  );
  const descricao = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const saudacao = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  return { saudacao, descricao };
}

/**
 * Prompt padrão do agente da MVF NET — encoda o comportamento observado no
 * Chatmix real (ver AI_AGENT_BRIEF.md / AI_PATTERN.md). Usado quando o agente
 * não tem `prompt` próprio configurado. Tom, mensagens verbatim, fluxo e
 * gatilhos de transferência seguem o original.
 */
function defaultMvfPrompt(): string {
  const { saudacao } = nowBR();
  return `Você é o atendente virtual da *MVF NET*, um provedor de internet (ISP). Você atende o PRIMEIRO contato no WhatsApp. Fale em português do Brasil, tom cordial e objetivo, mensagens curtas para WhatsApp. Use *negrito* (asteriscos) do WhatsApp para destacar e emojis com moderação (😊🕐💬🚀).

FLUXO QUE VOCÊ DEVE SEGUIR (não pule etapas):
1. SAUDAÇÃO (só na primeira mensagem): "${saudacao}\\nBem vindo ao atendimento virtual da *MVF NET*". Ajuste Bom dia/Boa tarde/Boa noite ao horário atual informado abaixo.
2. QUALIFICAÇÃO: pergunte "Só para confirmar, você já é nosso cliente? Basta me dizer *Sim* ou *Não*!".
   - Se NÃO for cliente → é um lead: diga que vai levar ao setor comercial e use transferir_para_humano(setor="comercial").
   - Se SIM → siga para o passo 3.
3. COLETA DE DOCUMENTO: peça "Por favor, informe o *CPF* ou *CNPJ* para o qual deseja atendimento.".
4. VALIDAÇÃO: chame a tool consultar_cliente com o CPF/CNPJ informado.
   - Não encontrado/ inválido → "Ops!! O *CPF/CNPJ* informado é invalido." e peça de novo. Após 2 tentativas sem sucesso, use transferir_para_humano(setor="suporte", motivo="cliente não localizado no sistema").
   - Encontrado → responda "Um momento por favor" e em seguida "Como posso ajudar?". Guarde o número do contrato (contratoId) para as próximas ações.
5. INTENÇÃO (interprete a mensagem do cliente):
   - FINANCEIRO / 2ª via / pagamento: se o cliente quer pagar ou pedir boleto, use faturas_em_aberto e segunda_via para enviar o link de pagamento e a linha digitável; se ele quiser PIX, use gerar_pix. Se o cliente ENVIAR um COMPROVANTE (imagem/PDF), responda "Recebemos seu comprovante. Muito obrigado!", registre com registrar_comprovante e transfira para o financeiro com transferir_para_humano(setor="financeiro").
   - SUPORTE TÉCNICO (internet ruim/sem conexão): faça a TRIAGEM você mesmo, conversando:
       a) "A sua conexão está com problema apenas no *cabo*, apenas no *Wi-Fi* ou nos *dois*?"
       b) Se Wi-Fi: pergunte se está longe do roteador, se há paredes/móveis no caminho, se o roteador está dentro de rack/atrás de móvel.
       c) Proponha reiniciar o equipamento: "Vamos reiniciar seu equipamento rapidinho para tentar normalizar a conexão, tudo bem? 😊" e depois "Aguarde cerca de 1 minuto até ele estabilizar e me avise se melhorou.".
       d) Você pode usar status_conexao(contrato) para checar se o serviço está online.
       e) Se NÃO resolver, ou o cliente pedir um especialista/humano → transferir_para_humano(setor="suporte"). Se for um defeito que precisa de visita técnica, use abrir_chamado antes de transferir.
   - COMERCIAL (instalação, novo plano, mudança de plano): "Claro! Vou levar sua solicitação para o setor comercial para verificar as opções." → transferir_para_humano(setor="comercial").
   - DESBLOQUEIO / liberação por confiança: se o cliente está bloqueado por falta de pagamento e promete pagar, você pode usar liberacao_confianca(contrato).

PIX da empresa (quando o cliente pedir como pagar): "Caso precise fazer o pagamento, pode ser via PIX:\\n*PIX CNPJ 07.861.662/0001-03\\nSEZA E CRUZ LTDA ou MVF NETWORK*".

GATILHOS DE TRANSFERÊNCIA (use transferir_para_humano):
- O cliente pede explicitamente falar com atendente/humano/especialista.
- CPF/CNPJ inválido após 2 tentativas.
- Comprovante de pagamento recebido (→ financeiro).
- Intenção comercial (→ comercial).
- Triagem de suporte não resolvida (→ suporte).
Sempre escolha o setor correto (financeiro, suporte ou comercial). Quando souber a cidade do cliente, informe-a na transferência.

REGRAS:
- Nunca invente dados do cliente, faturas, valores ou status — sempre obtenha pelas tools do SGP.
- Não prometa prazos de atendimento além de informar o HORÁRIO DE ATENDIMENTO:\n${BUSINESS_HOURS}
- Envie códigos PIX e linhas digitáveis em uma mensagem própria, sem texto extra junto, para o cliente copiar fácil.
- Seja breve. Não repita a saudação a cada mensagem.`;
}

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
      name: "registrar_comprovante",
      description:
        "Registra que o cliente enviou um comprovante de pagamento (imagem/PDF). Use antes de transferir para o financeiro.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "transferir_para_humano",
      description:
        "Transfere o atendimento para o POOL de atendentes de um departamento quando você não consegue resolver, o cliente pede um humano, ou o assunto exige intervenção manual. Escolha o setor correto.",
      parameters: {
        type: "object",
        properties: {
          setor: {
            type: "string",
            enum: ["financeiro", "suporte", "comercial"],
            description: "Departamento de destino conforme a intenção do cliente.",
          },
          cidade: { type: "string", description: "Cidade do cliente (ex.: IGUAI, IBICUI, CANAA), quando souber." },
          motivo: { type: "string", description: "Motivo curto da transferência." },
        },
        required: ["setor", "motivo"],
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
  if (name === "transferir_para_humano" || name === "finalizar_atendimento" || name === "registrar_comprovante") {
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
export async function runAiTurn(ctx: AiTurnContext): Promise<AiTurnResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await ctx.sendToCustomer("No momento não consigo te atender automaticamente. Vou te transferir para um atendente.");
    return { decision: "transfer", transfer: { motivo: "IA indisponível (sem chave OpenAI)" } };
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

  const { saudacao, descricao } = nowBR();
  const system = [
    ctx.agent.prompt?.trim() || defaultMvfPrompt(),
    ctx.agent.knowledge?.trim() ? `\n\nBase de conhecimento:\n${ctx.agent.knowledge.trim()}` : "",
    ctx.nodeInstruction?.trim() ? `\n\nInstrução desta etapa: ${ctx.nodeInstruction.trim()}` : "",
    `\n\nMomento atual: ${descricao} (horário de Brasília). Saudação adequada agora: "${saudacao}".`,
    `\nDados do contato atual — nome: ${ctx.contactName ?? "desconhecido"}; telefone: ${ctx.contactPhone}.`,
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
  let transfer: AiTurnResult["transfer"];
  let summary: string | undefined;

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
        return { decision: "transfer", transfer: { motivo: "erro técnico no agente" } };
      }
      data = await res.json();
    } catch (e) {
      console.error("openai net", (e as Error)?.message);
      await ctx.sendToCustomer("Tive um problema técnico. Vou te transferir para um atendente.");
      return { decision: "transfer", transfer: { motivo: "erro técnico no agente" } };
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
        if (tc.function.name === "transferir_para_humano") {
          decision = "transfer";
          const setor = typeof args.setor === "string" ? (args.setor as AiSetor) : undefined;
          transfer = {
            setor,
            cidade: typeof args.cidade === "string" ? args.cidade : undefined,
            motivo: typeof args.motivo === "string" ? args.motivo : undefined,
          };
        }
        if (tc.function.name === "finalizar_atendimento") {
          decision = "done";
          summary = typeof args.resumo === "string" ? args.resumo : undefined;
        }
        const result = await executeTool(tc.function.name, args, sgp);
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      continue; // deixa o modelo redigir a resposta ao cliente após as ferramentas
    }

    // Sem tool calls → resposta final ao cliente.
    if (choice.content?.trim()) await ctx.sendToCustomer(choice.content.trim());
    break;
  }

  return { decision, transfer, summary };
}
