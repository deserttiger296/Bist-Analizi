"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import navigation from "@/lib/system-navigation.json";
import { AuthButton } from "@/components/AuthButton";

function Icon({ name }: { name: string }) {
  return <svg className="rsi-icon" aria-hidden="true"><use href={`/static/rsi-icons.svg#${name}`} /></svg>;
}

export function ClientNavigation({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [engine, setEngine] = useState<"checking" | "online" | "offline">("checking");
  const current = navigation.flatMap(group => group.items).find(item => item.href === pathname);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Engine unavailable"); return response.json(); })
      .then(health => { if (mounted) setEngine(health?.status === "ok" ? "online" : "offline"); })
      .catch(() => { if (mounted) setEngine("offline"); })
      .finally(() => clearTimeout(timeout));
    return () => { mounted = false; clearTimeout(timeout); controller.abort(); };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        document.getElementById("rsi-menu-toggle")?.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return <div className="rsi-app rsi-react" data-menu-open={menuOpen}>
    <aside className="rsi-sidebar" id="rsi-sidebar" aria-label="Ana menü">
      <Link className="rsi-brand" href="/index.html">
        <Image src="/static/rsi-mark.svg" width={42} height={42} alt="" unoptimized />
        <div><strong>RSI Analizi</strong><span>TEKNİK ANALİZ PLATFORMU</span></div>
      </Link>
      <nav aria-label="Tüm sistemler"><ul className="nav-links">
        {navigation.map(group => <li key={group.label}>
          <div className="rsi-nav-group">{group.label}</div>
          <ul className="nav-links">{group.items.map(item => <li key={item.href}>
            <Link href={item.href} onClick={() => setMenuOpen(false)} aria-current={pathname === item.href ? "page" : undefined}>
              <Icon name={item.icon} /><span>{item.label}</span>{"badge" in item && <small className="rsi-nav-badge">{item.badge}</small>}
            </Link>
          </li>)}</ul>
        </li>)}
      </ul></nav>
      <div className="rsi-sidebar-footer">
        <div className={`rsi-engine-status ${engine}`} role="status"><span className="dot" />{ { checking: "Motor kontrol ediliyor…", online: "Sinyal motoru çevrimiçi", offline: "Sinyal motoruna erişilemiyor" }[engine]}</div>
        <strong>Araştırın. Karşılaştırın. Doğrulayın.</strong><p>Yeni özellikler önce Test Merkezi&apos;nde.</p>
      </div>
    </aside>
    <button type="button" className="rsi-menu-overlay" aria-label="Menüyü kapat" onClick={() => setMenuOpen(false)} />
    <div className="rsi-main">
      <header className="rsi-topbar">
        <button className="rsi-menu-button" id="rsi-menu-toggle" type="button" aria-label="Menüyü aç" aria-controls="rsi-sidebar" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Icon name="menu" /></button>
        <div className="rsi-breadcrumb"><span>Çalışma alanı</span><span>/</span><strong>{current?.label || "Hisse analizi"}</strong></div>
        <div className="rsi-header-actions">
          <span className="rsi-environment">BIST · ARAŞTIRMA</span>
          <Link className="rsi-help-link" href="/lab"><Icon name="shield" />Test Merkezi</Link>
          <AuthButton />
        </div>
      </header>
      <main className="rsi-page-scroll"><div className="rsi-content">{children}</div></main>
    </div>
  </div>;
}
