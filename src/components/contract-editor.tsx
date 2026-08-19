"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bold, Italic, Underline, Heading1, Heading2, Heading3, Pilcrow,
  List, ListOrdered, AlignLeft, AlignCenter, AlignJustify, Link as LinkIcon,
  Link2Off, Undo2, Redo2, Code2, Eye,
} from "lucide-react";

/**
 * Editor de texto do contrato — igualzinho ao do Chatwoot (pedido explícito
 * da Luana: "tem como ficar com o mesmo formato do Chatwoot? Lá era bem
 * simples e rápido"): visual (contentEditable) com uma barra de formatação
 * simples, alternando pra HTML cru quando precisa de algo que o botão não
 * cobre. É o "lugar que eu possa colocar alguns pontos que serão
 * acrescentados" que faltava — antes só dava pra escrever o contrato inteiro
 * num textarea de texto puro, sem nenhuma formatação nem visualização.
 */
export function ContractEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const [mode, setMode] = useState<"visual" | "html" | "preview">("visual");
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef(value);

  // Só empurra `value` pro contentEditable quando ele mudou por FORA (troca
  // de modelo, carregar um rascunho existente) — se fosse sempre, cada letra
  // digitada reposicionaria o cursor no início.
  useEffect(() => {
    if (mode === "visual" && editorRef.current && value !== lastValueRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
    lastValueRef.current = value;
  }, [value, mode]);

  /**
   * Popula o conteúdo já na hora que o <div contentEditable> nasce no DOM.
   *
   * O useEffect acima só reage quando `value` MUDA — mas ao abrir um rascunho
   * já existente pra editar, o componente nasce com `value` correto desde o
   * primeiro render (setado antes de montar), então "mudou" nunca acontece e
   * o editor ficava vazio na tela mesmo com o texto salvo certinho no banco.
   * Reproduzido e confirmado: o innerHTML batia com o banco só depois de
   * forçar aqui, no callback ref (roda uma vez, quando o nó é criado).
   */
  function montarEditor(node: HTMLDivElement | null) {
    editorRef.current = node;
    if (node && !node.innerHTML && value) node.innerHTML = value;
  }

  function exec(cmd: string, arg?: string) {
    document.execCommand(cmd, false, arg);
    editorRef.current?.focus();
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }

  function insertLink() {
    const url = window.prompt("URL do link:");
    if (url) exec("createLink", url);
  }

  const toolBtn = "flex h-7 w-7 items-center justify-center rounded text-ink-soft transition hover:bg-gray-200 hover:text-ink";

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-gray-50 px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-0.5">
          {mode === "visual" && (
            <>
              <button type="button" title="Negrito" className={toolBtn} onClick={() => exec("bold")}><Bold size={14} /></button>
              <button type="button" title="Itálico" className={toolBtn} onClick={() => exec("italic")}><Italic size={14} /></button>
              <button type="button" title="Sublinhado" className={toolBtn} onClick={() => exec("underline")}><Underline size={14} /></button>
              <span className="mx-1 h-4 w-px bg-border" />
              <button type="button" title="Título 1" className={toolBtn} onClick={() => exec("formatBlock", "h1")}><Heading1 size={14} /></button>
              <button type="button" title="Título 2" className={toolBtn} onClick={() => exec("formatBlock", "h2")}><Heading2 size={14} /></button>
              <button type="button" title="Título 3" className={toolBtn} onClick={() => exec("formatBlock", "h3")}><Heading3 size={14} /></button>
              <button type="button" title="Parágrafo" className={toolBtn} onClick={() => exec("formatBlock", "p")}><Pilcrow size={14} /></button>
              <span className="mx-1 h-4 w-px bg-border" />
              <button type="button" title="Lista" className={toolBtn} onClick={() => exec("insertUnorderedList")}><List size={14} /></button>
              <button type="button" title="Lista numerada" className={toolBtn} onClick={() => exec("insertOrderedList")}><ListOrdered size={14} /></button>
              <span className="mx-1 h-4 w-px bg-border" />
              <button type="button" title="Alinhar à esquerda" className={toolBtn} onClick={() => exec("justifyLeft")}><AlignLeft size={14} /></button>
              <button type="button" title="Centralizar" className={toolBtn} onClick={() => exec("justifyCenter")}><AlignCenter size={14} /></button>
              <button type="button" title="Justificar" className={toolBtn} onClick={() => exec("justifyFull")}><AlignJustify size={14} /></button>
              <span className="mx-1 h-4 w-px bg-border" />
              <button type="button" title="Link" className={toolBtn} onClick={insertLink}><LinkIcon size={14} /></button>
              <button type="button" title="Remover link" className={toolBtn} onClick={() => exec("unlink")}><Link2Off size={14} /></button>
              <span className="mx-1 h-4 w-px bg-border" />
              <button type="button" title="Desfazer" className={toolBtn} onClick={() => exec("undo")}><Undo2 size={14} /></button>
              <button type="button" title="Refazer" className={toolBtn} onClick={() => exec("redo")}><Redo2 size={14} /></button>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode(mode === "html" ? "visual" : "html")}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-soft hover:bg-gray-200 hover:text-ink"
          >
            <Code2 size={13} /> {mode === "html" ? "Editor visual" : "Código HTML"}
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === "preview" ? "visual" : "preview")}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-soft hover:bg-gray-200 hover:text-ink"
          >
            <Eye size={13} /> {mode === "preview" ? "Voltar a editar" : "Visualizar"}
          </button>
        </div>
      </div>

      {mode === "html" && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={16}
          className="w-full resize-y bg-white px-4 py-3 font-mono text-xs text-ink outline-none"
        />
      )}

      {mode === "preview" && (
        <div className="contract-doc max-h-[600px] overflow-y-auto bg-white p-8" dangerouslySetInnerHTML={{ __html: value || "<p class='text-ink-soft'>Nada pra mostrar ainda.</p>" }} />
      )}

      {mode === "visual" && (
        <div
          ref={montarEditor}
          contentEditable
          suppressContentEditableWarning
          className="contract-doc min-h-[300px] max-h-[600px] cursor-text overflow-y-auto bg-white p-8 outline-none"
          onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        />
      )}
    </div>
  );
}
