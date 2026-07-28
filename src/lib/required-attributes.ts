/**
 * Atributos obrigatórios no encerramento (B6).
 *
 * A operação define campos que precisam estar preenchidos antes de resolver
 * a conversa. Sem isso, dado importante se perde no fim do atendimento.
 */

export type AttributeType = "text" | "number" | "link" | "date" | "list" | "checkbox";

export type RequiredAttribute = {
  id: string;
  key: string;
  label: string;
  attribute_type: AttributeType;
  options: string[];
  required: boolean;
  position: number;
};

export const ATTRIBUTE_TYPE_LABELS: Record<AttributeType, string> = {
  text: "Texto",
  number: "Número",
  link: "Link",
  date: "Data",
  list: "Lista de opções",
  checkbox: "Sim/Não",
};

function isFilled(type: AttributeType, value: unknown): boolean {
  if (type === "checkbox") return value === true || value === "true";
  return String(value ?? "").trim() !== "";
}

function isValid(type: AttributeType, value: unknown): boolean {
  const raw = String(value ?? "").trim();
  if (!raw) return true; // vazio é tratado por isFilled
  switch (type) {
    case "number":
      return !Number.isNaN(Number(raw));
    case "link":
      return /^https?:\/\/\S+$/i.test(raw);
    case "date":
      return !Number.isNaN(Date.parse(raw));
    default:
      return true;
  }
}

/**
 * Valida os valores informados. Devolve os erros por campo — vazio = pode
 * encerrar a conversa.
 */
export function validateResolution(
  attributes: RequiredAttribute[],
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const attr of attributes) {
    const value = values[attr.key];

    if (attr.required && !isFilled(attr.attribute_type, value)) {
      errors[attr.key] = `Preencha "${attr.label}" para encerrar.`;
      continue;
    }
    if (!isValid(attr.attribute_type, value)) {
      errors[attr.key] =
        attr.attribute_type === "link"
          ? `"${attr.label}" deve ser um link válido (http/https).`
          : `"${attr.label}" está em formato inválido.`;
      continue;
    }
    if (
      attr.attribute_type === "list" &&
      isFilled(attr.attribute_type, value) &&
      attr.options.length &&
      !attr.options.includes(String(value))
    ) {
      errors[attr.key] = `Escolha uma opção válida em "${attr.label}".`;
    }
  }

  return errors;
}

/** Extrai os valores de um FormData no formato attr_<key>. */
export function readAttributeValues(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("attr_")) out[k.slice(5)] = v === "on" ? true : v;
  }
  return out;
}
