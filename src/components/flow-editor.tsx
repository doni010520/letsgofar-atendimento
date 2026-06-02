"use client";

import { useCallback, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, addEdge,
  type Node, type Edge, type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import { MessageSquare, ListChecks, GitBranch, UserCheck, Bot, Clock, Save, Plus, X, Trash2 } from "lucide-react";
import { updateAutomationFlow } from "@/app/(app)/automacoes/actions";

const NODE_KINDS: Record<string, { label: string; color: string }> = {
  start: { label: "Início", color: "#10b981" },
  message: { label: "Mensagem", color: "#00a8ff" },
  menu: { label: "Menu / Opções", color: "#8b5cf6" },
  condition: { label: "Condição", color: "#f59e0b" },
  transfer: { label: "Transferir p/ humano", color: "#ef4444" },
  ai: { label: "Agente de IA", color: "#0ea5e9" },
  wait: { label: "Aguardar", color: "#6b7280" },
};

const PALETTE = [
  { kind: "message", icon: MessageSquare },
  { kind: "menu", icon: ListChecks },
  { kind: "condition", icon: GitBranch },
  { kind: "transfer", icon: UserCheck },
  { kind: "ai", icon: Bot },
  { kind: "wait", icon: Clock },
];

type FlowData = { nodes: Node[]; edges: Edge[] };

export function FlowEditor({ automationId, initialFlow }: { automationId: string; initialFlow: FlowData }) {
  const router = useRouter();
  const start: Node[] = initialFlow.nodes?.length
    ? (initialFlow.nodes as Node[])
    : [{ id: "start", type: "input", position: { x: 250, y: 40 }, data: { label: "▶ Início", kind: "start" }, style: nodeStyle("start") }];

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(start);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>((initialFlow.edges as Edge[]) ?? []);
  const [selected, setSelected] = useState<Node | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge({ ...c, animated: true }, eds)), [setEdges]);

  function addNode(kind: string) {
    const id = `${kind}-${nodes.length}-${Math.floor(Math.random() * 1e4)}`;
    const meta = NODE_KINDS[kind];
    setNodes((nds) => [
      ...nds,
      { id, position: { x: 150 + Math.random() * 250, y: 140 + nds.length * 30 }, data: { label: meta.label, kind, content: "" }, style: nodeStyle(kind) },
    ]);
  }

  function updateSelected(patch: Record<string, unknown>) {
    if (!selected) return;
    setNodes((nds) => nds.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...patch }, ...(patch.label ? {} : {}) } : n)));
    setSelected((s) => (s ? { ...s, data: { ...s.data, ...patch } } : s));
  }
  function removeSelected() {
    if (!selected || selected.id === "start") return;
    setNodes((nds) => nds.filter((n) => n.id !== selected.id));
    setEdges((eds) => eds.filter((e) => e.source !== selected.id && e.target !== selected.id));
    setSelected(null);
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await updateAutomationFlow(automationId, JSON.stringify({ nodes, edges }));
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full">
      {/* Paleta */}
      <div className="w-48 shrink-0 border-r border-gray-100 bg-surface p-3">
        <p className="mb-2 text-xs font-semibold text-ink-soft">Adicionar nó</p>
        <div className="space-y-1.5">
          {PALETTE.map(({ kind, icon: Icon }) => (
            <button key={kind} onClick={() => addNode(kind)}
              className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-2 text-left text-xs font-medium text-ink hover:border-brand hover:bg-brand-light">
              <Icon size={14} style={{ color: NODE_KINDS[kind].color }} /> {NODE_KINDS[kind].label}
            </button>
          ))}
        </div>
        <button onClick={save} disabled={saving}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
          <Save size={15} /> {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar fluxo"}
        </button>
      </div>

      {/* Canvas */}
      <div className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSelected(n)}
          onPaneClick={() => setSelected(null)}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#dde3ea" gap={18} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>

        {/* Painel de edição do nó */}
        {selected && (
          <div className="absolute right-3 top-3 w-72 rounded-card bg-surface p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">{NODE_KINDS[(selected.data as { kind: string }).kind]?.label ?? "Nó"}</h3>
              <button onClick={() => setSelected(null)} className="text-ink-soft hover:text-ink"><X size={16} /></button>
            </div>
            <label className="mb-1 block text-xs font-medium text-ink-soft">Título</label>
            <input
              value={(selected.data as { label?: string }).label ?? ""}
              onChange={(e) => updateSelected({ label: e.target.value })}
              className="mb-3 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand"
            />
            <label className="mb-1 block text-xs font-medium text-ink-soft">Conteúdo / mensagem</label>
            <textarea
              value={(selected.data as { content?: string }).content ?? ""}
              onChange={(e) => updateSelected({ content: e.target.value })}
              rows={4}
              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand"
            />
            {selected.id !== "start" && (
              <button onClick={removeSelected} className="mt-3 flex items-center gap-1 text-xs font-medium text-danger hover:underline">
                <Trash2 size={13} /> Excluir nó
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function nodeStyle(kind: string) {
  const c = NODE_KINDS[kind]?.color ?? "#00a8ff";
  return { borderColor: c, borderWidth: 2, borderRadius: 10, fontSize: 12, padding: 8 };
}
