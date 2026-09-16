import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

import { ClientNavigation } from "@/components/ClientNavigation";

export const metadata: Metadata = {
  title: "BIST Analyst - Kazananlar Kulübü",
  description: "AI-powered BIST stock analysis and trading signals",
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
