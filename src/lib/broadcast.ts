/**
 * Regras de disparo em massa.
 *
 * Tudo aqui nasceu de problema real em produção no Chatwoot:
 *  - spintax + nome evitam N mensagens idênticas (proteção anti-bloqueio)
 *  - o 9º dígito brasileiro criava contato duplicado e derrubava o envio
 *  - "enviado" não é "entregue": só o id do provedor prova entrega
 */

export type Recipient = {
  name?: string | null;
  phone: string;
  merge_fields?: Record<string, string> | null;
};

/** Resolve `{a|b|c}` escolhendo uma variação (mesmo sentido, texto diferente). */
export function resolveSpintax(text: string): string {
  return text.replace(/\{([^{}]*\|[^{}]*)\}/g, (_m, group: string) => {
    const options = group.split("|");
    return options[Math.floor(Math.random() * options.length)];
  });
}

/** Aplica `{primeiro_nome}`, `{nome}` e merges livres da planilha. */
export function applyMergeFields(text: string, r: Recipient): string {
  const full = (r.name ?? "").trim();
  const first = full.split(/\s+/)[0] ?? "";
  let out = text.replaceAll("{primeiro_nome}", first).replaceAll("{nome}", full);
  for (const [key, value] of Object.entries(r.merge_fields ?? {})) {
    out = out.replaceAll(`{${key}}`, String(value ?? ""));
  }
  return out;
}

/** Mensagem final para um destinatário: spintax + merges. */
export function personalize(template: string, r: Recipient): string {
  return applyMergeFields(resolveSpintax(template), r);
}

/** Intervalo aleatório (segundos) entre dois envios. */
export function randomInterval(minSeconds: number, maxSeconds: number): number {
  const min = Math.min(minSeconds, maxSeconds);
  const max = Math.max(minSeconds, maxSeconds);
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Hora local (0-23) em um fuso IANA. */
export function hourInTimezone(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone,
  }).format(date);
  return Number(hour) % 24;
}

/** Está dentro da janela de envio? Suporta janela que cruza a meia-noite. */
export function isWithinWindow(
  date: Date,
  startHour: number,
  endHour: number,
  timeZone = "America/Sao_Paulo",
): boolean {
  const h = hourInTimezone(date, timeZone);
  return startHour <= endHour
    ? h >= startHour && h < endHour
    : h >= startHour || h < endHour;
}

/** Segundos até a próxima abertura da janela. */
export function secondsUntilWindow(
  date: Date,
  startHour: number,
  timeZone = "America/Sao_Paulo",
): number {
  for (let i = 1; i <= 48; i += 1) {
    const candidate = new Date(date.getTime() + i * 30 * 60 * 1000);
    if (hourInTimezone(candidate, timeZone) === startHour) {
      return Math.floor((candidate.getTime() - date.getTime()) / 1000);
    }
  }
  return 3600;
}

/**
 * Normaliza telefone brasileiro para só dígitos com DDI.
 * Completa o 55 quando vier apenas DDD + número.
 */
export function normalizePhone(raw: string): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.length <= 11) digits = `55${digits}`;
  return digits;
}

/**
 * Variantes do 9º dígito — usar para achar contato existente ANTES de criar
 * um novo. Foi a duplicação daqui que quebrou entregas no Chatwoot.
 */
export function phoneVariants(phone: string): string[] {
  const digits = normalizePhone(phone);
  if (!digits) return [];
  const variants = new Set<string>([digits]);
  if (digits.startsWith("55")) {
    const rest = digits.slice(2);
    if (rest.length === 11 && rest[2] === "9") {
      variants.add(`55${rest.slice(0, 2)}${rest.slice(3)}`); // remove o 9
    } else if (rest.length === 10) {
      variants.add(`55${rest.slice(0, 2)}9${rest.slice(2)}`); // adiciona o 9
    }
  }
  return [...variants];
}

/** Cabeçalho aceito no CSV de contatos. */
export const CSV_REQUIRED = ["telefone", "nome"] as const;

/** Faz o parse do CSV de disparo (telefone, nome, merge1, merge2, ...). */
export function parseRecipientsCsv(csv: string): Recipient[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const sep = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const iPhone = headers.indexOf("telefone");
  const iName = headers.indexOf("nome");
  if (iPhone === -1) return [];

  const out: Recipient[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(sep).map((c) => c.trim());
    const phone = normalizePhone(cells[iPhone] ?? "");
    if (!phone) continue;

    const merge: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (idx === iPhone || idx === iName || !h) return;
      if (cells[idx]) merge[h] = cells[idx];
    });

    out.push({ phone, name: iName >= 0 ? cells[iName] : "", merge_fields: merge });
  }
  return out;
}
