import type { NextConfig } from "next";

const securityHeaders = [
  // Impede clickjacking — só a própria origem pode colocar em iframe.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Impede sniffing de MIME.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Força HTTPS por 1 ano (incluindo subdomínios).
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Não envia Referer para origens externas.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Recursos sensíveis: microfone (gravar áudio) e geolocalização (enviar local)
  // liberados só para a PRÓPRIA origem; câmera e pagamento seguem bloqueados.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self), payment=()" },
  // CSP: restringe origens de scripts/estilos/conexões.
  // AJUSTE conforme adicionar CDNs/fontes externas.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Scripts: self + inline (Next.js usa inline) + eval apenas em dev
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      // Estilos: self + inline (Tailwind/styled-components)
      "style-src 'self' 'unsafe-inline'",
      // Imagens: self + data URIs + uploads do Supabase
      `img-src 'self' data: blob: ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}`,
      // Fontes: self
      "font-src 'self'",
      // Conexões: self + Supabase (API + Realtime)
      `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} wss://*.supabase.co`,
      // Mídia (áudio/vídeo): self + blob (preview) + Supabase (áudios/vídeos re-hospedados)
      `media-src 'self' data: blob: ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}`,
      // Frames: só a própria origem
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Saída standalone: imagem Docker pequena e self-contained (server.js).
  output: "standalone",

  experimental: {
    // O Next bufferiza o corpo da requisição e CORTA no limite EM SILÊNCIO —
    // a rota recebe o pedaço achando que é o arquivo inteiro, sem erro. O
    // padrão de 10 MB truncava os contratos em PDF: chegavam sem %%EOF e não
    // abriam, nem para quem recebia nem para quem enviava.
    // 128 MB cobre com folga o limite do próprio WhatsApp (~100 MB p/ documento).
    proxyClientMaxBodySize: "128mb",

    serverActions: {
      // O padrão do Next é 1 MB, e o envio de arquivo do atendimento passa o
      // arquivo inteiro por server action — qualquer foto de celular estourava
      // esse teto e a mensagem simplesmente não saía.
      // 32 MB cobre foto e vídeo curto (o WhatsApp aceita ~16 MB de vídeo) sem
      // deixar o servidor carregar arquivos gigantes na memória, já que o
      // upload é bufferizado antes de ir para o storage.
      bodySizeLimit: "32mb",
    },
  },

  async headers() {
    return [
      {
        // Aplica em todas as rotas.
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
