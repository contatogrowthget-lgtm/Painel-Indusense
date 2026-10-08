import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "InduSense | Monitoramento Industrial",
  description: "Painel administrativo do Sistema Inteligente de Monitoramento de Ambientes Industriais."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}