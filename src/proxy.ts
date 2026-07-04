import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Restrição de acesso por IP (opcional) + refresh da sessão do Supabase.
 *
 * IP: libera o app apenas para os IPs em `IP_ALLOWLIST` (separados por vírgula).
 * Se a env estiver vazia/ausente, NÃO restringe nada — assim você nunca se tranca
 * pra fora por engano; a proteção só liga quando você preenche a variável no
 * Easypanel (não precisa rebuildar — proxy roda em runtime Node e lê process.env
 * a cada request). Webhooks (Meta/UAZAPI) e /api/version ficam sempre liberados
 * via `matcher` abaixo, senão o recebimento de mensagens e o health check quebram.
 */

/** Extrai o IP real do cliente (atrás do proxy do Easypanel/Traefik). */
function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  const ip = (xff ? xff.split(",")[0] : req.headers.get("x-real-ip") ?? "").trim();
  return ip.replace(/^::ffff:/i, ""); // IPv4 mapeado em IPv6
}

/** Retorna uma resposta 403 se o IP não estiver autorizado; senão null. */
function ipDenied(req: NextRequest): NextResponse | null {
  const raw = process.env.IP_ALLOWLIST?.trim();
  if (!raw) return null; // sem allowlist → não restringe
  const allow = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0) return null;

  const ip = clientIp(req);
  // Sem IP identificável (health check/loopback interno do container) → libera.
  if (!ip || ip === "127.0.0.1" || ip === "::1") return null;
  if (allow.includes(ip)) return null;

  return new NextResponse("Acesso restrito: este endereço de IP não está autorizado.", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// Next 16: a antiga convenção `middleware` foi renomeada para `proxy` (runtime nodejs).
export async function proxy(request: NextRequest) {
  const denied = ipDenied(request);
  if (denied) return denied;
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest\\.json|api/webhooks|api/version|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json)$).*)"],
};
