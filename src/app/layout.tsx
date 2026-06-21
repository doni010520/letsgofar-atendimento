import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";

// Fonte da interface: humanista, amigável e nítida — próxima do espírito do Chatmix,
// porém com mais caráter que system-ui. Carregada sem layout-shift via next/font.
const sans = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://mvfchat.benitechlab.com"),
  title: "MVF Chat — Multiatendimento WhatsApp",
  description: "Sistema de multiatendimento e automações via WhatsApp.",
  openGraph: {
    type: "website",
    siteName: "MVF Chat",
    title: "MVF Chat — Multiatendimento WhatsApp",
    description: "Sistema de multiatendimento e automações via WhatsApp.",
    url: "https://mvfchat.benitechlab.com",
    images: [{ url: "/logo-mvf.png", alt: "MVF Chat" }],
  },
  manifest: "/manifest.json",
  themeColor: "#00a8ff",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "MVF Chat" },
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
