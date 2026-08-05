/**
 * Bot de triagem / direcionamento inicial (D4).
 *
 * Substitui o fluxo que vivia no n8n: lead novo recebe o menu de setores,
 * escolhe, e a conversa é transferida para o departamento certo.
 *
 * Aqui é nativo — sem depender de webhook externo, que foi onde as falhas
 * ficavam silenciosas no Chatwoot.
 */

export type FlowNode = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
};
export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
};
export type Flow = { nodes: FlowNode[]; edges: FlowEdge[] };

export type SectorOption = {
  /** Rótulo mostrado ao cliente no menu. */
  label: string;
  /** Departamento que recebe a conversa. */
  departmentId: string | null;
  /** Mensagem de confirmação após a escolha. */
  confirmation: string;
};

export const DEFAULT_SECTORS: Omit<SectorOption, "departmentId">[] = [
  {
    label: "📚 Experiência do Aluno",
    confirmation:
      "Perfeito! Vou te encaminhar para a Experiência do Aluno. Em instantes alguém te atende. 😊",
  },
  {
    label: "💰 Financeiro",
    confirmation: "Certo! Encaminhando para o Financeiro. Já já te respondem. 😊",
  },
  {
    label: "📊 Consultoria Estratégica",
    confirmation:
      "Ótimo! Vou te passar para a Consultoria Estratégica. Aguarde um instante. 😊",
  },
];

// Texto igual ao do menu que rodava no n8n (nó "Envia Menu UAZAPI"), para o
// cliente não perceber troca de sistema. A única diferença é a numeração: lá
// a escolha era por botão, aqui é digitada.
export const DEFAULT_GREETING = `Hello! Seja bem-vindo(a) à LET'S GO FAR!

Para te direcionar melhor, responda com o número da opção:

1️⃣ 📚 *Experiência do Aluno*
Ajustes de agenda, organização, dúvidas gerais e questões administrativas

2️⃣ 💰 *Financeiro*
Pagamentos, notas fiscais e contratos

3️⃣ 📊 *Consultoria Estratégica*
Informações sobre programas focados em inglês para carreira e oportunidades internacionais`;

/**
 * Mesma saudação, para quando o canal suporta BOTÕES: sem numeração e sem o
 * "responda com o número", que ficariam contraditórios com botões tocáveis.
 */
export const DEFAULT_GREETING_MENU = `Hello! Seja bem-vindo(a) à LET'S GO FAR!

Para te direcionar melhor, escolha uma opção abaixo:

📚 *Experiência do Aluno*
Ajustes de agenda, organização, dúvidas gerais e questões administrativas

💰 *Financeiro*
Pagamentos, notas fiscais e contratos

📊 *Consultoria Estratégica*
Informações sobre programas focados em inglês para carreira e oportunidades internacionais`;

/**
 * Rótulo do menu → nome do departamento, quando os dois não se parecem.
 * "Consultoria Estratégica" é atendida pelo Comercial (era assim no n8n:
 * o botão `📊 Consultoria Estratégica` tinha o valor `comercial`).
 */
export const SECTOR_DEPARTMENT_ALIASES: Record<string, string> = {
  "Consultoria Estratégica": "Comercial",
  "Experiência do Aluno": "Experiência do Aluno",
  Financeiro: "Financeiro",
};

/**
 * Monta o fluxo de triagem.
 * Estrutura: início → saudação+menu → (por opção) confirma → transfere.
 */
export function buildTriagemFlow(params: {
  greeting?: string;
  /** Saudação usada quando o canal envia botões (sem numeração). */
  greetingMenu?: string;
  sectors: SectorOption[];
}): Flow {
  const { greeting = DEFAULT_GREETING, sectors } = params;

  const nodes: FlowNode[] = [
    { id: "start", type: "start", position: { x: 0, y: 0 }, data: { kind: "start", label: "Início" } },
    {
      id: "menu",
      type: "menu",
      position: { x: 0, y: 140 },
      data: {
        kind: "menu",
        label: "Menu de setores",
        content: greeting,
        // Versão sem numeração, usada quando o canal envia botões tocáveis.
        contentMenu: params.greetingMenu ?? DEFAULT_GREETING_MENU,
        sectionLabel: "Setores",
        options: sectors.map((s, i) => ({ id: `opt${i + 1}`, label: s.label })),
      },
    },
  ];

  const edges: FlowEdge[] = [{ id: "e-start-menu", source: "start", target: "menu" }];

  sectors.forEach((sector, i) => {
    const n = i + 1;
    const confirmId = `confirma${n}`;
    const transferId = `transfere${n}`;

    nodes.push({
      id: confirmId,
      type: "message",
      position: { x: (i - 1) * 260, y: 300 },
      data: { kind: "message", label: `Confirma ${sector.label}`, content: sector.confirmation },
    });
    nodes.push({
      id: transferId,
      type: "transfer",
      position: { x: (i - 1) * 260, y: 440 },
      data: {
        kind: "transfer",
        label: `Transfere ${sector.label}`,
        departmentId: sector.departmentId,
      },
    });

    // A aresta sai do handle da opção — é assim que o motor roteia a escolha.
    edges.push({
      id: `e-menu-${confirmId}`,
      source: "menu",
      target: confirmId,
      sourceHandle: `opt${n}`,
    });
    edges.push({ id: `e-${confirmId}-${transferId}`, source: confirmId, target: transferId });
  });

  return { nodes, edges };
}
