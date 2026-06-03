import {
  type SgpConfig,
  type SgpCliente,
  type SgpContrato,
  type SgpTitulo,
  type SgpAcaoResult,
  type SgpConexao,
  SgpError,
} from "./types";

/**
 * Cliente da API de integração (URA) do SGP.
 *
 * Toda chamada é POST JSON e carrega `app` (nome do token) + `token` no corpo,
 * conforme o padrão do SGP. Os endpoints ficam sob `/api/ura/`. Os normalizadores
 * são defensivos: instalações diferentes variam nomes de campo, então tentamos
 * múltiplas chaves e preservamos a resposta crua em `raw`.
 *
 * Os caminhos exatos e o shape das respostas devem ser confirmados contra a
 * instância real (ver scripts/sgp-probe.mjs).
 */
export class SgpClient {
  private base: string;
  private app: string;
  private token: string;

  constructor(config: SgpConfig) {
    if (!config.url) throw new SgpError("SGP: URL não configurada.");
    if (!config.app) throw new SgpError("SGP: nome do token (app) não configurado.");
    if (!config.token) throw new SgpError("SGP: token não configurado.");
    this.base = config.url.replace(/\/+$/, "");
    this.app = config.app;
    this.token = config.token;
  }

  /** POST cru contra um endpoint da URA. Mescla app+token ao corpo. */
  async post<T = unknown>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    const url = `${this.base}/${path.replace(/^\/+/, "")}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ app: this.app, token: this.token, ...body }),
      });
    } catch (e) {
      throw new SgpError(`SGP: falha de rede em ${path}: ${(e as Error).message}`);
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = text;
    }
    if (!res.ok) {
      throw new SgpError(`SGP ${path} -> ${res.status}`, res.status, json);
    }
    return json as T;
  }

  /** Consulta o assinante por CPF/CNPJ ou por telefone. */
  async consultarCliente(by: { cpfcnpj?: string; telefone?: string; contrato?: number }): Promise<SgpCliente> {
    const body: Record<string, unknown> = {};
    if (by.cpfcnpj) body.cpfcnpj = onlyDigits(by.cpfcnpj);
    if (by.telefone) body.telefone = onlyDigits(by.telefone);
    if (by.contrato) body.contrato = by.contrato;
    const raw = await this.post<Record<string, unknown>>("api/ura/consultacliente/", body);
    return normalizeCliente(raw);
  }

  /** Lista títulos (faturas/boletos) em aberto, por contrato ou CPF/CNPJ. */
  async titulosEmAberto(by: { contrato?: number; cpfcnpj?: string }): Promise<SgpTitulo[]> {
    const body: Record<string, unknown> = {};
    if (by.contrato) body.contrato = by.contrato;
    if (by.cpfcnpj) body.cpfcnpj = onlyDigits(by.cpfcnpj);
    const raw = await this.post<Record<string, unknown>>("api/ura/titulos/", body);
    return normalizeTitulos(raw);
  }

  /**
   * Gera/retorna a 2ª via de um título: linha digitável, link do boleto e/ou
   * PIX copia-e-cola, conforme disponível na instância.
   */
  async segundaVia(by: { fatura?: number; contrato?: number }): Promise<SgpTitulo | null> {
    const body: Record<string, unknown> = {};
    if (by.fatura) body.fatura = by.fatura;
    if (by.contrato) body.contrato = by.contrato;
    const raw = await this.post<Record<string, unknown>>("api/ura/segundavia/", body);
    const list = normalizeTitulos(raw);
    return list[0] ?? null;
  }

  /** Desbloqueio de confiança / liberação temporária de um contrato suspenso. */
  async desbloqueioConfianca(contrato: number): Promise<SgpAcaoResult> {
    const raw = await this.post<Record<string, unknown>>("api/ura/desbloqueio/", { contrato });
    return normalizeAcao(raw);
  }

  /** Verifica o status de conexão/bloqueio de um contrato. */
  async statusConexao(contrato: number): Promise<SgpConexao> {
    const raw = await this.post<Record<string, unknown>>("api/ura/verificaacesso/", { contrato });
    return { contrato, online: pickBool(raw, ["online", "conectado"]), bloqueado: pickBool(raw, ["bloqueado", "suspenso"]), motivo: pickStr(raw, ["motivo", "mensagem", "msg"]), raw };
  }

  /** Abre um chamado/O.S. de suporte para um contrato. */
  async abrirChamado(params: { contrato: number; assunto: string; descricao: string }): Promise<SgpAcaoResult> {
    const raw = await this.post<Record<string, unknown>>("api/ura/abrechamado/", {
      contrato: params.contrato,
      assunto: params.assunto,
      mensagem: params.descricao,
      descricao: params.descricao,
    });
    return normalizeAcao(raw);
  }
}

/* ----------------------------- normalizadores ----------------------------- */

const onlyDigits = (s: string) => s.replace(/\D+/g, "");

function asArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (v && typeof v === "object") return [v as Record<string, unknown>];
  return [];
}

function pick(o: Record<string, unknown> | undefined, keys: string[]): unknown {
  if (!o) return undefined;
  for (const k of keys) if (o[k] != null) return o[k];
  return undefined;
}
function pickStr(o: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  const v = pick(o, keys);
  return v == null ? undefined : String(v);
}
function pickNum(o: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  const v = pick(o, keys);
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isNaN(n) ? undefined : n;
}
function pickBool(o: Record<string, unknown> | undefined, keys: string[]): boolean | undefined {
  const v = pick(o, keys);
  if (v == null) return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return ["1", "true", "sim", "s", "online", "ativo"].includes(s);
}

function normalizeContrato(c: Record<string, unknown>): SgpContrato {
  return {
    contrato: pickNum(c, ["contrato", "contratoId", "id"]) ?? 0,
    status: pickStr(c, ["status", "statusInternet", "situacao"]),
    statusDisplay: pickStr(c, ["statusDisplay", "statusInternet"]),
    plano: pickStr(c, ["plano", "planoInternet", "servico"]),
    endereco: pickStr(c, ["endereco", "logradouro"]),
    razaoSocial: pickStr(c, ["razaoSocial", "razaosocial"]),
    online: pickBool(c, ["online", "conectado"]),
    bloqueado: pickBool(c, ["bloqueado", "suspenso"]),
  };
}

export function normalizeCliente(raw: Record<string, unknown>): SgpCliente {
  // O cliente pode vir na raiz, em `cliente`, ou a lista de contratos em `contratos`.
  const root = (raw.cliente as Record<string, unknown>) ?? raw;
  const contratosRaw = asArray(raw.contratos ?? root.contratos ?? raw.contrato);
  const msg = pickStr(raw, ["msg", "mensagem"]) ?? "";
  const encontrado =
    pickBool(raw, ["encontrado", "sucesso"]) ??
    (contratosRaw.length > 0 || pick(root, ["nome", "razaoSocial"]) != null);
  return {
    encontrado: !!encontrado && !/n[ãa]o\s+encontrad/i.test(msg),
    clienteId: pickNum(root, ["clienteId", "cliente", "id"]),
    nome: pickStr(root, ["nome", "razaoSocial", "razaosocial"]),
    cpfcnpj: pickStr(root, ["cpfcnpj", "cpf", "cnpj"]),
    email: pickStr(root, ["email"]),
    telefones: collectTelefones(root),
    contratos: contratosRaw.map(normalizeContrato),
    raw,
  };
}

function collectTelefones(o: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ["telefone", "celular", "telefone1", "telefone2", "fone"]) {
    const v = o[k];
    if (v) out.push(String(v));
  }
  return out;
}

export function normalizeTitulos(raw: Record<string, unknown>): SgpTitulo[] {
  const list = asArray(raw.titulos ?? raw.faturas ?? raw.fatura ?? raw);
  return list
    .filter((t) => pick(t, ["fatura", "faturaId", "id", "valor"]) != null)
    .map((t) => ({
      fatura: pickNum(t, ["fatura", "faturaId", "id"]) ?? 0,
      contrato: pickNum(t, ["contrato"]),
      valor: pickNum(t, ["valor", "valorTotal"]) ?? 0,
      vencimento: pickStr(t, ["vencimento", "dataVencimento", "datavencimento"]) ?? "",
      status: pickStr(t, ["status", "situacao"]),
      linhaDigitavel: pickStr(t, ["linhaDigitavel", "linhadigitavel", "codigoBarras"]),
      codigoPix: pickStr(t, ["pix", "codigoPix", "pixCopiaECola", "qrcode"]),
      linkBoleto: pickStr(t, ["link", "linkBoleto", "url", "boleto"]),
      nossoNumero: pickStr(t, ["nossoNumero", "nossonumero"]),
    }));
}

function normalizeAcao(raw: Record<string, unknown>): SgpAcaoResult {
  const ok = pickBool(raw, ["sucesso", "ok", "status"]) ?? !pick(raw, ["erro", "error"]);
  return { ok: !!ok, mensagem: pickStr(raw, ["mensagem", "msg", "detalhe", "erro"]), raw };
}
