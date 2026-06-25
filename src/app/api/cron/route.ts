import { NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { runCronJobs } from "@/lib/cron";

/**
 * Endpoint do cron — disparo manual/externo (protegido por CRON_SECRET).
 * O agendamento automático roda IN-PROCESS via src/instrumentation.ts; este
 * endpoint serve para disparo sob demanda e diagnóstico.
 */
export async function GET(req: Request) {
  const rl = rateLimit(`cron:${getClientIp(req)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
  }

  const secret = new URL(req.url).searchParams.get("secret");
  // Fail-closed: sem CRON_SECRET configurado, o endpoint permanece bloqueado.
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runCronJobs();
  return NextResponse.json({ ok: true, ...result });
}
