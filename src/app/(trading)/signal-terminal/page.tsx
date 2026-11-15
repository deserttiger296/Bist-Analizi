"use client";

import React, { useState, useEffect } from "react";
import { WorkspacePage, Panel, MetricCard, EmptyState } from "@/components/ui/Workspace";

interface Rule {
  code: string;
  desc: string;
}

interface Regime {
  type: string;
  vol: string;
  mom: string;
  conf: string;
}

interface Report {
  symbol: string;
  fullname: string;
  price: string;
  change: string;
  score: number | null;
  signalWord: string;
  regime: Regime | null;
  verdict: string;
  rules: Rule[];
  category: "buy" | "weak" | "watch";
}

interface PaperPosition {
  id: string;
  symbol: string;
  fullname: string;
  type: "BUY" | "SELL";
  entryPrice: number;
  amount: number;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closePrice: number | null;
  closedAt: string | null;
  pnl: number;
  pnlPct: number;
}

const SAMPLE_DATA = `💰 1. BAGFS (BAGFAS) Analiz Raporu

* Canlı Fiyat: 25.32 TL (-%0.24)
* Orijinal Teknik Skor: 34/100
* Hibrit Kompozit Skor (FSI): 34/100
* Kural Motoru Sinyali: \`WEAK\`
* Piyasa Rejimi (HMM): \`TREND\` (Volatilite: %29.8, Momentum: -%7.8, Güven: %71)
* Sistem Önerisi:
⚠️ STOP KIRILDI (YENİ ANALİZ): Fiyat ana stop seviyesinin (27.09₺) altına sarktı. Yeni stop 23.57₺ ve destekler (27.48₺ / 25.32₺) takip edilerek kademeli alım veya izleme yapılabilir. Hedef: $1.02
* Geçen Önemli Kurallar:
   * \`[MM-10]\`: Taban düzeltme derinliği %35.4 seviyesinde (limit: < %60).
   * \`[MM-22]\`: Simetrik sıkışma mevcut. Volatilite azalarak daralıyor (Son 10 bar: %3.32, önceki: %3.45).
   * \`[WMD-02]\`: Son düzeltme derinliği (%12.3) öncekine göre (%32.3) daha dar. Trend güçlü.
   * \`[WMD-05]\`: Geri çekilmede hacim ortalamanın altında (611,698 vs 1,150,209).
   * \`[WMD-13]\`: İkincil test (ST) geçerli: Hacim klimatik bardan daha düşük.

💰 2. PETKM (PETKİM) Analiz Raporu

* Canlı Fiyat: 19.01 TL (-%0.52)
* Orijinal Teknik Skor: 37/100
* Hibrit Kompozit Skor (FSI): 37/100
* Kural Motoru Sinyali: \`WEAK\`
* Piyasa Rejimi (HMM): \`TREND\` (Volatilite: %32.9, Momentum: -%9.6, Güven: %77)
* Sistem Önerisi:
⚠️ STOP KIRILDI (YENİ ANALİZ): Fiyat ana stop seviyesinin (20.21₺) altına sarktı. Yeni stop 17.70₺ ve destekler (20.48₺ / 19.01₺) takip edilerek kademeli alım veya izleme yapılabilir. Hedef: $0.72
* Geçen Önemli Kurallar:
   * \`[MM-10]\`: Taban düzeltme derinliği %32.9 seviyesinde (limit: < %60).
   * \`[MM-22]\`: Simetrik sıkışma mevcut. Volatilite azalarak daralıyor (Son 10 bar: %3.13, önceki: %4.17).
   * \`[ST-01]\`: Düşüş barı azalan hacimle uyumlu (Fiyat düşerken satış baskısı azalıyor).
   * \`[WMD-02]\`: Son düzeltme derinliği (%17.1) öncekine göre (%22.4) daha dar.
   * \`[WMD-05]\`: Geri çekilmede hacim ortalamanın altında.
   * \`[WMD-13]\`: İkincil test (ST) geçerli: Hacim klimatik bardan daha düşük (64M vs 154M).

💰 3. TUPRS (TÜPRAŞ) Analiz Raporu

* Canlı Fiyat: 236.90 TL (+%4.13)
* Orijinal Teknik Skor: 68/100
* Hibrit Kompozit Skor (FSI): 68/100
* Kural Motoru Sinyali: \`WEAK\` (Not: Minervini Aşama 2 trend şablonunun çalışması için gereken 200 günlük bar verisi henüz önbellekte birikmediği için "Yetersiz Veri" uyarısı vermektedir, ancak kısa vadeli kuralları başarıyla geçmiştir).
* Piyasa Rejimi (HMM): \`TREND\` (Volatilite: %34.7, Momentum: +%2.0, Güven: %55)
* Sistem Önerisi:
🟡 AL: Confluans 68%, Kalite 4/4. Giriş: 236.90₺ | S1: 233.93₺ | Hedef: $5.30 | Fibo Hedefi: $6.84
* Geçen Önemli Kurallar (Kritik Alım Emareleri var!):
   * \`[MM-10]\`: Taban düzeltme derinliği %23.0 seviyesinde (limit: < %60).
   * \`[MM-17]\`: Pivot direnci (227.60) yukarı yönlü kırıldı. Kapanış: 236.90, Hacim Katsayısı: 1.38x.
   * \`[ST-01]\`: Yükseliş barı artan hacimle onaylandı (29.9M vs 29.4M).
   * \`[ST-04]\`: Akümülasyon Sinyali: Barın en üst %25'lik diliminde kapanış yapıldı. Güçlü kurumsal alım baskısı var.
   * \`[WMD-02]\`: Son düzeltme derinliği (%12.6) öncekine göre (%15.3) daha dar. Trend güçlü.
   * \`[WMD-04]\`: İtki hareketinde hacim artarak yükselişi onaylıyor.`;

