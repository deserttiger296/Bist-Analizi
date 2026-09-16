"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NewsItem } from "@/lib/news";

export default function NewsPage() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [filteredNews, setFilteredNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string>("ALL");

  useEffect(() => {
    // Client-side fetch from our newly-integrated database route
    fetch('/api/bist/news')
      .then(res => res.json())
      .then(data => {
        const items = data.news || [];
        setNews(items);
        setFilteredNews(items);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to load news:", err);
        setLoading(false);
      });
  }, []);

  const handleFilterChange = (filter: string) => {
    setActiveFilter(filter);
    if (filter === "ALL") {
      setFilteredNews(news);
    } else {
      setFilteredNews(news.filter(item => item.source === filter));
    }
  };

  const getSourceIcon = (source: string) => {
    switch(source) {
      case 'KAP': return '📜';
      case 'ARACI_KURUM': return '🏦';
      case 'FON_GIRIS': return '🐳';
      default: return '📰';
    }
  };

  const getSourceLabel = (source: string) => {
    switch(source) {
      case 'KAP': return 'KAP Bildirimi';
      case 'ARACI_KURUM': return 'Aracı Kurum Raporu';
      case 'FON_GIRIS': return 'Fon Akış Takibi';
      default: return 'Medya / Diğer';
    }
  };

  const getSentimentStyles = (sentiment: string) => {
    if (sentiment === 'positive') return 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300 shadow-emerald-950/20';
    if (sentiment === 'negative') return 'border-rose-500/25 bg-rose-500/5 text-rose-300 shadow-rose-950/20';
    return 'border-slate-800 bg-slate-900/30 text-slate-300 shadow-slate-950/40';
  };

  const getSentimentBadge = (sentiment: string) => {
    if (sentiment === 'positive') {
      return (
        <span className="px-2 py-0.5 rounded text-[9px] font-black bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 uppercase tracking-widest">
          ✓ Pozitif
        </span>
      );
    }
    if (sentiment === 'negative') {
      return (
        <span className="px-2 py-0.5 rounded text-[9px] font-black bg-rose-500/10 border border-rose-500/20 text-rose-400 uppercase tracking-widest">
          ✗ Olumsuz
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[9px] font-black bg-slate-800/50 border border-slate-700/50 text-slate-400 uppercase tracking-widest">
        • Nötr
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20 min-h-[50vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-cyan-500 border-t-transparent shadow-[0_0_15px_rgba(6,182,212,0.5)]" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 py-2">
      
      {/* Title & Header Section */}
      <div className="relative border-b border-slate-800/80 pb-6 overflow-hidden">
        {/* Glow highlight */}
        <div className="absolute top-0 right-0 w-80 h-32 bg-cyan-500/5 rounded-full blur-3xl -z-10" />
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 flex items-center gap-3">
              📰 BIST İstihbarat & Haber Ağı
            </h1>
            <p className="text-xs font-bold text-slate-400 mt-2 uppercase tracking-widest">
              Analiz Tavsiyeleri, Anlık KAP Gelişmeleri ve Kurumsal Akışlar
            </p>
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest text-cyan-400 bg-cyan-950/40 border border-cyan-800/30 px-3 py-1.5 rounded-lg">
            ⚡ Canlı İstihbarat Aktif
          </span>
        </div>
      </div>

      {/* Filter Options Panel */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-900/30 border border-slate-800/60 p-2 rounded-xl backdrop-blur-sm">
        <button
          onClick={() => handleFilterChange("ALL")}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
            activeFilter === "ALL"
              ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          🗂️ Tümü ({news.length})
        </button>
        <button
          onClick={() => handleFilterChange("KAP")}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
            activeFilter === "KAP"
              ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          📜 KAP Bildirimleri ({news.filter(n => n.source === 'KAP').length})
        </button>
        <button
          onClick={() => handleFilterChange("ARACI_KURUM")}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
            activeFilter === "ARACI_KURUM"
              ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          🏦 Aracı Kurum Raporları ({news.filter(n => n.source === 'ARACI_KURUM').length})
        </button>
        <button
          onClick={() => handleFilterChange("FON_GIRIS")}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
            activeFilter === "FON_GIRIS"
              ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          🐳 Fon Akışları ({news.filter(n => n.source === 'FON_GIRIS').length})
        </button>
        <button
          onClick={() => handleFilterChange("MEDYA")}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
            activeFilter === "MEDYA"
              ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg"
              : "text-slate-400 hover:text-white hover:bg-slate-800/50"
          }`}
        >
          📰 Medya / Diğer ({news.filter(n => n.source === 'MEDYA').length})
        </button>
      </div>

      {/* Main Grid Feed */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredNews.map((item) => (
          <div
            key={item.id}
            className={`rounded-2xl border p-5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-cyan-500/30 flex flex-col justify-between shadow-2xl relative group ${getSentimentStyles(
              item.sentiment
            )}`}
          >
            {/* Top info and source badge */}
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">{getSourceIcon(item.source)}</span>
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  {getSourceLabel(item.source)}
                </span>
              </div>
              <span className="text-[9px] font-bold text-slate-500 bg-slate-950/40 px-2.5 py-1 rounded-md border border-slate-800">
                {new Date(item.date).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {/* Title & Body */}
            <div>
              {item.symbol && (
                <Link
                  href={`/analysis/${item.symbol}`}
                  className="inline-block px-2.5 py-0.5 bg-slate-950/60 rounded-md border border-slate-800/80 text-[11px] font-black text-cyan-400 hover:text-white transition-colors duration-200 hover:bg-cyan-950/20 mb-3"
                >
                  📍 {item.symbol}
                </Link>
              )}
              
              <h3 className="font-bold text-sm text-white mb-2 leading-snug group-hover:text-cyan-400 transition-colors duration-200">
                {item.title}
              </h3>
              
              <p className="text-xs text-slate-400 leading-relaxed font-medium mb-4 line-clamp-4">
                {item.content}
              </p>
            </div>

            {/* Bottom Panel */}
            <div className="pt-3 border-t border-slate-800/60 flex justify-between items-center text-[10px] font-bold">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                {item.source.replace('_', ' ')}
              </span>
              {getSentimentBadge(item.sentiment)}
            </div>

            {/* Decorative arrow overlay */}
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute top-4 right-4 text-xs text-slate-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ↗
              </a>
            )}
          </div>
        ))}
        
        {filteredNews.length === 0 && (
          <div className="col-span-full py-20 text-center text-slate-500 font-bold text-sm bg-slate-950/20 border border-slate-800/40 rounded-2xl">
            Bu kaynak grubu için güncel bir istihbarat akışı bulunmuyor.
          </div>
        )}
      </div>
    </div>
  );
}
