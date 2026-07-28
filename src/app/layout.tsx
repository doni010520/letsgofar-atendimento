import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";

// Fonte da interface: humanista, amigável e nítida — próxima do espírito da marca,
// porém com mais caráter que system-ui. Carregada sem layout-shift via next/font.
const sans = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://atendimento.letsgofar.com.br"),
  title: "Let's Go Far — Atendimento",
  description: "Sistema de multiatendimento e automações via WhatsApp.",
  openGraph: {
    type: "website",
    siteName: "Let's Go Far",
    title: "Let's Go Far — Atendimento",
    description: "Sistema de multiatendimento e automações via WhatsApp.",
    url: "https://atendimento.letsgofar.com.br",
    images: [{ url: "/logo-letsgofar.png", alt: "Let's Go Far" }],
  },
  manifest: "/manifest.json",
  themeColor: "#00a8ff",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Let's Go Far" },
  viewport: { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`h-full antialiased ${sans.variable}`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
