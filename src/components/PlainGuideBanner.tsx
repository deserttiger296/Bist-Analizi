"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export interface PlainGuideBannerProps {
  storageKey: string;
  title: string;
  steps: [string, string, string];
  ctaHref?: string;
  ctaLabel?: string;
  className?: string;
}

export function PlainGuideBanner({
  storageKey,
  title,
  steps,
  ctaHref = "/viop-rehber",
  ctaLabel = "VİOP & Strateji Rehberi",
  className = "",
}: PlainGuideBannerProps) {
  const [collapsed, setCollapsed] = useState(false);

  const fullKey = storageKey.startsWith("rsi_guide_")
    ? storageKey
    : `rsi_guide_${storageKey}`;

  useEffect(() => {
    try {
      if (window.localStorage.getItem(fullKey) === "1") {
        setCollapsed(true);
      }
    } catch {
      // Ignore storage errors (private browsing / restricted storage)
    }
  }, [fullKey]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(fullKey, next ? "1" : "0");
      } catch {
        // Ignore storage write errors
      }
      return next;
    });
  };

  if (collapsed) {
    return (
      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#29384b] bg-[#111b28]/90 px-3.5 py-2 text-xs text-slate-300 ${className}`}
      >
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="inline-block h-2 w-2 rounded-full bg-[#69ddbb]" />
          <strong className="text-[#eaf0f6]">{title}</strong>
          <span className="text-[#93a2b7]">· 3 Adımlı Rehber gizli</span>
        </div>
        <div className="flex items-center gap-2">
          {ctaHref && ctaLabel && (
            <Link
              href={ctaHref}
              className="rounded-lg border border-[#344963] bg-[#0e1622] px-2.5 py-1 text-[11px] font-semibold text-[#7de4c7] transition-colors hover:border-[#69ddbb] hover:text-white"
            >
              {ctaLabel}
            </Link>
          )}
          <button
            type="button"
            aria-expanded={false}
            onClick={toggleCollapsed}
            className="rounded-lg border border-[#344963] bg-[#152435] px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition-colors hover:border-[#69ddbb] hover:text-white"
          >
            Rehberi Göster
          </button>
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label={title}
      className={`space-y-3 rounded-[13px] border border-[#29384b] border-l-4 border-l-[#69ddbb] bg-[#111b28] p-4 sm:p-5 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <span className="rounded-full border border-[#69ddbb]/40 bg-[#69ddbb]/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#69ddbb]">
            SADE TÜRKÇE REHBER · 3 ADIM
          </span>
          <strong className="text-sm font-bold text-[#eaf0f6]">{title}</strong>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ctaHref && ctaLabel && (
            <Link
              href={ctaHref}
              className="rounded-lg border border-[#2e5a50] bg-[#152d27] px-3 py-1.5 text-xs font-semibold text-[#7de4c7] transition-colors hover:border-[#69ddbb] hover:bg-[#193a32] hover:text-white"
            >
              {ctaLabel}
            </Link>
          )}
          <button
            type="button"
            aria-expanded={true}
            onClick={toggleCollapsed}
            className="rounded-lg border border-[#344963] bg-[#0e1622] px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:border-[#69ddbb] hover:text-white"
          >
            Gizle
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        {steps.map((stepText, idx) => (
          <div
            key={idx}
            className="flex items-start gap-2.5 rounded-lg border border-[#233040] bg-[#0e1622] px-3 py-2.5 text-xs leading-relaxed text-slate-200"
          >
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#69ddbb]/50 bg-[#152d27] text-[11px] font-bold text-[#69ddbb]">
              {idx + 1}
            </span>
            <span>{stepText}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default PlainGuideBanner;