export default function SignalTerminal() {
  const [inputText, setInputText] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const [activeFilter, setActiveFilter] = useState<"ALL" | "buy" | "weak" | "watch">("ALL");
  const [hintMessage, setHintMessage] = useState("");
  const [openCards, setOpenCards] = useState<Record<number, boolean>>({});

  // Push notifications state
  const [hasNotificationPermission, setHasNotificationPermission] = useState(false);

  // Paper Trading state
  const [paperPositions, setPaperPositions] = useState<PaperPosition[]>([]);
  const [newSym, setNewSym] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newType, setNewType] = useState<"BUY" | "SELL">("BUY");
  const [closeInputs, setCloseInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    // Check web push permission status on mount
    if (typeof window !== "undefined" && "Notification" in window) {
      setHasNotificationPermission(Notification.permission === "granted");
    }
    // Fetch paper portfolio on mount
    fetchPaperPortfolio();
  }, []);

  const requestNotificationPermission = async () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      const permission = await Notification.requestPermission();
      setHasNotificationPermission(permission === "granted");
      if (permission === "granted") {
        new Notification("Sinyal Terminali", {
          body: "Anlık bildirimler başarıyla aktif edildi!",
        });
      }
    }
  };

  const fetchPaperPortfolio = async () => {
    try {
      const res = await fetch("/api/bist/paper");
      if (res.ok) {
        const data = await res.json();
        setPaperPositions(data);
      }
    } catch (err) {
      console.error("Paper portfolio fetch error:", err);
    }
  };

  const openPosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSym || !newPrice || !newQty) return;

    try {
      const res = await fetch("/api/bist/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: newSym,
          entryPrice: parseFloat(newPrice),
          amount: parseFloat(newQty),
          type: newType,
        }),
      });

      if (res.ok) {
        setNewSym("");
        setNewPrice("");
        setNewQty("");
        fetchPaperPortfolio();
      }
    } catch (err) {
      console.error("Failed to open position:", err);
    }
  };

  const closePosition = async (id: string) => {
    const closePrice = closeInputs[id];
    if (!closePrice) return;

    try {
      const res = await fetch("/api/bist/paper", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          closePrice: parseFloat(closePrice),
        }),
      });

      if (res.ok) {
        setCloseInputs((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        fetchPaperPortfolio();
      }
    } catch (err) {
      console.error("Failed to close position:", err);
    }
  };

  const classifyCategory = (verdictText: string, signalWord: string): "buy" | "weak" | "watch" => {
    const v = verdictText.toUpperCase();
    if (v.includes("AL:") || v.startsWith("🟢") || v.startsWith("🟡 AL")) return "buy";
    if (v.includes("STOP KIRILDI") || v.includes("SAT")) return "weak";
    if (signalWord && signalWord.toUpperCase().includes("WEAK")) return "weak";
    return "watch";
  };

  const parseReports = (text: string) => {
    const raw = text.trim();
    if (!raw) {
      setHintMessage("Önce metin yapıştırın.");
      return;
    }

    const blocks = raw.split(/(?=💰)/).map((b) => b.trim()).filter(Boolean);
    const parsedReports: Report[] = [];

    blocks.forEach((block) => {
      const headMatch = block.match(/💰\s*\d+\.\s*([A-ZÇĞİÖŞÜ0-9.]+)\s*\(([^)]+)\)/i);
      if (!headMatch) return;
      const symbol = headMatch[1].trim();
      const fullname = headMatch[2].trim();

      const priceMatch = block.match(/Canlı Fiyat:\s*([\d.,]+)\s*TL\s*\(([+-]?%?[\d.,]+%?)\)/i);
      const price = priceMatch ? priceMatch[1] : "—";
      const change = priceMatch ? priceMatch[2] : "";

      const fsiMatch =
        block.match(/Hibrit Kompozit Skor \(FSI\):\s*(\d+)\/100/i) ||
        block.match(/Orijinal Teknik Skor:\s*(\d+)\/100/i);
      const score = fsiMatch ? parseInt(fsiMatch[1], 10) : null;

      const signalMatch = block.match(/Kural Motoru Sinyali:\s*`?([A-ZÇĞİÖŞÜ]+)`?/i);
      const signalWord = signalMatch ? signalMatch[1] : "";

      const regimeMatch = block.match(
        /Piyasa Rejimi \(HMM\):\s*`?([A-ZÇĞİÖŞÜ]+)`?\s*\(Volatilite:\s*%([\d.,]+),\s*Momentum:\s*([+-]?%?[\d.,]+%?),\s*Güven:\s*%([\d.,]+)\)/i
      );
      const regime = regimeMatch
        ? {
            type: regimeMatch[1],
            vol: regimeMatch[2],
            mom: regimeMatch[3],
            conf: regimeMatch[4],
          }
        : null;

      const verdictMatch = block.match(/Sistem Önerisi:\s*([\s\S]*?)(?=\*\s*Geçen Önemli Kurallar|$)/i);
      const verdict = verdictMatch ? verdictMatch[1].trim().replace(/^\*\s*/, "") : "";

      const ruleMatches = [...block.matchAll(/`\[([A-Z0-9-]+)\]`:\s*([^\n]+)/g)];
      const rules = ruleMatches.map((m) => ({ code: m[1], desc: m[2].trim() }));

      const category = classifyCategory(verdict, signalWord);

      // Trigger Web Push Notification if high-FSI AL signal is detected
      if (category === "buy" && score && score >= 65 && typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        new Notification(`YÜKSEK SKOR SİNYALİ: ${symbol}`, {
          body: `${symbol} (${fullname}) Hisse AL Sinyali verdi! FSI Skoru: ${score}/100. Giriş: ${price} TL`,
        });
      }

      parsedReports.push({
        symbol,
        fullname,
        price,
        change,
        score,
        signalWord,
        regime,
        verdict,
        rules,
        category,
      });
    });

    setReports(parsedReports);
    setHintMessage(
      parsedReports.length
        ? `${parsedReports.length} rapor işlendi.`
        : "Hiçbir rapor tanınamadı — format farklı olabilir."
    );
    setOpenCards({});
  };

  const loadSample = () => {
    setInputText(SAMPLE_DATA);
    parseReports(SAMPLE_DATA);
  };

  const clearAll = () => {
    setInputText("");
    setReports([]);
    setHintMessage("");
    setOpenCards({});
  };

  const toggleCard = (idx: number) => {
    setOpenCards((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const counts = {
    ALL: reports.length,
    buy: reports.filter((r) => r.category === "buy").length,
    weak: reports.filter((r) => r.category === "weak").length,
    watch: reports.filter((r) => r.category === "watch").length,
  };

  const filtered = reports
    .filter((r) => (activeFilter === "ALL" ? true : r.category === activeFilter))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // Portfolio aggregates
  const openPositions = paperPositions.filter((p) => p.status === "OPEN");
  const closedPositions = paperPositions.filter((p) => p.status === "CLOSED");
  const totalPnL = closedPositions.reduce((acc, p) => acc + p.pnl, 0);

  return (
    <WorkspacePage title="Sinyal Terminali" eyebrow="RSI ANALİZİ · RAPOR VE SANAL PORTFÖY" description="Analiz raporlarını yapılandırılmış kartlara dönüştürün; sinyalleri filtreleyin ve sanal pozisyonlarınızı takip edin. Örnek raporlar canlı piyasa verisi değildir." actions={<button type="button" onClick={requestNotificationPermission} className="rsi-button">{hasNotificationPermission ? "Bildirimler açık" : "Bildirimleri etkinleştir"}</button>}>
      {/* Input Panel */}
      <Panel title="Rapor girişi" description="Analiz metnini yapıştırın veya biçimi görmek için örnek raporları yükleyin.">
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Analiz raporunu buraya yapıştırın…" aria-label="Analiz raporu metni"
          className="w-full min-h-[160px] bg-[#101925] border border-[#233043] rounded-lg text-[#eaf0f6] font-mono text-[12.5px] p-3 resize-y leading-relaxed outline-none focus:border-[#69ddbb] transition-colors"
        />
        <div className="flex flex-wrap gap-2.5 items-center mt-3">
          <button
            onClick={() => parseReports(inputText)}
            className="rsi-button rsi-button-primary"
          >
            Raporları işle
          </button>
          <button
            onClick={loadSample}
            className="rsi-button"
          >
            Örnek rapor yükle
          </button>
          <button
            onClick={clearAll}
            className="rsi-button"
          >
            Temizle
          </button>
          {hintMessage && (
            <span className="text-xs text-[#93a2b7] ml-auto font-mono">{hintMessage}</span>
          )}
        </div>
      </Panel>
      {reports.length === 0 && <EmptyState title="Henüz işlenmiş rapor yok" description="Bir analiz metni ekleyip Raporları işle düğmesine basın. Örnek veriler yalnızca biçimi denemek içindir." />}

      {/* Results View */}
      {reports.length > 0 && (
        <Panel title="Rapor sonuçları" description="Raporlar kaynak metindeki FSI skoruna göre sıralanır.">
          {/* Chips Filter */}
          <div className="flex flex-wrap gap-2 mb-4">
            {(["ALL", "buy", "weak", "watch"] as const).map((key) => {
              const label =
                key === "ALL"
                  ? "Tümü"
                  : key === "buy"
                  ? "AL"
                  : key === "weak"
                  ? "ZAYIF / STOP"
                  : "İZLE";
              const isActive = activeFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveFilter(key)}
                  className={`font-mono text-xs py-1.5 px-4 rounded-full border transition-all ${
                    isActive
                      ? "bg-[#69ddbb] text-[#102b25] border-[#69ddbb]"
                      : "bg-[#121a25] text-[#93a2b7] border-[#233043] hover:border-[#93a2b7]"
                  }`}
                >
                  {label} · {counts[key]}
                </button>
              );
            })}
          </div>

          <div className="text-[12px] text-[#93a2b7] mb-3 font-mono">
            {filtered.length} sonuç · FSI skoruna göre sıralı
          </div>

          {filtered.length === 0 ? (
            <div className="text-center text-[#93a2b7] py-12 text-sm border border-dashed border-[#233043] rounded-lg">
              Bu filtrede rapor yok.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {filtered.map((r, idx) => {
                const isOpen = !!openCards[idx];
                const borderLeftColor =
                  r.category === "buy"
                    ? "border-l-[#69ddbb]"
                    : r.category === "weak"
                    ? "border-l-[#f47b91]"
                    : "border-l-[#F5A623]";

                const gaugeColor =
                  r.category === "buy"
                    ? "#69ddbb"
                    : r.category === "weak"
                    ? "#f47b91"
                    : "#F5A623";

                const isDown = r.change && r.change.trim().startsWith("-");
                const badgeStyle =
                  r.category === "buy"
                    ? "bg-[rgba(41,211,152,0.12)] text-[#69ddbb]"
                    : r.category === "weak"
                    ? "bg-[rgba(239,93,111,0.12)] text-[#f47b91]"
                    : "bg-[rgba(245,166,35,0.12)] text-[#F5A623]";

                return (
                  <div
                    key={idx}
                    className={`bg-[#121a25] border border-[#233043] border-l-4 rounded-lg overflow-hidden transition-all ${borderLeftColor}`}
                  >
                    {/* Header */}
                    <div
                      onClick={() => toggleCard(idx)}
                      role="button" tabIndex={0} aria-expanded={isOpen} aria-label={`${r.symbol} rapor ayrıntıları`}
                      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleCard(idx); } }}
                      className="grid grid-cols-2 md:grid-cols-[140px_110px_1fr_130px_150px_20px] gap-3 md:gap-4 items-center p-3.5 md:px-4 cursor-pointer hover:bg-[#182435]"
                    >
                      <div className="flex flex-col">
                        <b className="text-[15px] font-mono font-medium text-white">{r.symbol}</b>
                        <span className="text-[11px] text-[#93a2b7] truncate">{r.fullname}</span>
                      </div>
                      <div className="font-mono">
                        <b className="text-[14.5px] block text-white">{r.price} TL</b>
                        <span className={`text-[11.5px] ${isDown ? "text-[#f47b91]" : "text-[#69ddbb]"}`}>
                          {r.change}
                        </span>
                      </div>
                      <div className="col-span-2 md:col-span-1 flex flex-col gap-1">
                        <div className="text-[10.5px] text-[#93a2b7] font-mono flex justify-between">
                          <span>FSI</span>
                          <span className="text-white">{r.score ?? "—"}/100</span>
                        </div>
                        <div className="h-1.5 bg-[#101925] rounded-full overflow-hidden border border-[#233043]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${r.score ?? 0}%`,
                              backgroundColor: gaugeColor,
                            }}
                          />
                        </div>
                      </div>
                      <div className="text-[11px] font-mono text-[#93a2b7]">
                        {r.regime ? (
                          <>
                            <b className="text-[#eaf0f6]">{r.regime.type}</b>
                            <br />
                            Vol %{r.regime.vol} · Güven %{r.regime.conf}
                          </>
                        ) : (
                          "—"
                        )}
                      </div>
                      <div className={`font-mono text-[11px] py-1 px-2.5 rounded text-center font-semibold w-fit truncate ${badgeStyle}`}>
                        {r.category === "buy" ? "AL" : r.category === "weak" ? "ZAYIF" : "İZLE"}
                      </div>
                      <div
                        className={`text-[#93a2b7] transition-transform text-xs text-right hidden md:block ${
                          isOpen ? "rotate-90" : ""
                        }`}
                      >
                        ▶
                      </div>
                    </div>

                    {/* Details */}
                    {isOpen && (
                      <div className="p-4 pl-5 border-t border-[#233043] text-[12.5px] bg-[#111d2a]">
                        {r.verdict && (
                          <div className="mb-3.5 p-3 bg-[#101925] rounded-lg border border-[#233043] leading-relaxed whitespace-pre-wrap font-mono text-[12px] text-[#eaf0f6]">
                            {r.verdict}
                          </div>
                        )}
                        <ul className="flex flex-col gap-1.5">
                          {r.rules.map((rule, ruleIdx) => (
                            <li
                              key={ruleIdx}
                              className="font-mono text-[11.5px] text-[#93a2b7] relative pl-3.5 leading-relaxed"
                            >
                              <span className="absolute left-0 text-[#69ddbb]">›</span>
                              <code className="text-[#69ddbb] bg-transparent mr-1">[{rule.code}]</code>{" "}
                              {rule.desc}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}

      {/* PAPER TRADING PORTFOLIO SECTION */}
      <Panel title="Sanal portföy" description="Gerçek emir iletilmez. Bu alanda kaydedilen sanal pozisyonları ve gerçekleşen sonuçlarını izleyin.">
        <div className="workspace-metrics mb-5"><MetricCard label="Toplam kâr / zarar" value={`${totalPnL.toFixed(2)} TL`} tone={totalPnL >= 0 ? "positive" : "negative"} /><MetricCard label="Açık pozisyon" value={openPositions.length} /><MetricCard label="Kapanan pozisyon" value={closedPositions.length} /></div>
        {/* Position Opener Form */}
        <form onSubmit={openPosition} className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end mb-6">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono text-[#93a2b7] uppercase">Sembol</label>
            <input
              type="text"
              placeholder="örn: TUPRS"
              value={newSym}
              onChange={(e) => setNewSym(e.target.value)}
              className="bg-[#101925] border border-[#233043] text-sm text-white rounded p-2 outline-none focus:border-[#69ddbb]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono text-[#93a2b7] uppercase">Yön</label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as "BUY" | "SELL")}
              className="bg-[#101925] border border-[#233043] text-sm text-white rounded p-2 outline-none"
            >
              <option value="BUY">Alış (Long)</option>
              <option value="SELL">Satış (Short)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono text-[#93a2b7] uppercase">Giriş Fiyatı</label>
            <input
              type="number"
              step="0.01"
              placeholder="örn: 236.90"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              className="bg-[#101925] border border-[#233043] text-sm text-white rounded p-2 outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono text-[#93a2b7] uppercase">Adet</label>
            <input
              type="number"
              placeholder="örn: 100"
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              className="bg-[#101925] border border-[#233043] text-sm text-white rounded p-2 outline-none"
            />
          </div>
          <button
            type="submit"
            className="rsi-button rsi-button-primary col-span-2 md:col-span-1"
          >
            Pozisyon Aç
          </button>
        </form>

        {/* Open Positions Table */}
        <div className="mb-6">
          <h3 className="text-xs font-mono text-[#69ddbb] uppercase mb-2">Açık Pozisyonlar ({openPositions.length})</h3>
          {openPositions.length === 0 ? (
            <div className="text-center text-[#93a2b7] text-xs py-4 border border-[#233043] rounded">
              Açık pozisyon bulunmuyor.
            </div>
          ) : (
            <div className="workspace-table-wrap">
              <table className="w-full text-left font-mono text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#233043] text-[#93a2b7]">
                    <th className="py-2">Hisse</th>
                    <th className="py-2">Tür</th>
                    <th className="py-2 text-right">Adet</th>
                    <th className="py-2 text-right">Giriş Fiyatı</th>
                    <th className="py-2 text-center w-[220px]">Pozisyon Kapat</th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map((pos) => (
                    <tr key={pos.id} className="border-b border-[#101925]">
                      <td className="py-2 text-white font-medium">{pos.symbol}</td>
                      <td className="py-2">
                        <span className={pos.type === "BUY" ? "text-[#69ddbb]" : "text-[#f47b91]"}>
                          {pos.type === "BUY" ? "Long" : "Short"}
                        </span>
                      </td>
                      <td className="py-2 text-right text-white">{pos.amount}</td>
                      <td className="py-2 text-right text-white">{pos.entryPrice.toFixed(2)} TL</td>
                      <td className="py-2">
                        <div className="flex gap-1 justify-center">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Kapanış"
                            value={closeInputs[pos.id] || ""}
                            onChange={(e) =>
                              setCloseInputs((prev) => ({ ...prev, [pos.id]: e.target.value }))
                            }
                            className="bg-[#101925] border border-[#233043] text-white rounded p-1 w-20 text-right outline-none"
                          />
                          <button
                            onClick={() => closePosition(pos.id)}
                            className="rsi-button rsi-button-danger"
                          >
                            Kapat
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Closed Positions History */}
        <div>
          <h3 className="text-xs font-mono text-[#93a2b7] uppercase mb-2">Kapanan Pozisyon Geçmişi ({closedPositions.length})</h3>
          {closedPositions.length === 0 ? (
            <div className="text-center text-[#93a2b7] text-xs py-4 border border-[#233043] rounded">
              İşlem geçmişi bulunmuyor.
            </div>
          ) : (
            <div className="workspace-table-wrap">
              <table className="w-full text-left font-mono text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#233043] text-[#93a2b7]">
                    <th className="py-2">Hisse</th>
                    <th className="py-2">Tür</th>
                    <th className="py-2 text-right">Giriş</th>
                    <th className="py-2 text-right">Çıkış</th>
                    <th className="py-2 text-right">K/Z (%)</th>
                    <th className="py-2 text-right">Net K/Z</th>
                  </tr>
                </thead>
                <tbody>
                  {closedPositions.map((pos) => (
                    <tr key={pos.id} className="border-b border-[#101925] text-[#eaf0f6]">
                      <td className="py-2 text-white font-medium">{pos.symbol}</td>
                      <td className="py-2">{pos.type === "BUY" ? "Long" : "Short"}</td>
                      <td className="py-2 text-right">{pos.entryPrice.toFixed(2)} TL</td>
                      <td className="py-2 text-right">{pos.closePrice?.toFixed(2)} TL</td>
                      <td className="py-2 text-right">
                        <span className={pos.pnl >= 0 ? "text-[#69ddbb]" : "text-[#f47b91]"}>
                          {pos.pnlPct.toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <span className={pos.pnl >= 0 ? "text-[#69ddbb] font-bold" : "text-[#f47b91] font-bold"}>
                          {pos.pnl.toFixed(2)} TL
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>
    </WorkspacePage>
  );
}
