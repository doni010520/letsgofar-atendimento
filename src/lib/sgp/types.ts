/**
 * Tipos do domínio SGP (Sistema de Gestão de Provedores — softwareprovedor.com).
 * Modelam as respostas da API de integração URA. Os nomes de campo seguem o
 * padrão do SGP (em português, sem acento); campos opcionais cobrem variações
 * entre versões/instalações — o cliente normaliza o que conseguir.
 */

/** Credenciais da integração (guardadas em integrations.config). */
export interface SgpConfig {
  /** URL base da instância, ex.: https://demo.sgp.net.br */
  url: string;
  /** Nome do token de integração configurado no SGP (campo "app"). */
  app: string;
  /** Token secreto da integração. */
  token: string;
}

/** Um contrato do assinante. */
export interface SgpContrato {
  contrato: number;
  status?: string;            // ex.: "Ativo", "Suspenso", "Cancelado"
  statusDisplay?: string;
  plano?: string;
  endereco?: string;
  razaoSocial?: string;
  online?: boolean;           // conexão ativa no momento
  bloqueado?: boolean;
}

/** Resultado da consulta de cliente. */
export interface SgpCliente {
  encontrado: boolean;
  clienteId?: number;
  nome?: string;
  cpfcnpj?: string;
  email?: string;
  telefones?: string[];
  contratos: SgpContrato[];
  /** Resposta crua do SGP, para depuração/casos não mapeados. */
  raw?: unknown;
}

/** Um título financeiro (fatura/boleto) em aberto. */
export interface SgpTitulo {
  fatura: number;
  contrato?: number;
  valor: number;
  vencimento: string;         // ISO ou dd/mm/aaaa conforme o SGP
  status?: string;            // ex.: "Em aberto", "Vencido", "Pago"
  linhaDigitavel?: string;
  codigoPix?: string;         // copia-e-cola do PIX, quando disponível
  linkBoleto?: string;
  nossoNumero?: string;
}

/** Resultado de uma ação que apenas confirma sucesso/falha. */
export interface SgpAcaoResult {
  ok: boolean;
  mensagem?: string;
  raw?: unknown;
}

/** Status de conexão de um contrato. */
export interface SgpConexao {
  contrato: number;
  online?: boolean;
  bloqueado?: boolean;
  motivo?: string;
  ultimaConexao?: string;
  raw?: unknown;
}

/** Erro lançado pelo cliente SGP (HTTP ou de negócio). */
export class SgpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "SgpError";
  }
}
