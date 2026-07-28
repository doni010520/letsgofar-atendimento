/**
 * Prefixo automático do agente (B8).
 *
 * Prefixa a mensagem de saída com "**Nome:**" para o cliente saber quem
 * está falando. Controlado por `settings.auto_agent_prefix_enabled` na
 * organização.
 *
 * NÃO prefixa quando:
 *  - a mensagem veio espelhada do celular do atendente (já sai com o nome dele
 *    no aparelho) — C16;
 *  - o texto já começa com o mesmo prefixo (evita duplicar).
 */

export function withAgentPrefix(params: {
  content: string;
  agentName?: string | null;
  enabled: boolean;
  /** true quando a mensagem foi espelhada do celular (echo). */
  mirrored?: boolean;
}): string {
  const { content, agentName, enabled, mirrored } = params;
  if (!enabled || mirrored) return content;

  const name = (agentName ?? "").trim();
  if (!name) return content;

  const prefix = `**${name}:**`;
  if (content.trimStart().startsWith(prefix)) return content;

  return `${prefix}\n${content}`;
}

/** Lê a preferência da organização (default: desligado). */
export function isAgentPrefixEnabled(settings: unknown): boolean {
  if (!settings || typeof settings !== "object") return false;
  return (settings as Record<string, unknown>).auto_agent_prefix_enabled === true;
}
