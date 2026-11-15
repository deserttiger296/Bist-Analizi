import "./globals.css";
import "../../public/static/app-shell.css";
import "../../public/static/workspace.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

import { ClientNavigation } from "@/components/ClientNavigation";

export const metadata: Metadata = {
  title: "RSI Analizi | Piyasaya daha net bakın",
  description: "BIST RSI uyumsuzluk analizi, çoklu zaman dilimi araştırması ve strateji doğrulama platformu.",
  icons: { icon: "/static/rsi-mark.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={inter.className}>
      <body className="bg-[#0b0f19] text-slate-100 min-h-screen antialiased m-0 overflow-hidden">
        <ClientNavigation>
          {children}
        </ClientNavigation>
      </body>
    </html>
  );
}
