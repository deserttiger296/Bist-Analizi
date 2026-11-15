import type { Metadata } from "next";
import { PrivacyClient } from "./PrivacyClient";

export const metadata: Metadata = {
  title: "BIST Analizi Privacy Policy",
  description:
    "BIST Analizi Privacy Policy – Gizlilik Politikası ve Google API Hizmetleri Kullanıcı Verileri Politikası.",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

export default function PrivacyPage() {
  return <PrivacyClient />;
}
