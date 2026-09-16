"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
// Firebase removed
import { AlarmRecord } from "@/lib/alarmLog";

const LightweightChartWidget = dynamic(
  () => import("@/components/LightweightChartWidget").then(mod => mod.LightweightChartWidget),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col h-[400px] w-full items-center justify-center rounded-2xl bg-[#0b0f19] border border-slate-800/80">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-cyan-500 border-t-transparent shadow-[0_0_15px_rgba(6,182,212,0.3)]" />
        <p className="text-xs font-semibold text-slate-400 mt-4 uppercase tracking-widest animate-pulse">Grafik Motoru Yükleniyor...</p>
      </div>
    )
  }
);

export default function Dashboard() {
  const [activeAlarms, setActiveAlarms] = useState<AlarmRecord[]>([]);
  const [logs, setLogs] = useState<{ id: number; type: string; msg: string; time: string }[]>([]);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [livePriceUsd, setLivePriceUsd] = useState<number | null>(null);
  const [currency, setCurrency] = useState<'try' | 'usd'>('try');
  
  const [showAlarmsMenu, setShowAlarmsMenu] = useState(false);
  const [showLogsMenu, setShowLogsMenu] = useState(false);

  const downloadLogs = () => {
    const text = logs.map(l => `[${l.time}] ${l.type}: ${l.msg}`).join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bist_system_logs_${new Date().toISOString().split('T')[0]}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    setShowLogsMenu(false);
  };

  // Simulation of Firebase Live Alarms & Logs
  useEffect(() => {
    // Fetch live price for XU100
    fetch('/api/bist/XU100')
      .then(res => res.json())
      .then(data => {
        if (data && data.lastClose) {
          setLivePrice(data.lastClose);
          setLivePriceUsd(data.priceUsd);
        } else if (data.data?.lastClose) {
          setLivePrice(data.data.lastClose);
          setLivePriceUsd(data.data.priceUsd);
        }
      })
      .catch(err => console.error("Failed to fetch live price:", err));
    // Firebase removed - Using local state or API
    // Fetch live alarms from local API
    fetch('/api/bist/background')
      .then(res => res.json())
      .then(data => {
        if (data && data.results) {
          const alarms = data.results.filter((r: any) => r.status === "ALARM" || r.status === "AL" || r.alert).slice(0, 10);
          setActiveAlarms(alarms);
          addLog("VERİ", "Lokal senkronizasyon tamamlandı.");
          if (alarms.length > 0) {
            addLog("ALARM", `${alarms[0].symbol} sinyal tetiklendi.`);
          }
        }
      })
      .catch(err => console.error("Failed to fetch local alarms:", err));

    const unsub = () => {};

    // Mock logs interval
    const interval = setInterval(() => {
      const events = [
        { t: "BOT", m: "Veri Alındı" },
        { t: "VERİ", m: `RSI Hesaplandı: ${Math.floor(Math.random() * 40) + 30}` },
        { t: "SİSTEM", m: "Tarayıcı döngüsü çalışıyor..." }
      ];
      const ev = events[Math.floor(Math.random() * events.length)];
      addLog(ev.t, ev.m);
    }, 4500);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, []);

  const addLog = (type: string, msg: string) => {
    setLogs(prev => {
      const newLogs = [{ id: Date.now(), type, msg, time: new Date().toLocaleTimeString("tr-TR") }, ...prev];
      return newLogs.slice(0, 50); // keep last 50
    });
  };

  return (
    <div className="h-full p-4 md:p-6 flex flex-col xl:grid xl:grid-cols-4 gap-4 md:gap-6">
      {/* Left/Center Column - Main Chart & Content */}
      <div className="xl:col-span-3 flex flex-col gap-4 md:gap-6">
        
        {/* Main Chart Area */}
        <div className="bg-[#0f1524] rounded-2xl border border-white/5 overflow-hidden flex flex-col flex-1 min-h-[350px] md:min-h-[500px] shadow-2xl relative">
          <div className="p-4 border-b border-white/5 flex justify-between items-center bg-[#0b0f19]/50">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-black text-white">BIST100 / {currency.toUpperCase()}</h2>
              <span className="text-xs text-slate-500 mr-2">XU100</span>
              
              {/* Currency Toggle Switcher */}
              <div className="flex bg-slate-950/80 rounded-lg p-0.5 border border-white/5">
                <button
                  onClick={() => setCurrency('try')}
                  className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                    currency === 'try'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'text-slate-500 hover:text-slate-300 border border-transparent'
                  }`}
                >
                  ₺ TRY
                </button>
                <button
                  onClick={() => setCurrency('usd')}
                  className={`px-2.5 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                    currency === 'usd'
                      ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                      : 'text-slate-500 hover:text-slate-300 border border-transparent'
                  }`}
                >
                  $ USD
                </button>
              </div>
            </div>
            {currency === 'try' ? (
              livePrice !== null ? (
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-md text-emerald-400 font-bold text-xs">
                  ANLIK FİYAT: {livePrice.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-slate-500/10 border border-slate-500/20 px-3 py-1 rounded-md text-slate-400 font-bold text-xs animate-pulse">
                  FİYAT GÜNCELLENİYOR...
                </div>
              )
            ) : (
              livePriceUsd !== null ? (
                <div className="flex items-center gap-2 bg-sky-500/10 border border-sky-500/20 px-3 py-1 rounded-md text-sky-400 font-bold text-xs">
                  ANLIK FİYAT: ${livePriceUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-slate-500/10 border border-slate-500/20 px-3 py-1 rounded-md text-slate-400 font-bold text-xs animate-pulse">
                  FİYAT GÜNCELLENİYOR...
                </div>
              )
            )}
          </div>
          <div className="flex-1 p-0 flex flex-col relative w-full min-h-[300px]">
             <LightweightChartWidget symbol="XU100" height={400} currency={currency} />
             <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto">
               <Link href="/analysis/XU100" className="px-6 py-2 bg-cyan-600/90 text-white font-bold rounded-full border border-cyan-400/50 hover:bg-cyan-500 hover:scale-105 transition shadow-[0_0_15px_rgba(34,211,238,0.5)] backdrop-blur-md">
                 Detaylı Analizi Aç
               </Link>
             </div>
          </div>
        </div>

        {/* Quick Nav Cards from Old Layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/scanner" className="bg-[#0f1524] p-5 rounded-2xl border border-white/5 hover:border-cyan-500/30 transition group relative overflow-hidden">
             <div className="text-3xl mb-2 group-hover:scale-110 transition-transform origin-left">📡</div>
             <h4 className="text-white font-bold tracking-wider">PİYASA TARAYICISI</h4>
             <p className="text-xs text-slate-500 mt-1">12 indikatör ile tüm hisseleri tarayın.</p>
             <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-xl -mr-10 -mt-10 group-hover:bg-cyan-500/10 transition"></div>
          </Link>
          <Link href="/tracker" className="bg-[#0f1524] p-5 rounded-2xl border border-white/5 hover:border-purple-500/30 transition group relative overflow-hidden">
             <div className="text-3xl mb-2 group-hover:scale-110 transition-transform origin-left">📈</div>
             <h4 className="text-white font-bold tracking-wider">CANLI TAKİPÇİ</h4>
             <p className="text-xs text-slate-500 mt-1">Seçili hisselerin anlık veri akışı.</p>
             <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-full blur-xl -mr-10 -mt-10 group-hover:bg-purple-500/10 transition"></div>
          </Link>
          <Link href="/history" className="bg-[#0f1524] p-5 rounded-2xl border border-white/5 hover:border-emerald-500/30 transition group relative overflow-hidden">
             <div className="text-3xl mb-2 group-hover:scale-110 transition-transform origin-left">📜</div>
             <h4 className="text-white font-bold tracking-wider">SİSTEM GEÇMİŞİ</h4>
             <p className="text-xs text-slate-500 mt-1">Geçmiş alarm ve başarı kayıtları.</p>
             <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl -mr-10 -mt-10 group-hover:bg-emerald-500/10 transition"></div>
          </Link>
        </div>

      </div>

      {/* Right Column - Alarms & Logs */}
      <div className="xl:col-span-1 flex flex-col gap-6">
        
        {/* Active Alarms Panel */}
        <div className="bg-[#0f1524] rounded-2xl border border-white/5 flex flex-col h-[45%]">
          <div className="p-4 border-b border-white/5 flex justify-between items-center relative">
            <h3 className="text-sm font-bold text-white tracking-wider uppercase">Aktif Alarmlar</h3>
            <div className="relative">
              <button 
                onClick={() => setShowAlarmsMenu(!showAlarmsMenu)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-all cursor-pointer font-bold text-lg select-none"
                title="Menü"
              >
                •••
              </button>
              {showAlarmsMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowAlarmsMenu(false)} />
                  <div className="absolute right-0 mt-1 w-48 rounded-xl bg-slate-900 border border-white/10 p-1.5 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                    <Link 
                      href="/history"
                      onClick={() => setShowAlarmsMenu(false)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/5 transition-all text-left"
                    >
                      <span>📜</span> Tüm Alarm Geçmişi
                    </Link>
                    <button
                      onClick={() => { setActiveAlarms([]); setShowAlarmsMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all text-left cursor-pointer"
                    >
                      <span>🧹</span> Alarmları Temizle
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500 sticky top-0 bg-[#0f1524]">
                <tr>
                  <th className="font-normal p-2 border-b border-white/5">Sembol</th>
                  <th className="font-normal p-2 border-b border-white/5">Kriter</th>
                  <th className="font-normal p-2 border-b border-white/5 text-right">Durum</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {activeAlarms.length > 0 ? activeAlarms.map((alarm, i) => (
                  <tr key={alarm.id || i} className="hover:bg-white/[0.02] transition">
                    <td className="p-2 border-b border-white/5 font-semibold text-white">
                      <Link href={`/analysis/${alarm.symbol}`} className="hover:text-cyan-400 hover:underline transition-colors">
                        {alarm.symbol}
                      </Link>
                    </td>
                    <td className="p-2 border-b border-white/5 truncate max-w-[80px]">{alarm.reasons[0] || "Osilatör Kesişimi"}</td>
                    <td className="p-2 border-b border-white/5 text-right">
                      <span className="text-rose-400">Tetiklendi</span>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-slate-500">Aktif alarm yok</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live System Logs Terminal */}
        <div className="bg-[#0b0f19] rounded-2xl border border-white/5 flex flex-col flex-1 shadow-inner relative overflow-hidden">
          <div className="p-4 border-b border-white/5 flex justify-between items-center bg-[#0f1524] relative">
            <h3 className="text-sm font-bold text-white tracking-wider uppercase">Canlı Sistem Logları</h3>
            <div className="relative">
              <button 
                onClick={() => setShowLogsMenu(!showLogsMenu)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-all cursor-pointer font-bold text-lg select-none"
                title="Menü"
              >
                •••
              </button>
              {showLogsMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowLogsMenu(false)} />
                  <div className="absolute right-0 mt-1 w-44 rounded-xl bg-slate-900 border border-white/10 p-1.5 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                    <button
                      onClick={() => { setLogs([]); setShowLogsMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/5 transition-all text-left cursor-pointer"
                    >
                      <span>🧹</span> Logları Temizle
                    </button>
                    <button
                      onClick={downloadLogs}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-all text-left cursor-pointer"
                    >
                      <span>📥</span> Logları İndir
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-[10px] sm:text-xs scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent pb-10">
            {logs.map(log => {
              const typeColor = 
                log.type === "ALARM" ? "text-rose-400" :
                log.type === "VERİ" ? "text-emerald-400" :
                log.type === "SİSTEM" ? "text-cyan-400" : "text-slate-400";
              
              return (
                <div key={log.id} className="flex gap-2">
                  <span className={`font-bold ${typeColor} w-12 flex-shrink-0`}>{log.type}:</span>
                  <span className="text-slate-300 break-words">{log.msg}</span>
                </div>
              );
            })}
            <div className="animate-pulse flex gap-2 mt-2">
              <span className="text-slate-600 font-bold w-12">_</span>
            </div>
          </div>
          {/* Fading bottom edge */}
          <div className="absolute bottom-0 left-0 w-full h-8 bg-gradient-to-t from-[#0b0f19] to-transparent pointer-events-none"></div>
        </div>

      </div>
    </div>
  );
}
