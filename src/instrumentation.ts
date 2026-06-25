// Cron IN-PROCESS: roda as tarefas periódicas (encerramento por inatividade,
// auto-transferência) dentro do próprio servidor Next, sem agendador externo.
// Funciona porque o app roda como processo Node persistente (Next standalone),
// não serverless. `register()` é chamado uma vez quando o servidor sobe.
export async function register() {
  // Só no runtime Node (não no Edge) e uma única vez.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as unknown as { __mvfCronStarted?: boolean };
  if (g.__mvfCronStarted) return;
  g.__mvfCronStarted = true;

  const { runCronJobs } = await import("@/lib/cron");
  const tick = async () => {
    try {
      await runCronJobs();
    } catch (e) {
      console.warn("[cron]", (e as Error)?.message);
    }
  };

  const INTERVAL_MS = Number(process.env.CRON_INTERVAL_MS ?? 180_000); // 3 min (ajustável)
  // Primeira execução após o servidor estabilizar; depois no intervalo.
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), INTERVAL_MS);
  }, 30_000);
}
