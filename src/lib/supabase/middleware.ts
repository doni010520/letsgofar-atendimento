import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// "/assinar" faltava aqui: quem assina o contrato é o CLIENTE, sem conta
// nenhuma no sistema — o link único (por token) é o que garante que é a
// pessoa certa, não login. Sem essa entrada, todo link de assinatura
// mandado por e-mail/WhatsApp caía direto na tela de login da equipe.
// Confirmado batendo a URL real de produção: /assinar/{token} redirecionava
// pra /login (caso real: Lucas Luiz, contrato pendente de assinatura).
const PUBLIC_PATHS = ["/login", "/cadastro", "/auth", "/assinar", "/api/webhooks", "/api/version", "/api/cron", "/privacidade"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Sem env configurado ainda: não bloqueia o app (modo dev/preview).
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
