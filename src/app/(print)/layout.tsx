import { requireAppSession } from "@/lib/auth";

/**
 * Casca para páginas imprimíveis/documento (ex.: PDF do contrato).
 *
 * Mesma proteção de acesso do (app) (sessão, onboarding, senha provisória,
 * 2FA) via requireAppSession — mas SEM sidebar/topbar e sem o container
 * `h-screen overflow-hidden` do layout principal. Esse overflow-hidden é
 * o motivo real do "abre e não mostra ele completo" da Luana: a página do
 * PDF é um documento comprido de fluxo normal, sem scroll próprio, então
 * dentro do <main overflow-hidden> do app ela ficava cortada na altura da
 * tela em vez de rolar. Aqui o documento rola normalmente, como qualquer
 * página comprida.
 */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    await requireAppSession();
  }
  return <>{children}</>;
}
