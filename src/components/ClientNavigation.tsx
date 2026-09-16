"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
// Firebase removed

export function ClientNavigation({ children }: { children: React.ReactNode }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const [isGlobalScanning, setIsGlobalScanning] = useState(false);

  // Global scan status: will be integrated with local API later.
  useEffect(() => {
    setIsGlobalScanning(false);
  }, []);

  return (
    <div className="flex h-screen w-full relative">
      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 border-r border-white/5 bg-[#0f1524] flex flex-col flex-shrink-0 transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}
        md:relative md:translate-x-0
      `}>
        <div className="h-20 flex items-center px-6 border-b border-white/5 justify-between">
          <Link href="/" className="font-black text-xl text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 transition-all drop-shadow-[0_0_10px_rgba(34,211,238,0.3)] flex items-center gap-2">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400">
              <rect x="4" y="4" width="16" height="16" />
              <rect x="4" y="4" width="16" height="16" transform="rotate(45 12 12)" />
            </svg> Kazananlar Kulübü
          </Link>
          <button 
            className="md:hidden text-slate-400 hover:text-white"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        
        <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-1.5">
          <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 px-2">Ana Menü</div>
          <SidebarLink href="/" icon="❖" label="Kontrol Paneli" pathname={pathname} onClick={() => setIsMobileMenuOpen(false)} />
          <SidebarLink href="/scanner" icon="📡" label="Tarayıcı" pathname={pathname} onClick={() => setIsMobileMenuOpen(false)} />
          <SidebarLink href="/qp" icon="📐" label="QP Analiz Motoru" pathname={pathname} onClick={() => setIsMobileMenuOpen(false)} />
          <SidebarLink href="/radar" icon="⚡" label="Sinyal Radarı" pathname={pathname} onClick={() => setIsMobileMenuOpen(false)} />
          <SidebarLink href="/day-desk" icon="🎯" label="Day-Desk" pathname={pathname} onClick={() => setIsMobileMenuOpen(false)} />
          <SidebarLink href="/news" icon="📰" label="Haberler" pathname={pathname} onClick={() => setIsMobileMenuOpen(false)} />
          <SidebarLink href="/premium-dashboard" icon="🔔" label="Alarmlar" pathname={pathname} onClick={() => setIsMobileMenuOpen(false)} />
          <SidebarLink href="/history" icon="📜" label="Sistem Logları" pathname={pathname} onClick={() => setIsMobileMenuOpen(false)} />
          
          <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-8 mb-3 px-2">Araçlar</div>
          <SidebarLink href="/tracker" icon="📈" label="Takipçi" pathname={pathname} onClick={() => setIsMobileMenuOpen(false)} />
          <SidebarLink href="/report" label="📊 Rapor Oluştur" pathname={pathname} onClick={() => setIsMobileMenuOpen(false)} />
          <SidebarLink href="/cross-check" label="🔀 Çapraz Kontrol" pathname={pathname} onClick={() => setIsMobileMenuOpen(false)} />
          <SidebarLink href="/backtest" label="🔄 Klasik Backtest" pathname={pathname} onClick={() => setIsMobileMenuOpen(false)} />
          <SidebarLink href="/quant-lab" icon="🧮" label="Kantitatif Motor" pathname={pathname} onClick={() => setIsMobileMenuOpen(false)} />
          <SidebarLink href="/quant-scanner" icon="🔭" label="Kantitatif Tarayıcı" pathname={pathname} onClick={() => setIsMobileMenuOpen(false)} />
          <SidebarLink href="/compliance" icon="🛡️" label="Uyum Denetimi" pathname={pathname} onClick={() => setIsMobileMenuOpen(false)} />
        </nav>
        
        <div className="p-4 border-t border-white/5">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5 transition cursor-pointer">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-xs font-bold text-white shadow-[0_0_15px_rgba(34,211,238,0.3)]">
              OG
            </div>
            <div>
              <p className="text-xs font-bold text-white">Ogün Güneş</p>
              <p className="text-[10px] text-cyan-400">Premium Üye</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0b0f19]">
        {/* Top Header */}
        <header className="h-16 md:h-20 border-b border-white/5 bg-[#0b0f19]/80 backdrop-blur-md flex items-center justify-between px-4 md:px-6 flex-shrink-0 z-20 sticky top-0">
          {/* Mobile Menu Toggle */}
          <div className="md:hidden flex items-center gap-3">
            <button 
              className="text-cyan-400 p-1 hover:bg-white/5 rounded-md transition"
              onClick={() => setIsMobileMenuOpen(true)}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
            <span className="font-bold text-white text-sm">Kazananlar Kulübü</span>
          </div>

          {/* Status Badges */}
          <div className="hidden md:flex items-center gap-3">
            {isGlobalScanning ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded border border-sky-500/30 bg-sky-500/10 text-[10px] font-black tracking-widest text-sky-300 animate-pulse">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                </span>
                🔄 TARAMA DEVAM EDİYOR
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded border border-emerald-500/20 bg-emerald-500/10 text-[10px] font-black tracking-widest text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                LOCAL API BAĞLANTISI: AKTİF
              </div>
            )}
          </div>

          {/* Right Icons */}
          <div className="flex items-center gap-3 md:gap-4 text-slate-400">
            <button className="hover:text-cyan-400 transition hidden sm:block">💬</button>
            <button className="hover:text-cyan-400 transition relative">
              🔔
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-rose-500 rounded-full"></span>
            </button>
            <button className="hover:text-cyan-400 transition ml-1 md:ml-2 bg-white/5 p-1.5 rounded-full border border-white/10">👤</button>
          </div>
        </header>

        {/* Global Scan Progress Banner (visible on all pages, all devices) */}
        {isGlobalScanning && (
          <div className="w-full bg-gradient-to-r from-sky-900/80 to-blue-900/80 border-b border-sky-500/30 px-4 py-2 flex items-center gap-3 text-xs font-bold text-sky-300 backdrop-blur-sm">
            <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-500"></span>
            </span>
            <span className="flex-1">
              🔄 Arka planda piyasa taraması devam ediyor — Sayfalar arasında serbestçe gezinebilirsiniz, tarama durmayacak.
            </span>
          </div>
        )}

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
          <div className="h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

function SidebarLink({ href, label, icon, pathname, onClick }: { href: string; label: string; icon?: string; pathname: string; onClick: () => void }) {
  const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
  
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group border ${
        isActive 
          ? "bg-cyan-500/10 text-white border-cyan-500/20 shadow-[0_0_10px_rgba(34,211,238,0.05)]" 
          : "text-slate-400 hover:text-white hover:bg-white/5 border-transparent hover:border-white/5"
      }`}
    >
      {icon && <span className={`${isActive ? "text-cyan-400" : "text-slate-500 group-hover:text-cyan-400"} transition-colors`}>{icon}</span>}
      {label}
    </Link>
  );
}
