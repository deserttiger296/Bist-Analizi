"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { WorkspacePage, MetricCard, EmptyState } from "@/components/ui/Workspace";
import SemihDivergenceChart, { type ChartInterval } from "@/components/SemihDivergenceChart";
import { BIST_30 } from "@/lib/indices";
import { PlainGuideBanner } from "@/components/PlainGuideBanner";
import { TermHint } from "@/components/GlossaryTooltip";
import { ViopCalculator, type ViopSignalPreset } from "@/components/ViopCalculator";

type Suite = { id: string; label: string; description: string };
type TestResult = { name: string; group: string; status: string; duration_sec: number; message: string };
type TestReport = {
  passed: boolean; exit_code: number; timed_out: boolean; label: string; completed_at: string; duration_sec: number;
  summary: { total: number; passed: number; failed: number; error: number; skipped: number };
  results: TestResult[]; output: string;
};

const BIST100_BACKTEST_SUMMARY = [
  {
    tf: "15 Dakikalık (15m - NU15/PU15)",
    mode: "Tek Başına 15m (Saatlik Onaysız Tuzak vs 15m + 1S Onaylı)",
    signals: 614,
    winRate: "38.4% → 61.2%",
    avgRet: "-0.19% → +0.64%",
    medianRet: "-0.34% → +0.55%",
    pf: "0.86 → 1.48",
    viopLeverage: "Kaldıraçsız / 2.5x–3.5x (1S Onaylı)",
    viopNetEv: "-1.45% → +2.10% (%0.05 komisyon sonrası)",
    viopMarginNote: "Tek başına NU15/PU15'te VİOP şort/long yasak (öğleden sonra ters zirve/dip tuzağı); yalnızca 1S GVT/GKD onaylıda %2 risk & %20 Takasbank teminatı ile girilir.",
    note: "Tek başına 15dk sinyal tuzaktır (%38.4); 1S onayı eklendiğinde başarı %61.2'ye çıkar",
  },
  {
    tf: "1 Saatlik (1h)",
    mode: "Immediate Confirm (Teyit Mum Kapanışı)",
    signals: 373,
    winRate: "47.7%",
    avgRet: "+0.28%",
    medianRet: "-0.16%",
    pf: "1.17",
    viopLeverage: "2.0x–3.0x Efektif (100x Çarpan)",
    viopNetEv: "+0.55% (%0.05 çift yön komisyon sonrası)",
    viopMarginNote: "%2 risk bütçesiyle kontrat sayısı düşer; GVT/GKD kırılımı beklenmeden VİOP'ta erken giriş komisyon ve kayma nedeniyle EV'yi aşındırır.",
    note: "Erken giriş, yüksek sinyal sayısı, gürültüye açık",
  },
  {
    tf: "1 Saatlik (1h)",
    mode: "Saatlik Güven Tazeleyen Tepe Kırılımı (Semih Hoca)",
    signals: 187,
    winRate: "63.6%",
    avgRet: "+0.88%",
    medianRet: "+0.82%",
    pf: "1.54",
    viopLeverage: "3.0x–4.5x Optimal (%20 Teminat)",
    viopNetEv: "+2.95% (100x kontrat, %0.05 komisyon dahil)",
    viopMarginNote: "floor(Risk Bütçesi / (|Giriş-Stop|×100)) formülüyle %2 sermaye riski korunur; %75 gün içi erken uyarı ve %100 gün sonu MTM tamponuna tam uyumlu.",
    note: "Zayıf sinyallerin %50'sini eler, işlem başı getiri 3.1x artar",
    highlight: true,
  },
  {
    tf: "4 Saatlik (4h)",
    mode: "Immediate Confirm (Teyit Mum Kapanışı)",
    signals: 112,
    winRate: "46.4%",
    avgRet: "+0.54%",
    medianRet: "-0.26%",
    pf: "1.19",
    viopLeverage: "2.0x–2.8x Efektif (Geniş Stop)",
    viopNetEv: "+1.18% (%0.05 komisyon sonrası)",
    viopMarginNote: "4S ham sinyalde stop mesafesi geniş olduğu için %2 risk tavanı kontrat adedini otomatik sınırlar.",
    note: "Orta vade ham PU30 sinyali",
  },
  {
    tf: "4 Saatlik (4h)",
    mode: "Saatlik Güven Tazeleyen Tepe Kırılımı (Semih Hoca)",
    signals: 58,
    winRate: "62.1%",
    avgRet: "+1.76%",
    medianRet: "+1.51%",
    pf: "1.62",
    viopLeverage: "3.5x–5.0x Kurumsal (%20 Teminat)",
    viopNetEv: "+5.80% (100x çarpan & %2 risk bütçesi)",
    viopMarginNote: "4S PU30/NU70 + 1S GVT/GKD kırılımı VİOP Pay Vadeli'de en yüksek Net EV üretir; vade sonu son 2-3 iş günü rollover zorunludur.",
    note: "4s PU30 + 1s yapı kırılımı (Ana Dönüş)",
    highlight: true,
  },
  {
    tf: "Günlük (1d)",
    mode: "Immediate Confirm (Teyit Mum Kapanışı)",
    signals: 22,
    winRate: "50.0%",
    avgRet: "+1.74%",
    medianRet: "+0.11%",
    pf: "1.37",
    viopLeverage: "1.5x–2.5x Muhafazakâr (Swing)",
    viopNetEv: "+3.40% (Rollover & MTM tamponlu)",
    viopMarginNote: "Çok günlü taşımada Takasbank T+1 15:00 MTM teminat tamamlama çağrısına karşı en az %40-%50 serbest nakit tamponu bırakılmalıdır.",
    note: "Makro dip dönüşleri (1 yıllık pencere)",
  },
];

const RULE_MATRIX = [
  {
    id: "PU30-STRICT",
    title: "Katı 30 / 70 Eşiği (6 Ekim 2026)",
    rule: "PU30 için 1. dip RSI < 30 ve 2. dip RSI > 30 (tam 30.0 reddedilir). NU70 için 1. tepe RSI > 70 ve 2. tepe RSI < 70.",
    examples: "KCAER (24.8 -> 27.7 RED), TOASO (32.9 -> 33.4 RED)",
    meaning: "Aşırı satım/alım bölgesinden net dönüş gelmeden erken ve gürültülü sinyalleri eler.",
    status: "AKTİF (Üretim)",
  },
  {
    id: "VAKBN-HAMMER",
    title: "2. Dip Dönüş Mumunda RSI Kontrolü & En Derin Ana Dip (5 Kasım 2026)",
    rule: "Sol penceredeki bir mumda RSI < 30 sarkmış olsa bile, 2. dip pivot mumunun kendisinde (p) veya hemen sağındaki dönüş mumunda (p+1) RSI > 30 ise kabul edilir; birden fazla aday 1. dip varsa en derin ana dip seçilir.",
    examples: "VAKBN 1s: 1. Dip 28.82 TL (RSI 14.8) -> 2. Dip 28.40 TL çekiç mumu (RSI 32.1 > 30)",
    meaning: "Pencere ortalama değil tepki mumunun kendi momentumunu baz alarak çekiç diplerini kaçırmaz.",
    status: "AKTİF (Üretim)",
  },
  {
    id: "ISCTR-KURUS",
    title: "Kuruş Toleranslı İkili Dip / Yatay Mavi Çizgi (%0.25, 5 Kasım 2026)",
    rule: "2. dip fiyatı 1. dibin en fazla +%0.25 üstündeyse (BIST kademe/kuruş farkı) yatay ikili dip olarak PU30 kabul edilir; >%0.25 yüksek dipler reddedilir.",
    examples: "ISCTR 1s: 1. Dip 11.64 TL (RSI 18.7) -> 2. Dip 11.66 TL (+%0.17 / 2 kuruş fark, RSI 36.8 > 30)",
    meaning: "BIST fiyat adımlarındaki 1-2 kademelik sapmalar yüzünden temiz ikili dip fırsatlarını atlamaz.",
    status: "AKTİF (Üretim)",
  },
  {
    id: "ASELS-TRUST",
    title: "Saatlik Güven Tazeleyen Tepe / Güven Kıran Dip (ASELS Örneği)",
    rule: "2. dipten (t0) sonra dibi kıramayan ilk kesinleşmiş saatlik dip (t2) oluştuğunda, aradaki en yüksek saatlik fiyat (t1) Güven Tazeleyen Tepe olur. Üzerinde saatlik kapanış = AL.",
    examples: "ASELS 4s NU70: 450.00 -> 439.50 -> Güven Kıran Dip 423.00 (kapanış 421.25)",
    meaning: "Alt zaman diliminde yapı kırılmadan körü körüne ters yöne işlem açılmasını engeller.",
    status: "AKTİF (Üretim)",
  },
  {
    id: "IMPULSE-FIBTIME",
    title: "1-2 İtki Dalgası & Fibonacci Zaman Sündürme (Testbed)",
    rule: "PU30 dibi = 0 zaman (t0), 1 nolu itki dalgası tepesi = orta referans (t1), 2 nolu düzeltme dibi = zaman startı (t2). Fib Zaman 0.382 / 0.618 / 1.000 / 1.618 hedefleri ve itki kalitesi ölçülür.",
    examples: "VAKBN 1s: W1 +%5.21 (6 bar, hacim 1.45x) -> W2 28.72 (Fib 0.784) -> W3 32.30 (W1'in 2.42 katı)",
    meaning: "Fiyatla birlikte zaman pencerelerini ölçerek 3. dalga ralli ivmesinin ne zaman geleceğini tahminler.",
    status: "TESTBED (Deneysel)",
  },
  {
    id: "NU70-HANGING-MAN",
    title: "Görülen En Yüksek Fiyatta RSI < 70 & Asılan Adam Zirve Kuralı (18 Kasım 2026)",
    rule: "NU70 için 2. tepe görülen en yüksek fiyat olmalı (teyit sonrası yeni yüksek tepe kırılırsa elenir) ve 2. tepe mumunda/teyidinde RSI < 70 oluşmalıdır. Ara bölgede aynı/yüksek fiyatta daha önce RSI >= 70 görülmüşse tekrar sinyal üretilmez. Zirvede Asılan Adam veya Kayan Yıldız dönüş mumu önceliklendirilir; küçük geri çekilmeli adaylar ayrı NU70_ADAY havuzunda izlenir.",
    examples: "PGSUS 1s (158.90 @ 85.8 -> 160.60 @ 59.7 < 70), THYAO 1s (Asılan Adam), SISE 1s (Kayan Yıldız)",
    meaning: "Zirvede momentum düşüşünü dönüş mumuyla teyit eder; yeni zirve yapan hisseleri ise listeden otomatik düşürür.",
    status: "AKTİF (NU70 Lab)",
  },
  {
    id: "MTF-1H-4H-FRACTAL",
    title: "1S NU70 Var / 4S NU70 Yok: Ara Salınım + 1 Zirve Daha & Kâr Hesabı Kuralı (19 Kasım 2026)",
    rule: "Saatlikte (1H) NU70 yakalandığında hemen 4 Saatlik (4H) grafik kontrol edilir. 4 Saatlikte henüz NU70 yoksa hisse önce kesin ara düzeltme (salınım) yapar, ardından 4 Saatlik NU70'i kurmak için en az 1 yeni zirve daha dener; asıl sert satış sonraki zirvede 4S NU70 oluştuğunda gelir.",
    examples: "THYAO 1S NU70 var, 4S NU yok -> Bu salınımda 1R hedefinden kâr al; sonraki yeni zirvede 4S NU doğduğunda sert satış bekle.",
    meaning: "Saatlik zirvede aşırı hırslı short taşıyıp yeni zirve hareketine yakalanmayı önler; 1R kısa kâr + 2R sert satış ayrımı kurar.",
    status: "AKTİF (NU70 Lab)",
  },
  {
    id: "DAILY-PU30-361-IMPULSE",
    title: "Günlük RSI < 30 Aşırı Satım → Tepki → Günlük RSI > 30 Yeni Dip (PU30) → 1-2 & %361.8 (19 Kasım 2026)",
    rule: "Genel düşüş trendindeki kağıtta günlükte tepe (NU70) aramak anlamsızdır; satışlar Günlük RSI 30 altına (aşırı satım) inene kadar sürer. Oradan genel tepki alımı (1. dalga) gelir, ardından hisse yeni bir fiyat dibi yapıp Günlük RSI > 30 üzerinde kalırsa (Günlük PU30 = ana dönüş yeri) 1-2 oluşumu tamamlanır ve %361.8 (Fib 3.618) hedefine kadar izlenir.",
    examples: "VAKBN 1s: 1. dalga + 2. dip sonrası W3 = W1'in 3.81 katı (%381, %361.8 hedefleri geçildi).",
    meaning: "Düşüş trendi sonunda günlük PU30 dönüşünü 1-2 itki ve %361.8 projeksiyonuyla birleştirir.",
    status: "AKTİF (İtki & PU30)",
  },
  {
    id: "PRE-PU30-ONE-MORE-DIP",
    title: "Aşırı Satım (RSI < 30) Sonrası İlk Tepki: 'Henüz RSI > 30 Dip Yok → En Az Bir Dip Daha Gelecek' Kuralı (ASELS 15dk, 19 Kasım 2026)",
    rule: "Bir hisse aşırı satım bölgesine (RSI < 30) indikten sonra ilk tepki yükselişini verip henüz RSI > 30 üzerinde 2. bir dip (PU30) oluşturmadıysa, dönüş tamamlanmamıştır; RSI > 30 üzerinde 2. dip kurmak için fiyat tekrar aşağı dönüp EN AZ BİR DİP DAHA yapacaktır.",
    examples: "ASELS 15dk: RSI 30 altına sarkıp 42.72'ye tepki verdi; henüz RSI > 30'da 2. dip olmadığı için en az 1 dip daha beklenir.",
    meaning: "İlk tepkide erken alım tuzağına düşmek yerine 2. dip (PU30) onayını beklemeyi sağlar.",
    status: "AKTİF (İtki Lab)",
  },
  {
    id: "VIOP-100X-RISK-FLOOR",
    title: "Stop-Risk Öncelikli VİOP Kontrat Boyutlandırma (100x Çarpan & %2 Risk Tavanı)",
    rule: "BIST Pay Vadeli'de 1 kontrat = 100 adet hisseyi temsil eder. Kontrat adedi eldeki teminata göre değil, stop olunduğunda kaybedilecek maksimum tutara göre floor(Risk Bütçesi / (|Giriş - Stop| × 100)) formülüyle aşağı yuvarlanarak hesaplanır (işlem başı önerilen risk tavanı sermayenin %2'si).",
    examples: "100.000 TL sermaye (%2 risk = 2.000 TL), THYAO Giriş 300 TL / Stop 308 TL (kontrat başı 800 TL risk) -> floor(2000 / 800) = 2 kontrat.",
    meaning: "Teminat yetiyor diye aşırı kontrat açıp tek bir stopta ana paranın erimesini matematiksel olarak engeller.",
    status: "AKTİF (VİOP Kalkanı)",
  },
  {
    id: "VIOP-TAKASBANK-MTM",
    title: "Takasbank %100 Gün Sonu Sürdürme Teminatı, %75 Gün İçi Erken Uyarı & T+1 15:00 Margin Call",
    rule: "Takasbank Yöntem-2 (SPAN / BISTECH) sisteminde gün sonu Uzlaşma Fiyatı ile MTM (Mark-to-Market) değerlemede teminatın başlangıç teminatının %100'ü altında kalması T+1 saat 15:00'e kadar Teminat Tamamlama Çağrısı (Margin Call) doğurur. Gün içinde ise özvarlığın %75 eşiğine gerilemesi aracı kurum erken risk/likidasyon uyarısıdır.",
    examples: "36.000 TL başlangıç teminatında gün içi 27.000 TL (%75) erken uyarı eşiği; gün sonu 36.000 TL altı T+1 15:00 nakit tamamlama çağrısı.",
    meaning: "Yatırımcının tüm parasını teminata bağlamayıp en az %40-%50 serbest nakit tamponu bırakmasını zorunlu kılar.",
    status: "AKTİF (VİOP Kalkanı)",
  },
  {
    id: "VIOP-ROLLOVER-15M-TRAP",
    title: "Vade Sonu Son 2–3 İş Günü Rollover (Fiziki Teslimat Koruması), 09:30–18:10 Seans & 15dk (NU15) Tuzak Filtresi",
    rule: "BIST Pay Vadeli sözleşmeleri fiziki teslimatlıdır ve akşam seansı yoktur (yalnızca 09:30–18:10 normal seans). Vade sonuna ≤3 iş günü kala pozisyon yeni vadeye taşınmalı (rollover) veya kapatılmalıdır. Ayrıca 15dk (NU15/PU15) tek başına sinyallerde saatlik (1S) onay yoksa öğleden sonra ters zirve/dip tuzağı riski nedeniyle VİOP pozisyonu açılmaz.",
    examples: "F_THYAO vade sonuna 2 gün kala rollover uyarısı; ASELS 15dk NU15 tek başına sinyalde VİOP şort blokajı.",
    meaning: "Vade sonunda istemeden 100×N adet fiziki hisse teslimat yükümlülüğüne girmeyi ve 15dk gün içi tuzaklarında kaldıraçlı sıkışmayı önler.",
    status: "AKTİF (VİOP Kalkanı)",
  },
];

export default function LabPage() {
  const [activeTab, setActiveTab] = useState<"impulse" | "pytest" | "backtest" | "journal" | "longshort" | "nu70lab">("pytest");
  const [symbolsInput, setSymbolsInput] = useState("VAKBN,ISCTR,GARAN,AKBNK,YKBNK,THYAO,ASELS,TUPRS");
  const [interval, setIntervalVal] = useState<"15m" | "1h" | "4h" | "1d">("1h");
  const [impulseData, setImpulseData] = useState<any[]>([]);
  const [loadingImpulse, setLoadingImpulse] = useState(false);
  const impulseRequest = useRef(0);

  const [lsSymbolsInput, setLsSymbolsInput] = useState("TUPRS,THYAO,PGSUS,SISE,AKBNK,ISCTR,VAKBN,GARAN,ASELS,KCHOL,SAHOL,BIMAS,DOAS");
  const [lsInterval, setLsInterval] = useState<ChartInterval>("1h");
  const [lsViopOnly, setLsViopOnly] = useState(false);
  const [lsData, setLsData] = useState<any | null>(null);
  const [loadingLs, setLoadingLs] = useState(false);

  const [nu70SymbolsInput, setNu70SymbolsInput] = useState("TUPRS,THYAO,PGSUS,SISE,AKBNK,ISCTR,VAKBN,GARAN,ASELS,KCHOL,SAHOL,BIMAS,DOAS");
  const [nu70Interval, setNu70Interval] = useState<ChartInterval>("1h");
  const [nu70ViopOnly, setNu70ViopOnly] = useState(false);
  const [nu70Filter, setNu70Filter] = useState<"all" | "candle" | "triggered">("all");
  const [nu70Data, setNu70Data] = useState<any | null>(null);
  const [loadingNu70, setLoadingNu70] = useState(false);
  const nu70Request = useRef(0);

  const [chartModal, setChartModal] = useState<{
    symbol: string;
    interval: ChartInterval;
    signalPref?: "auto" | "pu30" | "nu70";
  } | null>(null);
  const [viopModal, setViopModal] = useState<ViopSignalPreset | null>(null);

  const [pytestData, setPytestData] = useState<TestReport | null>(null);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [selectedSuite, setSelectedSuite] = useState("resilience");
  const [executionMode, setExecutionMode] = useState<"local" | "report">("local");
  const [loadingPytest, setLoadingPytest] = useState(false);

  const [journalRows, setJournalRows] = useState<any[]>([]);
  const [loadingJournal, setLoadingJournal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runLongShortScan = async (syms?: string, tf?: string, viop?: boolean) => {
    setLoadingLs(true);
    setError(null);
    try {
      const s = syms ?? lsSymbolsInput;
      const i = tf ?? lsInterval;
      const v = viop ?? lsViopOnly;
      const qs = new URLSearchParams({ mode: "longshort", symbols: s, interval: i, viop_only: String(v) }).toString();
      const res = await fetch(`/api/lab?${qs}`);
      const json = await res.json();
      if (json.status !== "success") throw new Error(json.detail || "Long/Short taraması başarısız");
      setLsData(json);
    } catch (e: any) {
      setError(e?.message || "Long/Short hatası");
    } finally {
      setLoadingLs(false);
    }
  };

  const runNu70LabScan = async (syms?: string, tf?: string, viop?: boolean) => {
    const requestId = ++nu70Request.current;
    setLoadingNu70(true);
    setError(null);
    try {
      const s = syms ?? nu70SymbolsInput;
      const i = tf ?? nu70Interval;
      const v = viop ?? nu70ViopOnly;
      const qs = new URLSearchParams({ mode: "nu70lab", symbols: s, interval: i, viop_only: String(v) }).toString();
      const res = await fetch(`/api/lab?${qs}`);
      const json = await res.json();
      if (requestId !== nu70Request.current) return;
      if (json.status !== "success") throw new Error(json.detail || "NU70 Zirve Lab taraması başarısız");
      setNu70Data(json);
    } catch (e: any) {
      if (requestId === nu70Request.current) setError(e?.message || "NU70 Lab hatası");
    } finally {
      if (requestId === nu70Request.current) setLoadingNu70(false);
    }
  };

  const runImpulseTestbed = async (customSyms?: string, customTf?: "15m" | "1h" | "4h" | "1d") => {
    const requestId = ++impulseRequest.current;
    setLoadingImpulse(true);
    setImpulseData([]);
    setError(null);
    try {
      const syms = customSyms ?? symbolsInput;
      const tf = customTf ?? interval;
      const qs = new URLSearchParams({ mode: "impulse", symbols: syms, interval: tf }).toString();
      const res = await fetch(`/api/lab?${qs}`);
      const json = await res.json();
      if (requestId !== impulseRequest.current) return;
      if (json.status !== "success") throw new Error(json.detail || "Testbed hatası");
      setImpulseData(json.items || []);
    } catch (e: any) {
      if (requestId === impulseRequest.current) setError(e?.message || "Testbed çalıştırılamadı");
    } finally {
      if (requestId === impulseRequest.current) setLoadingImpulse(false);
    }
  };

  const runPytestSuite = async (suite = selectedSuite) => {
    setSelectedSuite(suite);
    setLoadingPytest(true);
    setPytestData(null);
    setError(null);
    try {
      if (executionMode === "report") {
        const res = await fetch("/lab-results.json", { cache: "no-store" });
        if (!res.ok) throw new Error("Henüz yayınlanmış test raporu yok. Önce Test Merkezi / CI kapısını çalıştırın.");
        const report = await res.json();
        let result = report.suites.find((item: { suite: string }) => item.suite === suite);
        if (!result && suite === "all" && Array.isArray(report.suites) && report.suites.length > 0) {
          const combinedResults = report.suites.flatMap((s: any) => s.results || []);
          const combinedSummary = report.suites.reduce(
            (acc: { total: number; passed: number; failed: number; error: number; skipped: number }, s: any) => ({
              total: acc.total + Number(s.summary?.total || 0),
              passed: acc.passed + Number(s.summary?.passed || 0),
              failed: acc.failed + Number(s.summary?.failed || 0),
              error: acc.error + Number(s.summary?.error || 0),
              skipped: acc.skipped + Number(s.summary?.skipped || 0),
            }),
            { total: 0, passed: 0, failed: 0, error: 0, skipped: 0 }
          );
          const combinedDuration = Number(
            report.suites.reduce((sum: number, s: any) => sum + Number(s.duration_sec || 0), 0).toFixed(2)
          );
          result = {
            passed: Boolean(report.passed) && report.suites.every((s: any) => Boolean(s.passed)),
            exit_code: report.suites.every((s: any) => s.exit_code === 0) ? 0 : 1,
            timed_out: report.suites.some((s: any) => Boolean(s.timed_out)),
            label: "Tüm regresyonlar (Resilience + PU30 + MTF + Uyumluluk)",
            completed_at: report.generated_at || report.suites[report.suites.length - 1]?.completed_at || new Date().toISOString(),
            duration_sec: combinedDuration,
            summary: combinedSummary,
            results: combinedResults,
          };
        }
        if (!result) throw new Error("Bu paket yayınlanmış raporda yer almıyor.");
        setPytestData({ ...result, output: "Bu kayıt yayınlanan sürümle birlikte gelen test anlık görüntüsüdür. Canlı sitede test yeniden çalıştırılmadı." });
        return;
      }
      const qs = new URLSearchParams({ mode: "pytest", suite }).toString();
      const res = await fetch(`/api/lab?${qs}`);
      const json = await res.json();
      if (json.status !== "success") throw new Error(json.detail || "Pytest çalıştırılamadı");
      setPytestData(json);
    } catch (e: any) {
      setError(e?.message || "Pytest hatası");
    } finally {
      setLoadingPytest(false);
    }
  };

  const loadJournal = async (forceScan = false) => {
    setLoadingJournal(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ mode: "journal", ...(forceScan ? { suite: "scan" } : {}) }).toString();
      const res = await fetch(`/api/lab?${qs}`);
      const json = await res.json();
      if (json.status !== "success") throw new Error(json.detail || "Günlük okunamadı");
      setJournalRows(json.rows || []);
    } catch (e: any) {
      setError(e?.message || "Günlük hatası");
    } finally {
      setLoadingJournal(false);
    }
  };

  useEffect(() => {
    fetch("/api/lab?mode=catalog").then(async (res) => {
      const body = await res.json();
      if (!res.ok || body.status !== "success") throw new Error(body.detail || "Test paketleri yüklenemedi");
      setSuites(body.suites);
      setExecutionMode(body.execution_mode || "local");
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const syncTab = () => {
      const tab = window.location.hash.slice(1);
      if (tab === "reference") setActiveTab("backtest");
      else if (["pytest", "impulse", "journal", "longshort", "nu70lab"].includes(tab)) setActiveTab(tab as any);
    };
    syncTab();
    window.addEventListener("hashchange", syncTab);
    return () => window.removeEventListener("hashchange", syncTab);
  }, []);

  return (
    <WorkspacePage title="Test Merkezi" eyebrow="ARAŞTIRMA VE DOĞRULAMA"
      description="Veri güvenilirliğini, RSI kurallarını ve sistem uyumunu doğrulayın. Testler yalnızca başlattığınızda çalışır."
      actions={<><Link href="/viop-rehber" className="rsi-button">VİOP Rehberi</Link><Link href="/impulse-lab" className="rsi-button">İtki &amp; WFO Lab</Link><Link href="/mtf-lab.html" className="rsi-button">MTF Strateji Lab</Link><Link href="/index.html#rsipu30" className="rsi-button">RSI Radarı</Link></>}>
      <div className="workspace-notice workspace-notice-warning">Yeni özellik → Test Merkezi → Regresyon → Uyumluluk kapısı → Üretime geçiş. Başarısız veya eksik kontrol geçişi durdurur.</div>
      <div className="workspace-tabs" role="tablist" aria-label="Test Merkezi bölümleri" onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next]?.focus(); tabs[next]?.click();
      }}>
        {([
          { id: "pytest", label: "Test paketleri" },
          { id: "longshort", label: "Long / Short Matrisi" },
          { id: "nu70lab", label: "NU70 & Asılan Adam Lab" },
          { id: "impulse", label: "İtki analizi" },
          { id: "backtest", label: "Referans ve kurallar" },
          { id: "journal", label: "Sinyal günlüğü" },
        ] as const).map(tab => <button key={tab.id} id={`lab-tab-${tab.id}`} role="tab"
          aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1} aria-controls="lab-panel" className="workspace-tab"
          onClick={() => {
            setActiveTab(tab.id);
            window.history.replaceState(null, "", `#${tab.id === "backtest" ? "reference" : tab.id}`);
            if (tab.id === "journal" && journalRows.length === 0) loadJournal();
            if (tab.id === "longshort" && !lsData) runLongShortScan();
            if (tab.id === "nu70lab" && !nu70Data) runNu70LabScan();
          }}>{tab.label}</button>)}
      </div>
      <section id="lab-panel" role="tabpanel" aria-labelledby={`lab-tab-${activeTab}`}>
      {error && (
        <div role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-4 text-rose-300 text-sm">
          {error}
        </div>
      )}

      {/* TAB 0: LONG / SHORT KARAR MATRİSİ */}
      {activeTab === "longshort" && (
        <div className="space-y-6">
          <PlainGuideBanner
            storageKey="lab_longshort"
            title="Long / Short Matrisini 3 Adımda Nasıl Kullanırsın?"
            steps={[
              "1. Adım (Yön & Onay): Sol sütun PU30 dip dönüşüyle yükseliş (Long), sağ sütun NU70 tepe yorulmasıyla düşüş (VİOP Short / Kâr Al) adaylarını listeler.",
              "2. Adım (GVT & GKD Kırılımı): 'GVT Üstü Onaylı' veya 'GKD Altı Onaylı' yazmayan kartlarda henüz kırılım gelmemiştir; erken pozisyon açılmaz.",
              "3. Adım (VİOP Planı): VİOP rozetli hisselerde '🧮 VİOP Planı' butonuna tıklayarak 1 kontrat = 100 hisse çarpanıyla stop riskine uygun kontrat ve teminat hesabını aç.",
            ]}
            ctaHref="/viop-rehber"
            ctaLabel="VİOP & Strateji Rehberi"
          />
          <div className="workspace-panel workspace-panel-body space-y-4">
            <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-end justify-between">
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Taranacak Hisseler
                  </label>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        const p = "TUPRS,THYAO,PGSUS,SISE,AKBNK,ISCTR,VAKBN,GARAN,ASELS,KCHOL,SAHOL,BIMAS,DOAS";
                        setLsSymbolsInput(p);
                        runLongShortScan(p);
                      }}
                      className="text-cyan-400 hover:underline"
                    >
                      BIST13 Popüler
                    </button>
                    <span className="text-slate-600">·</span>
                    <button
                      type="button"
                      onClick={() => {
                        setLsSymbolsInput("ALL");
                        runLongShortScan("ALL");
                      }}
                      className="text-cyan-400 hover:underline"
                    >
                      Tüm BIST100
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={lsSymbolsInput}
                  onChange={(e) => setLsSymbolsInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white font-mono focus:border-cyan-500 focus:outline-none"
                  placeholder="Hisseleri virgülle ayırın veya 'ALL' yazın"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Zaman Dilimi
                  </label>
                  <div className="flex gap-1">
                    {(["15m", "1h", "4h", "1d"] as const).map((tf) => (
                      <button
                        key={tf}
                        onClick={() => {
                          setLsInterval(tf);
                          runLongShortScan(lsSymbolsInput, tf);
                        }}
                        className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                          lsInterval === tf
                            ? "bg-cyan-500/20 border-cyan-500 text-cyan-300 shadow-sm"
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                        }`}
                      >
                        {tf === "15m" ? "15DK" : tf.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={lsViopOnly}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setLsViopOnly(checked);
                        runLongShortScan(lsSymbolsInput, lsInterval, checked);
                      }}
                      className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0"
                    />
                    <span>Yalnızca VİOP Vadeli</span>
                  </label>
                </div>

                <div className="pt-4">
                  <button
                    onClick={() => runLongShortScan()}
                    disabled={loadingLs}
                    className="w-full lg:w-auto px-5 py-2 rounded-xl border border-cyan-500/50 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-950/50 transition-all disabled:opacity-50"
                  >
                    {loadingLs ? "Taranıyor..." : "⚡ Matrisi Güncelle"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Market Bias & Exposure Header */}
          {lsData && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="workspace-panel workspace-panel-body md:col-span-2 border-l-4 border-l-cyan-500 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Piyasa Rejim & Yön Özeti</span>
                    <h3 className="text-base font-extrabold text-white mt-1">
                      {lsData.market_bias}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Onaylı Long (GVT üstü) ve onaylı Short (GKD altı) dengesine göre piyasanın baskın yönünü özetler.
                    </p>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs font-mono">
                    <span className="text-emerald-400">🟢 Aktif Long: <strong>{lsData.long_active_count}</strong></span>
                    <span className="text-rose-400">🔴 Aktif Short: <strong>{lsData.short_active_count}</strong></span>
                    <span className="text-slate-400">Taranan: {lsData.total_scanned}</span>
                  </div>
                </div>

                <div className="workspace-panel workspace-panel-body border-l-4 border-l-emerald-500">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400">Long Sinyalleri</span>
                  <div className="text-2xl font-black text-emerald-400 mt-1">{lsData.long_total}</div>
                  <div className="text-[11px] text-slate-400 mt-1">GVT aşılan: {lsData.long_active_count} onaylı</div>
                  <p className="text-[11px] text-slate-500 mt-1">1. dip RSI &lt; 30 sonrası yükselen RSI dip dönüşleri.</p>
                </div>

                <div className="workspace-panel workspace-panel-body border-l-4 border-l-rose-500">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-rose-400">Short / Kâr Al</span>
                  <div className="text-2xl font-black text-rose-400 mt-1">{lsData.short_total}</div>
                  <div className="text-[11px] text-slate-400 mt-1">GKD kırılan: {lsData.short_active_count} teyitli</div>
                  <p className="text-[11px] text-slate-500 mt-1">1. tepe RSI &gt; 70 sonrası düşen RSI zirve yorulmaları.</p>
                </div>
              </div>

              {/* Pair Trading / Hedge Kartı */}
              {lsData.pair_trading && (
                <div className="workspace-panel workspace-panel-body border border-indigo-500/30 bg-indigo-950/20">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-500/30 text-indigo-300 border border-indigo-500/40">
                      ⚖️ PİYASA-NÖTR ARBİTRAJ / HEDGE
                    </span>
                    <span className="text-xs text-slate-400">Endeks riskinden arındırılmış alfa eşleşmesi</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 my-2">
                    <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-emerald-400 font-bold">🟢 UZUN (LONG) AYAĞI</span>
                        <div className="text-lg font-black text-white">{lsData.pair_trading.long_symbol} · {lsData.pair_trading.long_price} ₺</div>
                      </div>
                      <span className="text-[11px] text-emerald-300 font-mono">{lsData.pair_trading.long_confluence}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-rose-400 font-bold">🔴 KISA (SHORT / VİOP) AYAĞI</span>
                        <div className="text-lg font-black text-white">{lsData.pair_trading.short_symbol} · {lsData.pair_trading.short_price} ₺</div>
                      </div>
                      <span className="text-[11px] text-rose-300 font-mono">{lsData.pair_trading.short_confluence}</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-300 mt-2">{lsData.pair_trading.thesis}</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    📌 Ne Anlama Geliyor? Endeks düşse de çıksa da göreceli getiri (spread) yakalamak için aynı anda güçlü Long + zayıf Short eşleşmesi önerir.
                  </p>
                </div>
              )}

              {/* Two Column Side-by-Side: Long vs Short */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* LONG KANADI */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-400">
                        Long Kanadı (Spot Alım & VİOP Uzun)
                      </h3>
                    </div>
                    <span className="text-xs font-mono text-slate-400">{lsData.longs?.length || 0} aday</span>
                  </div>

                  {(!lsData.longs || lsData.longs.length === 0) ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-center text-slate-400 text-xs">
                      Seçili parametrelerde aktif PU30 alım adayı bulunamadı.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {lsData.longs.map((item: any, i: number) => (
                        <div
                          key={i}
                          className={`p-4 rounded-xl border transition-all ${
                            item.triggered
                              ? "bg-slate-900/90 border-emerald-500/40 shadow-sm"
                              : "bg-slate-950/60 border-slate-800/80 opacity-80"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-black text-white">{item.symbol}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                                {item.interval.toUpperCase()}
                              </span>
                              {item.is_viop && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  VİOP
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  item.triggered
                                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                    : "bg-slate-800 text-slate-400"
                                }`}
                              >
                                {item.status_text}
                              </span>
                              {item.is_viop && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setViopModal({
                                      symbol: item.symbol,
                                      direction: "LONG",
                                      entryPrice: Number(item.entry_level ?? item.gvt_price ?? item.last_close),
                                      stopPrice: Number(item.stop_loss),
                                      target2r: Number(item.target_tp1),
                                      triggered: Boolean(item.triggered),
                                      gvtOrGkdLevel: Number(item.entry_level ?? item.gvt_price ?? item.last_close),
                                      signalLabel: `Long Matrisi (${String(item.interval).toUpperCase()})`,
                                    })
                                  }
                                  className="px-2 py-1 rounded-lg border border-emerald-500/40 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50 text-[10px] font-bold"
                                >
                                  🧮 VİOP Planı
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setChartModal({
                                    symbol: item.symbol,
                                    interval: (item.interval || lsInterval) as ChartInterval,
                                    signalPref: "pu30",
                                  })
                                }
                                className="px-2 py-1 rounded-lg border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/50 text-[10px] font-bold"
                              >
                                📈 Grafiği Aç
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-800/80 text-xs font-mono">
                            <div>
                              <span className="text-[10px] text-slate-500 block">Fiyat / Giriş <TermHint id="GVT" /></span>
                              <span className="text-white font-bold">{Number(item.last_close).toFixed(2)} ₺</span>
                              <span className="text-[10px] text-emerald-400/80 block">GVT: {item.entry_level != null ? Number(item.entry_level).toFixed(2) : "—"}</span>
                              <span className="text-[9px] text-slate-500 block">Alım kırılım eşiği</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">Stop-Loss <TermHint id="STOP_LOSS" /></span>
                              <span className="text-rose-400 font-bold">{Number(item.stop_loss).toFixed(2)} ₺</span>
                              <span className="text-[9px] text-slate-500 block">Dip altı koruma</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">Hedef TP1 <TermHint id="2R" /></span>
                              <span className="text-emerald-400 font-bold">{Number(item.target_tp1).toFixed(2)} ₺</span>
                              <span className="text-[9px] text-slate-500 block">2x risk kâr hedefi</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">R:R Oranı <TermHint id="RR" /></span>
                              <span className="text-cyan-300 font-bold">{item.rr_ratio}x</span>
                              <span className="text-[9px] text-slate-500 block">Ödül / Risk katı</span>
                            </div>
                          </div>
                          <div className="mt-2.5 pt-2.5 border-t border-slate-800/70 rounded-lg bg-slate-900/70 px-3 py-2.5 text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
                            <div className="font-bold text-emerald-300">
                              🗣️ Bu Hissede Ne Oluyor? (Sade Türkçe İşlem &amp; VİOP Özeti)
                            </div>
                            <ul className="space-y-1 text-slate-300 list-disc pl-4">
                              <li>
                                <strong className="text-white">Ne Bulundu?</strong>{" "}
                                {item.symbol} hissesinde {String(item.interval).toUpperCase()} periyodunda{" "}
                                {item.dip1_price != null && item.dip2_price != null
                                  ? `fiyat ${Number(item.dip1_price).toFixed(2)} ₺ → ${Number(item.dip2_price).toFixed(2)} ₺ dip yaparken RSI ${item.dip1_rsi ?? "—"} → ${item.dip2_rsi ?? "—"} güçlenerek `
                                  : ""}
                                <strong>PU30 pozitif uyumsuzluk (dip dönüşü)</strong> üretti.{" "}
                                {String(item.interval) === "15m"
                                  ? "⚠️ 15dk (PU15) tek başına sinyallerde Saatlik (1S) onay yoksa öğleden sonra yeni dip tuzağı riski vardır; 1S yapıyla birlikte teyit edilmelidir."
                                  : "1S/4S fraktal kuralına göre alt zaman diliminde Güven Tazeleyen Tepe (GVT) kırılımı ana dönüş onayıdır."}
                              </li>
                              <li>
                                <strong className="text-white">Ne Zaman İşleme Girilir / Beklenir?</strong>{" "}
                                {item.triggered
                                  ? `✅ ${item.entry_level != null ? `${Number(item.entry_level).toFixed(2)} ₺` : `${Number(item.last_close).toFixed(2)} ₺`} GVT kırılım eşiği yukarı aşılmış durumda (alım teyidi aktif).`
                                  : `⏳ Henüz erken! Alım teyidi için fiyatın ${item.entry_level != null ? `${Number(item.entry_level).toFixed(2)} ₺` : "GVT"} direnci üzerinde mum kapatması beklenmeli; kırılım olmadan erken girmek düşen bıçağı tutma riski taşır.`}
                              </li>
                              <li>
                                <strong className="text-white">Stop &amp; Hedef Planı:</strong>{" "}
                                Zarar kes (Stop-Loss) <strong>{Number(item.stop_loss).toFixed(2)} ₺</strong>, 2R ana kâr hedefi (TP1) <strong>{Number(item.target_tp1).toFixed(2)} ₺</strong> (R:R {item.rr_ratio}x).{" "}
                                {item.is_viop
                                  ? "Bu hisse VİOP Pay Vadeli'de işlem görüyor; 1 kontrat = 100 pay hesabı ve %2 risk bütçesiyle teminat planı için karttaki '🧮 VİOP Planı' butonuna tıklayın."
                                  : "Bu hisse yalnızca Spot piyasada işlem görür (VİOP kontratı yoktur)."}
                              </li>
                            </ul>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* SHORT KANADI */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                      <h3 className="text-sm font-bold uppercase tracking-wider text-rose-400">
                        Short Kanadı (Spot Kâr Al & VİOP Açığa Satış)
                      </h3>
                    </div>
                    <span className="text-xs font-mono text-slate-400">{lsData.shorts?.length || 0} aday</span>
                  </div>

                  {(!lsData.shorts || lsData.shorts.length === 0) ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-center text-slate-400 text-xs">
                      Seçili parametrelerde aktif NU70 satış / düzeltme adayı bulunamadı.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {lsData.shorts.map((item: any, i: number) => (
                        <div
                          key={i}
                          className={`p-4 rounded-xl border transition-all ${
                            item.triggered
                              ? "bg-slate-900/90 border-rose-500/40 shadow-sm"
                              : "bg-slate-950/60 border-slate-800/80 opacity-80"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-black text-white">{item.symbol}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                                {item.interval.toUpperCase()}
                              </span>
                              {item.is_viop && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  VİOP
                                </span>
                              )}
                              {item.is_hanging_man && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/20 text-rose-200 border border-rose-400/40">
                                  🕯️ Asılan Adam
                                </span>
                              )}
                              {!item.is_hanging_man && item.is_shooting_star && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-orange-500/20 text-orange-200 border border-orange-400/40">
                                  ☄️ Kayan Yıldız
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  item.triggered
                                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                    : "bg-slate-800 text-slate-400"
                                }`}
                              >
                                {item.status_text}
                              </span>
                              {item.is_viop && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setViopModal({
                                      symbol: item.symbol,
                                      direction: "SHORT",
                                      entryPrice: Number(item.entry_level ?? item.gkd_price ?? item.last_close),
                                      stopPrice: Number(item.stop_loss),
                                      target2r: Number(item.target_tp1),
                                      triggered: Boolean(item.triggered),
                                      gvtOrGkdLevel: Number(item.gkd_price ?? item.entry_level ?? item.last_close),
                                      signalLabel: `Short Matrisi (${String(item.interval).toUpperCase()})`,
                                    })
                                  }
                                  className="px-2 py-1 rounded-lg border border-rose-500/40 bg-rose-950/40 text-rose-200 hover:bg-rose-900/50 text-[10px] font-bold"
                                >
                                  🧮 VİOP Planı
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setChartModal({
                                    symbol: item.symbol,
                                    interval: (item.interval || lsInterval) as ChartInterval,
                                    signalPref: "nu70",
                                  })
                                }
                                className="px-2 py-1 rounded-lg border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/50 text-[10px] font-bold"
                              >
                                📈 Grafiği Aç
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-800/80 text-xs font-mono">
                            <div>
                              <span className="text-[10px] text-slate-500 block">Fiyat / Kırılan <TermHint id="GKD" /></span>
                              <span className="text-white font-bold">{Number(item.last_close).toFixed(2)} ₺</span>
                              <span className="text-[10px] text-rose-400/80 block">
                                GKD: {item.gkd_price != null ? Number(item.gkd_price).toFixed(2) : "Bekleniyor"}
                              </span>
                              <span className="text-[9px] text-slate-500 block">Satış kırılım eşiği</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">İptal Stopu <TermHint id="STOP_LOSS" /></span>
                              <span className="text-amber-400 font-bold">{Number(item.stop_loss).toFixed(2)} ₺</span>
                              {item.tepe1_rsi != null && item.tepe2_rsi != null && (
                                <span className="text-[10px] text-slate-400 block">RSI {item.tepe1_rsi}→{item.tepe2_rsi}</span>
                              )}
                              <span className="text-[9px] text-slate-500 block">Zirve +%2.5 stop</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">Destek Hedef <TermHint id="2R" /></span>
                              <span className="text-rose-400 font-bold">{Number(item.target_tp1).toFixed(2)} ₺</span>
                              <span className="text-[9px] text-slate-500 block">2x risk düşüş hedefi</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">R:R Oranı <TermHint id="RR" /></span>
                              <span className="text-cyan-300 font-bold">{item.rr_ratio}x</span>
                              <span className="text-[9px] text-slate-500 block">Ödül / Risk katı</span>
                            </div>
                          </div>
                          <div className="mt-2.5 pt-2.5 border-t border-slate-800/70 rounded-lg bg-slate-900/70 px-3 py-2.5 text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
                            <div className="font-bold text-rose-300">
                              🗣️ Bu Hissede Ne Oluyor? (Sade Türkçe İşlem &amp; VİOP Özeti)
                            </div>
                            <ul className="space-y-1 text-slate-300 list-disc pl-4">
                              <li>
                                <strong className="text-white">Ne Bulundu?</strong>{" "}
                                {item.symbol} hissesinde {String(item.interval).toUpperCase()} periyodunda{" "}
                                {item.tepe1_rsi != null && item.tepe2_rsi != null ? `RSI ${item.tepe1_rsi} → ${item.tepe2_rsi} düşerken ` : ""}
                                <strong>NU70 negatif uyumsuzluk (zirve yorulması)</strong> tespit edildi.{" "}
                                {String(item.interval) === "15m"
                                  ? "⚠️ 15dk (NU15) tek başına sinyallerde Saatlik (1S) onay yoksa öğlene kadar gevşeyip öğleden sonra yeni zirve yapma (tuzak) riski yüksektir!"
                                  : "1S NU70 var ama 4S NU70 yoksa önce ara salınım (1R) ardından yeni zirve denemesi gelebilir; 1S+4S birlikteyse ana sert satış (2R) beklenir."}
                              </li>
                              <li>
                                <strong className="text-white">Ne Zaman İşleme Girilir / Beklenir?</strong>{" "}
                                {item.triggered
                                  ? `✅ ${item.gkd_price != null ? `${Number(item.gkd_price).toFixed(2)} ₺` : `${Number(item.last_close).toFixed(2)} ₺`} GKD (Güven Kıran Dip) desteği aşağı kırılmış durumda (spotta kâr al / VİOP short teyidi aktif).`
                                  : `⏳ Henüz erken! ${item.gkd_price != null ? `${Number(item.gkd_price).toFixed(2)} ₺` : "Alt periyot"} GKD desteği aşağı kırılmadan VİOP'ta erken şort açmak, hisse son bir zirve daha denerse sıkışmaya (short squeeze) yol açar.`}
                              </li>
                              <li>
                                <strong className="text-white">Stop &amp; Hedef Planı:</strong>{" "}
                                İptal Stopu (zirve +%2.5) <strong>{Number(item.stop_loss).toFixed(2)} ₺</strong>, 2R düşüş hedefi <strong>{Number(item.target_tp1).toFixed(2)} ₺</strong> (R:R {item.rr_ratio}x).{" "}
                                {item.is_viop
                                  ? "VİOP Pay Vadeli'de 100 paylık kontrat adedi ve Takasbank teminat hesabı için karttaki '🧮 VİOP Planı' butonuna tıklayın."
                                  : "Bu hisse yalnızca Spot piyasada işlem görür (VİOP'ta şortlanamaz, spotta kâr al / nakde geç sinyali olarak kullanılır)."}
                              </li>
                            </ul>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: NU70 & ASILAN ADAM ZİRVE LABORATUVARI (AYRI BÖLÜM) */}
      {activeTab === "nu70lab" && (() => {
        const matchNu70Filter = (item: any) => {
          if (nu70Filter === "candle") return Boolean(item.is_hanging_man || item.is_shooting_star);
          if (nu70Filter === "triggered") return Boolean(item.triggered ?? item.gkd_broken);
          return true;
        };
        const strictRows = (nu70Data?.strict_signals || []).filter(matchNu70Filter);
        const earlyRows = (nu70Data?.early_candidates || []).filter(matchNu70Filter);
        const invalidatedRows = nu70Data?.invalidated_signals || [];
        const oversoldRows = nu70Data?.oversold_dip_watch || [];
        return (
          <div className="space-y-6">
            <PlainGuideBanner
              storageKey="lab_nu70lab"
              title="NU70 & Asılan Adam Zirve Laboratuvarını 3 Adımda Nasıl Okursun?"
              steps={[
                "1. Adım (Katı NU70 vs Erken Aday): Bölüm 1 tüm şartları tamamlanmış zirve yorulmalarını, Bölüm 2 ise henüz %3 geri çekilme veya 5 bar mesafesini doldurmamış erken adayları (NU70_ADAY) gösterir.",
                "2. Adım (1S/4S Fraktal & 15dk Tuzak): 1S NU70 var ama 4S NU70 yoksa 1R kısa salınım kâr al hedeflenir; 15dk tek başına NU70 ise tuzaktır (öğleden sonra yeni zirve riski).",
                "3. Adım (VİOP Short & Şelale Koruması): VİOP hisselerinde '🧮 VİOP Planı' butonuyla GKD kırılımına göre short kontrat planını kur; Bölüm 4'teki tepkisiz aşırı satım (şelale) hisselerinde ise 2. dip (PU30) gelmeden Long açma.",
              ]}
              ctaHref="/viop-rehber"
              ctaLabel="VİOP & Strateji Rehberi"
            />
            <div className="workspace-panel workspace-panel-body space-y-4 border-l-4 border-l-rose-500">
              <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-end justify-between">
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      NU70 &amp; Asılan Adam Evreni (Ayrıştırılmış Lab)
                    </label>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          const p = "TUPRS,THYAO,PGSUS,SISE,AKBNK,ISCTR,VAKBN,GARAN,ASELS,KCHOL,SAHOL,BIMAS,DOAS";
                          setNu70SymbolsInput(p);
                          runNu70LabScan(p);
                        }}
                        className="text-cyan-400 hover:underline"
                      >
                        BIST13 Popüler
                      </button>
                      <span className="text-slate-600">·</span>
                      <button
                        type="button"
                        onClick={() => {
                          const p = BIST_30.join(",");
                          setNu70SymbolsInput(p);
                          runNu70LabScan(p);
                        }}
                        className="text-cyan-400 hover:underline"
                      >
                        BIST30
                      </button>
                      <span className="text-slate-600">·</span>
                      <button
                        type="button"
                        onClick={() => {
                          setNu70SymbolsInput("ALL");
                          runNu70LabScan("ALL");
                        }}
                        className="text-cyan-400 hover:underline"
                      >
                        Tüm BIST100
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={nu70SymbolsInput}
                    onChange={(e) => setNu70SymbolsInput(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white font-mono focus:border-rose-500 focus:outline-none"
                    placeholder="Hisseleri virgülle ayırın veya 'ALL' yazın"
                  />
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Zaman Dilimi
                    </label>
                    <div className="flex gap-1">
                      {(["15m", "1h", "4h", "1d"] as const).map((tf) => (
                        <button
                          key={tf}
                          onClick={() => {
                            setNu70Interval(tf);
                            runNu70LabScan(nu70SymbolsInput, tf);
                          }}
                          className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                            nu70Interval === tf
                              ? "bg-rose-500/20 border-rose-500 text-rose-300 shadow-sm"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                          }`}
                        >
                          {tf === "15m" ? "15DK" : tf.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Filtre
                    </label>
                    <div className="flex gap-1">
                      {([
                        { id: "all", label: "Tümü" },
                        { id: "candle", label: "🕯️ Asılan Adam / Kayan Yıldız" },
                        { id: "triggered", label: "⚡ GKD Kırılanlar" },
                      ] as const).map((f) => (
                        <button
                          key={f.id}
                          onClick={() => setNu70Filter(f.id)}
                          className={`px-2.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
                            nu70Filter === f.id
                              ? "bg-amber-500/20 border-amber-500 text-amber-200"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center gap-2 pb-2 cursor-pointer select-none text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={nu70ViopOnly}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setNu70ViopOnly(checked);
                        runNu70LabScan(nu70SymbolsInput, nu70Interval, checked);
                      }}
                      className="rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-0"
                    />
                    <span>Sadece VİOP</span>
                  </label>

                  <button
                    onClick={() => runNu70LabScan()}
                    disabled={loadingNu70}
                    className="w-full lg:w-auto px-5 py-2 rounded-xl border border-rose-500/50 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-950/50 transition-all disabled:opacity-50"
                  >
                    {loadingNu70 ? "Taranıyor..." : "NU70 Zirve Taraması Başlat"}
                  </button>
                </div>
              </div>
            </div>

            {!nu70Data && !loadingNu70 && (
              <EmptyState
                title="NU70 & Asılan Adam Zirve Laboratuvarı Hazır"
                description="Görülen en yüksek fiyatta RSI < 70 oluşturan katı NU70 zirvelerini, Asılan Adam / Kayan Yıldız mumlarını, erken izleme adaylarını ve yeni zirve ile iptal edilen eski tepeleri Long / Short Matrisi'nden bağımsız olarak inceleyin."
                action={
                  <button
                    onClick={() => runNu70LabScan()}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
                  >
                    NU70 Zirve Taraması Başlat
                  </button>
                }
              />
            )}

            {nu70Data && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <MetricCard
                    label="Taranan Evren"
                    value={nu70Data.total_scanned}
                    detail={`${String(nu70Data.interval || nu70Interval).toUpperCase()} · ${nu70Data.triggered_count} GKD kırılımı`}
                  />
                  <MetricCard
                    label="Katı NU70 Zirve (RSI < 70)"
                    value={nu70Data.strict_count}
                    detail="Görülen en yüksek fiyat · >=%3 geri çekilme"
                  />
                  <MetricCard
                    label="Asılan Adam / Kayan Yıldız"
                    value={nu70Data.candle_confirmed_count}
                    detail={`${nu70Data.hanging_man_count} Asılan Adam · ${nu70Data.shooting_star_count} Kayan Yıldız`}
                  />
                  <MetricCard
                    label="Erken Tepe İzleme (NU70_ADAY)"
                    value={nu70Data.early_count}
                    detail={`${nu70Data.invalidated_count} iptal · ${nu70Data.oversold_watch_count || 0} RSI<30 Dip İzleme`}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px] text-slate-400">
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2">
                    <strong className="text-slate-200">1. Tepe → 2. Tepe (NU70):</strong> Fiyat daha yüksek zirve yaparken RSI 70 üstünden 70 altına düşerse alıcı gücü zayıflıyor demektir.
                  </div>
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2">
                    <strong className="text-rose-300">GKD (Güven Kıran Dip):</strong> Alt periyottaki (1H için 15dk, 4H/1D için 1H) kırılım desteği. Altında kapanış gelmeden erken şort açılmaz.
                  </div>
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2">
                    <strong className="text-amber-300">Stop / 2R Hedef / Yaş:</strong> Stop: 2. tepe +%2.5 (aşılırsa düşüş tezi biter). 2R: riskin 2 katı kâr hedefi. Yaş: teyitten beri geçen mum sayısı.
                  </div>
                </div>

                {nu70Data.scan_error_count > 0 && (
                  <div className="workspace-notice workspace-notice-warning text-xs font-mono">
                    <strong>Veri / Tarama Uyarıları ({nu70Data.scan_error_count}):</strong>{" "}
                    {(nu70Data.scan_errors || [])
                      .slice(0, 6)
                      .map((e: any) => `${e.symbol}: ${e.error}`)
                      .join(" | ")}
                  </div>
                )}

                {/* BÖLÜM 1: KATI NU70 ZİRVE & ASILAN ADAM SİNYALLERİ */}
                <div className="workspace-panel workspace-panel-body space-y-3 border-t-2 border-t-rose-500">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wider text-rose-300 flex flex-wrap items-center gap-1.5">
                        <span>Bölüm 1 — Katı NU70 Zirve &amp; Asılan Adam Sinyalleri</span>
                        <TermHint id="NU70" />
                        <TermHint id="ASILAN_ADAM" />
                      </h3>
                      <p className="text-xs text-slate-400">
                        Görülen en yüksek fiyatta RSI &lt; 70, ara bölgede aynı fiyatta RSI &gt;= 70 tekrarı yok ve teyit sonrası aşılmamış zirveler.
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-rose-300">
                      {strictRows.length} aktif sinyal
                    </span>
                  </div>

                  {strictRows.length === 0 ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 text-xs text-slate-400">
                      Seçili filtre ve evrende aktif katı NU70 sinyali bulunamadı.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {strictRows.map((item: any, idx: number) => (
                        <div
                          key={`${item.symbol}-${idx}`}
                          className={`p-4 rounded-xl border bg-slate-950/90 space-y-3 ${
                            item.triggered ? "border-rose-500/60" : "border-slate-800"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-black text-white">{item.symbol}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                                {String(item.interval).toUpperCase()}
                              </span>
                              {item.is_viop && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  VİOP
                                </span>
                              )}
                              {item.is_hanging_man && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/25 text-rose-200 border border-rose-400/50">
                                  🕯️ Asılan Adam
                                </span>
                              )}
                              {!item.is_hanging_man && item.is_shooting_star && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/25 text-orange-200 border border-orange-400/50">
                                  ☄️ Kayan Yıldız
                                </span>
                              )}
                              {!item.is_hanging_man && !item.is_shooting_star && item.candle_label && item.candle_label !== "Yok" && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">
                                  {item.candle_label}
                                </span>
                              )}
                              {item.fractal_phase_badge && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                    item.fractal_phase_code === "SALINIM_SONRA_YENI_ZIRVE"
                                      ? "bg-amber-500/20 text-amber-200 border-amber-500/40"
                                      : "bg-rose-500/20 text-rose-200 border-rose-500/40"
                                  }`}
                                >
                                  {item.fractal_phase_badge}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  item.triggered
                                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                    : "bg-slate-800 text-slate-400"
                                }`}
                              >
                                {item.status_text}
                              </span>
                              {item.is_viop && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setViopModal({
                                      symbol: item.symbol,
                                      direction: "SHORT",
                                      entryPrice: Number(item.gkd_price ?? item.last_close),
                                      stopPrice: Number(item.stop_loss),
                                      target1r: item.target_1r != null ? Number(item.target_1r) : undefined,
                                      target2r: item.target_tp1 != null ? Number(item.target_tp1) : undefined,
                                      triggered: Boolean(item.triggered),
                                      fractalPhaseCode: item.fractal_phase_code ?? null,
                                      gvtOrGkdLevel: Number(item.gkd_price ?? item.last_close),
                                      signalLabel: `NU70 Zirve Lab (${String(item.interval).toUpperCase()})`,
                                    })
                                  }
                                  className="px-2 py-1 rounded-lg border border-rose-500/40 bg-rose-950/40 text-rose-200 hover:bg-rose-900/50 text-[10px] font-bold"
                                >
                                  🧮 VİOP Planı
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setChartModal({
                                    symbol: item.symbol,
                                    interval: (item.interval || nu70Interval) as ChartInterval,
                                    signalPref: "nu70",
                                  })
                                }
                                className="px-2 py-1 rounded-lg border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/50 text-[10px] font-bold"
                              >
                                📈 Grafiği Aç
                              </button>
                            </div>
                          </div>

                          <div className="text-xs font-mono text-slate-300 bg-slate-900/70 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                            <span>
                              1. Tepe <strong className="text-white">{Number(item.tepe1_price).toFixed(2)} ₺</strong> (RSI {item.tepe1_rsi})
                              {" → "}
                              2. Tepe <strong className="text-rose-300">{Number(item.tepe2_price).toFixed(2)} ₺</strong> (RSI {item.tepe2_rsi}
                              {item.rsi_at_peak != null ? `, Mum: ${item.rsi_at_peak}` : ""})
                            </span>
                            <span className="text-[11px] text-slate-400">
                              Çekilme %{item.pullback_pct} · {item.gap_bars} bar
                            </span>
                          </div>

                          <div className="grid grid-cols-4 gap-2 text-xs font-mono">
                            <div>
                              <span className="text-[10px] text-slate-500 block">Son / GKD</span>
                              <span className="text-white font-bold">{Number(item.last_close).toFixed(2)} ₺</span>
                              <span className="text-[10px] text-rose-400/80 block">
                                GKD: {item.gkd_price != null ? `${Number(item.gkd_price).toFixed(2)} ₺` : "Bekleniyor"}
                              </span>
                              <span className="text-[9px] text-slate-500 block">Satış tetik desteği</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">İptal Stopu</span>
                              <span className="text-amber-400 font-bold">{Number(item.stop_loss).toFixed(2)} ₺</span>
                              <span className="text-[9px] text-slate-500 block">Zirve +%2.5 koruma</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">1R Salınım / 2R Sert Satış Hedefi</span>
                              <span className="text-amber-300 font-bold block">1R Salınım: {Number(item.target_1r ?? item.target_tp1).toFixed(2)} ₺</span>
                              <span className="text-rose-400 font-bold block text-[11px]">2R Sert Satış: {Number(item.target_tp1).toFixed(2)} ₺</span>
                              <span className="text-[9px] text-slate-500 block">Ara kâr al / Ana düşüş</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block">Teyit / Yaş</span>
                              <span className="text-cyan-300 font-bold">{item.rr_ratio}x · {item.bars_since_confirm} bar</span>
                              <span className="text-[9px] text-slate-500 block">R:R · teyit sonrası</span>
                            </div>
                          </div>
                          <div className="rounded-lg bg-slate-900/75 border border-slate-800/80 px-3 py-2.5 text-[11px] text-slate-300 space-y-1.5 leading-relaxed">
                            <div className="font-bold text-rose-300">
                              🗣️ Bu Hissede Ne Oluyor? (Sade Türkçe İşlem &amp; VİOP Özeti)
                            </div>
                            <ul className="space-y-1 text-slate-300 list-disc pl-4">
                              <li>
                                <strong className="text-white">Ne Bulundu?</strong>{" "}
                                Fiyat <strong>{Number(item.tepe1_price).toFixed(2)} ₺ → {Number(item.tepe2_price).toFixed(2)} ₺</strong> ile yeni zirve yaparken RSI <strong>{item.tepe1_rsi} → {item.tepe2_rsi} (&lt;70)</strong> geriledi
                                {item.candle_label && item.candle_label !== "Yok" ? ` ve zirvede ${item.candle_label} dönüş mumu oluştu` : ""}.{" "}
                                {String(item.interval) === "15m"
                                  ? "⚠️ 15dk (NU15) tek başına sinyallerde Saatlik (1S) onay yoksa öğlene kadar düşüp öğleden sonra yeni zirve yapma (tuzak) riski yüksektir."
                                  : item.fractal_phase_code === "SALINIM_SONRA_YENI_ZIRVE"
                                    ? "1S NU70 var ama 4S NU70 yok: Önce 1R ara salınım düzeltmesi, ardından 4S NU70'i kurmak için 1 yeni zirve denemesi daha beklenir."
                                    : "1S/4S fraktal kuralına göre üst zaman dilimiyle uyumlu ana zirve yorulması (2R sert satış adayı)."}
                              </li>
                              <li>
                                <strong className="text-white">Ne Zaman İşleme Girilir / Beklenir?</strong>{" "}
                                {item.triggered
                                  ? `✅ ${item.gkd_price != null ? `${Number(item.gkd_price).toFixed(2)} ₺` : `${Number(item.last_close).toFixed(2)} ₺`} GKD (Güven Kıran Dip) desteği aşağı kırıldığı için spotta kâr al / VİOP short teyidi aktif.`
                                  : `⏳ Henüz erken! Fiyat şu an ${Number(item.last_close).toFixed(2)} ₺ seviyesinde; ${item.gkd_price != null ? `${Number(item.gkd_price).toFixed(2)} ₺ GKD desteği` : "alt periyot GKD desteği"} aşağı kırılmadan erken şort açmak tehlikelidir.`}
                              </li>
                              <li>
                                <strong className="text-white">Stop &amp; Hedef Planı:</strong>{" "}
                                İptal Stopu <strong>{Number(item.stop_loss).toFixed(2)} ₺</strong>, 1R ara salınım hedefi <strong>{Number(item.target_1r ?? item.target_tp1).toFixed(2)} ₺</strong>, 2R sert satış hedefi <strong>{Number(item.target_tp1).toFixed(2)} ₺</strong>.{" "}
                                {item.is_viop
                                  ? "100 paylık kontrat boyutu ve Takasbank teminat hesabı için karttaki '🧮 VİOP Planı' butonuna tıklayın."
                                  : "Yalnızca Spot piyasada işlem görür (VİOP kontratı yoktur)."}
                              </li>
                            </ul>
                          </div>
                          {item.fractal_profit_plan && (
                            <div
                              className={`rounded-lg px-3 py-2 text-[11px] leading-relaxed border ${
                                item.fractal_phase_code === "SALINIM_SONRA_YENI_ZIRVE"
                                  ? "bg-amber-950/30 border-amber-500/35 text-amber-100"
                                  : "bg-rose-950/30 border-rose-500/35 text-rose-100"
                              }`}
                            >
                              <strong>🎯 Semih Hoca Operasyon &amp; Kâr Hesabı Planı:</strong> {item.fractal_profit_plan}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* BÖLÜM 2: ERKEN YÜKSEK TEPE & ASILAN ADAM İZLEME HAVUZU */}
                <div className="workspace-panel workspace-panel-body space-y-3 border-t-2 border-t-amber-500">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wider text-amber-300 flex flex-wrap items-center gap-1.5">
                        <span>Bölüm 2 — Erken Yüksek Tepe &amp; Asılan Adam İzleme Havuzu (NU70_ADAY)</span>
                        <TermHint id="NU70_ADAY" />
                      </h3>
                      <p className="text-xs text-slate-400">
                        Katı NU70&apos;in %3 geri çekilme veya 5 bar aralık kuralını henüz doldurmamış ama görülen en yüksek fiyatta RSI &lt; 70 ve/veya dönüş mumu üreten adaylar.
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-amber-300">
                      {earlyRows.length} izleme adayı
                    </span>
                  </div>

                  {earlyRows.length === 0 ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 text-xs text-slate-400">
                      Bu taramada erken izleme adayı (`NU70_ADAY`) bulunamadı.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {earlyRows.map((c: any, idx: number) => (
                        <div key={`${c.symbol}-${idx}`} className="p-3.5 rounded-xl border border-amber-500/30 bg-slate-950/90 space-y-2 text-xs font-mono">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-black text-white">{c.symbol}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">
                                {String(c.interval).toUpperCase()}
                              </span>
                              {c.is_viop && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  VİOP
                                </span>
                              )}
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-200 border border-amber-500/30">
                                {c.candle_label && c.candle_label !== "Yok" ? c.candle_label : "Erken Tepe"}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${c.gkd_broken ? "bg-rose-500/20 text-rose-300 border border-rose-500/40" : "bg-slate-800 text-slate-300"}`}>
                                {c.gkd_broken ? "Ara Dip Altında" : "İzleme"}
                              </span>
                              {c.is_viop && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setViopModal({
                                      symbol: c.symbol,
                                      direction: "SHORT",
                                      entryPrice: Number(c.entry_level ?? c.last_close),
                                      stopPrice: Number(c.stop_loss),
                                      triggered: Boolean(c.gkd_broken),
                                      gvtOrGkdLevel: Number(c.entry_level ?? c.last_close),
                                      signalLabel: `NU70_ADAY İzleme (${String(c.interval).toUpperCase()})`,
                                    })
                                  }
                                  className="px-2 py-1 rounded-lg border border-amber-500/40 bg-amber-950/40 text-amber-200 hover:bg-amber-900/50 text-[10px] font-bold"
                                >
                                  🧮 VİOP Planı
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setChartModal({
                                    symbol: c.symbol,
                                    interval: (c.interval || nu70Interval) as ChartInterval,
                                    signalPref: "nu70",
                                  })
                                }
                                className="px-2 py-1 rounded-lg border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/50 text-[10px] font-bold"
                              >
                                📈 Grafiği Aç
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center justify-between text-slate-300 pt-1 border-t border-slate-800/70">
                            <span>
                              1. Tepe {Number(c.tepe1_price).toFixed(2)} (RSI {c.tepe1_rsi}) → 2. Tepe {Number(c.tepe2_price).toFixed(2)} (RSI {c.tepe2_rsi})
                            </span>
                            <span className="text-white font-bold">Son: {Number(c.last_close).toFixed(2)} ₺</span>
                          </div>
                          <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400">
                            <span>Ara Dip: {c.entry_level != null ? `${Number(c.entry_level).toFixed(2)} ₺` : "—"} · Stop: {Number(c.stop_loss).toFixed(2)} ₺</span>
                            <span>Çekilme %{c.pullback_pct} · {c.gap_bars} bar · {c.confirm_date}</span>
                          </div>
                          <div className="font-sans rounded-lg bg-slate-900/75 border border-amber-500/25 px-3 py-2 text-[11px] text-slate-300 space-y-1 leading-relaxed">
                            <div className="font-bold text-amber-200">
                              🗣️ Bu Hissede Ne Oluyor? (Sade Türkçe İşlem &amp; VİOP Özeti)
                            </div>
                            <ul className="space-y-1 text-slate-300 list-disc pl-4">
                              <li>
                                <strong className="text-white">Ne Bulundu?</strong>{" "}
                                Görülen en yüksek tepede ({Number(c.tepe2_price).toFixed(2)} ₺) RSI {c.tepe2_rsi} (&lt;70) oluştu ancak ara çekilme (%{c.pullback_pct}) veya {c.gap_bars} bar mesafe nedeniyle henüz erken izleme (`NU70_ADAY`) aşamasında.{" "}
                                {String(c.interval) === "15m"
                                  ? "⚠️ 15dk (NU15) erken adaylarda Saatlik (1S) onay yoksa öğleden sonra yeni zirve tuzağı riski vardır."
                                  : "Katı NU70 kuralları tam dolmadan agresif şort açılmaz."}
                              </li>
                              <li>
                                <strong className="text-white">Ne Zaman İşleme Girilir / Beklenir?</strong>{" "}
                                {c.gkd_broken
                                  ? `✅ ${c.entry_level != null ? `${Number(c.entry_level).toFixed(2)} ₺` : "Ara dip"} aşağı kırıldı; zayıflık teyitli.`
                                  : `⏳ Henüz erken! ${c.entry_level != null ? `${Number(c.entry_level).toFixed(2)} ₺ ara dip (GKD)` : "Ara dip"} aşağı kırılmadan yalnızca izlenir; erken girişte son bir tepe savrulması yaşanabilir.`}
                              </li>
                              <li>
                                <strong className="text-white">Stop &amp; Hedef Planı:</strong>{" "}
                                İptal Stopu <strong>{Number(c.stop_loss).toFixed(2)} ₺</strong> (bu seviye üstünde tepe tezi iptal olur).{" "}
                                {c.is_viop
                                  ? "VİOP'ta 100 paylık kontrat ve teminat simülasyonu için '🧮 VİOP Planı' butonunu kullanın."
                                  : "Yalnızca Spot piyasada işlem görür."}
                              </li>
                            </ul>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* BÖLÜM 3: YENİ ZİRVE İLE İPTAL EDİLEN ESKİ NU70 YAPILARI */}
                <div className="workspace-panel workspace-panel-body space-y-3 border-t-2 border-t-slate-600">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wider text-slate-300">
                        Bölüm 3 — Yeni Zirve ile İptal Edilen Eski NU70 Yapıları (`HIGHER_HIGH_BROKEN`)
                      </h3>
                      <p className="text-xs text-slate-400">
                        NU70 teyidi geldikten sonra fiyat önceki 2. tepenin üzerine çıktığı için (ör. BIMAS örneği) aktif listeden elenen hisseler.
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-400">
                      {invalidatedRows.length} elenen
                    </span>
                  </div>

                  {invalidatedRows.length === 0 ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400">
                      Yeni zirve kırılımıyla iptal edilmiş eski NU70 yapısı yok.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {invalidatedRows.map((inv: any, idx: number) => (
                        <div key={`${inv.symbol}-${idx}`} className="p-3 rounded-xl border border-slate-800 bg-slate-950/70 text-xs font-mono space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-slate-200">{inv.symbol} · {String(inv.interval).toUpperCase()}</span>
                            <div className="flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-rose-300">
                                {inv.invalidation_reason}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setChartModal({
                                    symbol: inv.symbol,
                                    interval: (inv.interval || nu70Interval) as ChartInterval,
                                    signalPref: "nu70",
                                  })
                                }
                                className="px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/50 text-[10px] font-bold"
                              >
                                📈 Grafiği Aç
                              </button>
                            </div>
                          </div>
                          <div className="text-slate-400">
                            Eski 2. Tepe: {Number(inv.tepe2_price).toFixed(2)} ₺ (RSI {inv.tepe2_rsi}) · Son: <strong className="text-white">{Number(inv.last_close).toFixed(2)} ₺</strong>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Mum: {inv.candle_label} · Teyit: {inv.confirm_date}
                          </div>
                          <div className="font-sans rounded-lg bg-slate-900/75 border border-slate-800/80 px-2.5 py-2 text-[11px] text-slate-300 space-y-1 leading-relaxed">
                            <div className="font-bold text-slate-200">
                              🗣️ Bu Hissede Ne Oluyor? (Sade Türkçe İşlem &amp; VİOP Özeti)
                            </div>
                            <ul className="space-y-1 text-slate-300 list-disc pl-4">
                              <li>
                                <strong className="text-white">Ne Bulundu?</strong>{" "}
                                Eski <strong>{Number(inv.tepe2_price).toFixed(2)} ₺</strong> (RSI {inv.tepe2_rsi}) 2. tepesi sonradan yukarı kırıldığı için (`HIGHER_HIGH_BROKEN`, son fiyat <strong>{Number(inv.last_close).toFixed(2)} ₺</strong>) önceki NU70 düşüş tezi iptal edildi.
                              </li>
                              <li>
                                <strong className="text-white">Ne Zaman İşleme Girilir / Beklenir?</strong>{" "}
                                ⛔ Eski sinyale göre şort açılmaz! Fiyat yeni zirve yaptığı için eski tepe geçersizdir; yeni zirvede RSI &lt; 70 ile yeni bir NU70 ve GKD kırılımı oluşması beklenmelidir.
                              </li>
                              <li>
                                <strong className="text-white">Stop &amp; Hedef Planı:</strong>{" "}
                                Eski 2. tepe ({Number(inv.tepe2_price).toFixed(2)} ₺) aşıldığı an stop kuralı çalışmış ve sinyal arşivlenmiştir; VİOP&apos;ta açık şort taşınmamalıdır.
                              </li>
                            </ul>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* BÖLÜM 4: AŞIRI SATIM (RSI < 30) SONRASI 2. DİP (PU30) BEKLEYENLER */}
                <div className="workspace-panel workspace-panel-body space-y-3 border-t-2 border-t-amber-400">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wider text-amber-300 flex flex-wrap items-center gap-1.5">
                        <span>Bölüm 4 — Aşırı Satım (`RSI &lt; 30`) Sonrası 2. Dip (`PU30`) Bekleyenler</span>
                        <TermHint id="EN_AZ_1_DIP_DAHA" />
                      </h3>
                      <p className="text-xs text-slate-400">
                        Semih Hoca ASELS 15dk Kuralı: RSI 30 altına indikten sonra henüz RSI &gt; 30 üzerinde 2. bir dip (PU30) yapmamış hisseler (en az 1 dip daha beklenir; tepkisiz basışta şelale riski).
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-amber-300">
                      {oversoldRows.length} aşırı satım adayı
                    </span>
                  </div>

                  {oversoldRows.length === 0 ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400">
                      Seçili periyotta henüz tamamlanmamış RSI &lt; 30 aşırı satım 1. dibi bulunmadı.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {oversoldRows.map((ov: any, idx: number) => (
                        <div key={`${ov.symbol}-${idx}`} className="p-3.5 rounded-xl border border-amber-500/35 bg-slate-950/90 space-y-2 text-xs font-mono">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-black text-white">{ov.symbol}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">
                                {ov.interval === "15m" ? "15DK" : String(ov.interval).toUpperCase()}
                              </span>
                              {ov.is_viop && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                  VİOP
                                </span>
                              )}
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  ov.has_reaction
                                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                    : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                }`}
                              >
                                {ov.reaction_label || (ov.has_reaction ? "Tepki Geldi" : "Şelale Riski")}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {ov.is_viop && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setViopModal({
                                      symbol: ov.symbol,
                                      direction: "LONG",
                                      entryPrice: Number(ov.last_close),
                                      stopPrice: Number((Number(ov.oversold_price) * 0.975).toFixed(2)),
                                      triggered: false,
                                      hasReaction: Boolean(ov.has_reaction),
                                      signalLabel: `Aşırı Satım Dip İzleme (${String(ov.interval).toUpperCase()})`,
                                    })
                                  }
                                  className="px-2 py-1 rounded-lg border border-amber-500/40 bg-amber-950/40 text-amber-200 hover:bg-amber-900/50 text-[10px] font-bold"
                                >
                                  🧮 VİOP Planı
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setChartModal({
                                    symbol: ov.symbol,
                                    interval: (ov.interval || nu70Interval) as ChartInterval,
                                    signalPref: "pu30",
                                  })
                                }
                                className="px-2 py-1 rounded-lg border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/50 text-[10px] font-bold"
                              >
                                📈 Grafiği Aç
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center justify-between text-amber-200 pt-1 border-t border-slate-800/70">
                            <span>
                              1. Dip: <strong>{Number(ov.oversold_price).toFixed(2)} ₺</strong> (RSI {ov.oversold_rsi}) · {ov.oversold_date}
                            </span>
                            <span>
                              Son: <strong className="text-white">{Number(ov.last_close).toFixed(2)} ₺</strong> (RSI {ov.current_rsi})
                            </span>
                          </div>
                          <div className="font-sans rounded-lg bg-amber-950/25 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-100/90 space-y-1 leading-relaxed">
                            <div className="font-bold text-amber-300">
                              🗣️ Bu Hissede Ne Oluyor? (Sade Türkçe İşlem &amp; VİOP Özeti)
                            </div>
                            <ul className="space-y-1 text-slate-200 list-disc pl-4">
                              <li>
                                <strong className="text-white">Ne Bulundu?</strong>{" "}
                                Fiyat <strong>{Number(ov.oversold_price).toFixed(2)} ₺</strong> seviyesinde RSI {ov.oversold_rsi} (&lt;30) ile 1. aşırı satım dibini yaptı ancak henüz RSI &gt; 30 üzerinde 2. bir dip (`PU30`) kurmadı.{" "}
                                {ov.has_reaction
                                  ? "İlk tepki yükselişi geldi; Semih Hoca ASELS 15dk kuralına göre dönüşün tamamlanması için en az 1 dip daha beklenir."
                                  : "⚠️ Henüz tepki bile gelmedi (şelale düşüşü riski); taban oluşumu tamamlanmadı."}
                              </li>
                              <li>
                                <strong className="text-white">Ne Zaman İşleme Girilir / Beklenir?</strong>{" "}
                                ⏳ Henüz işleme girilmez! İlk tepkide erken alım veya VİOP Long açmak tehlikelidir; fiyatın tekrar geri çekilip RSI &gt; 30 üzerinde 2. dip (PU30) yapması ve GVT direncini kırması beklenmelidir.
                              </li>
                              <li>
                                <strong className="text-white">Stop &amp; Hedef Planı:</strong>{" "}
                                Olası izleme stop referansı <strong>{(Number(ov.oversold_price) * 0.975).toFixed(2)} ₺</strong> (1. dip -%2.5).{" "}
                                {ov.is_viop
                                  ? "VİOP'ta neden henüz Long açılmaması gerektiğini ve risk simülasyonunu görmek için '🧮 VİOP Planı' butonuna tıklayın."
                                  : "Yalnızca Spot piyasada işlem görür."}
                                {ov.explanation ? ` (${ov.explanation})` : ""}
                              </li>
                            </ul>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* TAB 1: IMPULSE & FIB TIME TESTBED */}
      {activeTab === "impulse" && (
        <div className="space-y-6">
          <PlainGuideBanner
            storageKey="lab_impulse"
            title="1-2-3 İtki & Fib Zaman Testbed'ini 3 Adımda Nasıl Okursun?"
            steps={[
              "1. Adım (t0 → t1 → t2 Çapaları): t0 PU30 dönüşünün 2. dibini, t1 ilk güçlü yükselişin (W1) zirvesini, t2 ise t0'ı kırmayan düzeltme dibini gösterir.",
              "2. Adım (%161.8 ve %361.8 Hedefleri): 2. dip tamamlandığında W1 boyunun 1,618 ve 3,618 katı ileriye taşınarak 3. dalga ralli hedefleri hesaplanır.",
              "3. Adım (Fib Zaman Mod A / Mod B): Fiyatın hangi bar ve tarihte ivme kazanabileceğini Mod A (W1 süresi) ve Mod B (0-2 toplam süresi) sütunlarından takip et.",
            ]}
            ctaHref="/viop-rehber"
            ctaLabel="VİOP & Strateji Rehberi"
          />
          <div className="workspace-panel workspace-panel-body space-y-4">
            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-end justify-between">
              <div className="flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Test Edilecek Hisseler (Virgülle Ayırın)
                  </label>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        const p = "TUPRS,THYAO,PGSUS,SISE,AKBNK,ISCTR,VAKBN,GARAN,ASELS,KCHOL,SAHOL,BIMAS,DOAS";
                        setSymbolsInput(p);
                        runImpulseTestbed(p);
                      }}
                      className="text-cyan-400 hover:underline"
                    >
                      BIST13 Popüler
                    </button>
                    <span className="text-slate-600">·</span>
                    <button
                      type="button"
                      onClick={() => {
                        const p = BIST_30.join(",");
                        setSymbolsInput(p);
                        runImpulseTestbed(p);
                      }}
                      className="text-cyan-400 hover:underline"
                    >
                      BIST30
                    </button>
                  </div>
                </div>
                <input
                  type="text"
                  value={symbolsInput}
                  onChange={(e) => setSymbolsInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-sm text-white font-mono focus:border-emerald-500 focus:outline-none"
                  placeholder="VAKBN,ISCTR,THYAO,ASELS"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Zaman Dilimi
                </label>
                <div className="flex gap-1.5">
                  {(["15m", "1h", "4h", "1d"] as const).map((tf) => (
                    <button
                      key={tf}
                      onClick={() => {
                        setIntervalVal(tf);
                        runImpulseTestbed(symbolsInput, tf);
                      }}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        interval === tf
                          ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                          : "bg-slate-900 border-slate-800 text-slate-400"
                      }`}
                    >
                      {tf === "15m" ? "15DK" : tf.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    const preset = "ASELS";
                    setSymbolsInput(preset);
                    setIntervalVal("15m");
                    runImpulseTestbed(preset, "15m");
                  }}
                  className="px-3.5 py-2 rounded-xl border border-amber-500/40 bg-amber-950/40 text-amber-200 text-xs font-bold hover:bg-amber-900/50"
                >
                  ASELS 15dk (1 Dip Daha Örneği)
                </button>
                <button
                  onClick={() => {
                    const preset = "VAKBN,ISCTR";
                    setSymbolsInput(preset);
                    runImpulseTestbed(preset, "1h");
                    setIntervalVal("1h");
                  }}
                  className="px-3.5 py-2 rounded-xl border border-violet-500/40 bg-violet-950/40 text-violet-300 text-xs font-bold hover:bg-violet-900/50"
                >
                  VAKBN &amp; ISCTR (%361 Örneği)
                </button>
                <button
                  onClick={() => runImpulseTestbed()}
                  disabled={loadingImpulse}
                  className="rsi-button rsi-button-primary"
                >
                  {loadingImpulse ? "Analiz Ediliyor..." : "İtki analizini başlat"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 text-xs">
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3">
                <span className="text-emerald-400 font-semibold">0 Noktası (t0):</span>
                <p className="text-slate-400 mt-0.5">PU30 uyumsuzluğunun 2. dibi (1 nolu itki dalgasının başladığı dip).</p>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3">
                <span className="text-cyan-400 font-semibold">1 Tepesi (t1 - Orta Referans):</span>
                <p className="text-slate-400 mt-0.5">1 nolu itki dalgasının zirvesi (Güven Tazeleyen Tepe). RSI ivmesi ve hacim burada ölçülür.</p>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3">
                <span className="text-amber-400 font-semibold">2 Dibi (t2 - Zaman Startı):</span>
                <p className="text-slate-400 mt-0.5">t0 dibini kırmayan yüksek dip. Fibo geri çekilmesi ve Fib Zaman başlangıcı.</p>
              </div>
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 p-3">
                <span className="text-violet-400 font-semibold">Fib Zaman Sündürme:</span>
                <p className="text-slate-400 mt-0.5">t2&apos;den ileriye 0.382 / 0.618 / 1.000 / 1.618 zaman pencereleri ve Dalga 3 takibi.</p>
              </div>
            </div>
          </div>

          {/* Results Cards */}
          <div className="space-y-4" aria-busy={loadingImpulse}>
            {loadingImpulse && <p role="status" className="text-cyan-300">Seçilen hisselerin verileri ve itki yapıları inceleniyor…</p>}
            {!loadingImpulse && impulseData.length === 0 && <p className="rounded-xl border border-slate-800 p-6 text-slate-400">Henüz analiz yapılmadı. Hisse ve zaman dilimini seçip itki analizini başlatın.</p>}
            {impulseData.map((item) => {
              const imp = item.impulse_analysis;
              const w1 = imp?.dalga1;
              const w2 = imp?.dalga2;
              const w3 = imp?.dalga3_takip;
              return (
                <div
                  key={item.symbol}
                  className="workspace-panel workspace-panel-body space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-semibold text-white">{item.symbol}</span>
                      <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-slate-800 text-slate-300">
                        {item.interval}
                      </span>
                      {item.has_signal ? (
                        <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold bg-emerald-950/80 border border-emerald-500/40 text-emerald-300">
                          PU30 TESPİT EDİLDİ ({item.in_live_window ? "CANLI PENCEREDE" : `${item.bars_since_confirm} bar önce`})
                        </span>
                      ) : item.pre_pu30?.has_oversold_dip1 ? (
                        <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-950/80 border border-amber-500/50 text-amber-200">
                          {item.pre_pu30.badge}
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-slate-900 border border-slate-700 text-slate-400">
                          {item.status ? `Veri kullanılamıyor: ${item.status}` : "Bu periyotta PU30 yok"}
                        </span>
                      )}
                      {item.has_signal && item.pre_pu30?.has_oversold_dip1 && (
                        <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-950/80 border border-amber-500/50 text-amber-200">
                          {item.pre_pu30.badge}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span>Son Kapanış: <strong className="text-white font-mono">{item.last_close ?? "—"} ₺</strong></span>
                      <button
                        type="button"
                        onClick={() => {
                          const entryVal = Number(w1?.p1_price ?? item.last_close ?? 0);
                          const stopVal = Number(w2?.p2_price ?? item.dip2?.price ?? (item.pre_pu30?.oversold_price ? Number(item.pre_pu30.oversold_price) * 0.975 : entryVal * 0.96));
                          const t161 = imp?.fib_fiyat_hedefleri?.["1.618"]?.target_from_w2;
                          const t361 = imp?.fib_fiyat_hedefleri?.["3.618"]?.target_from_w2;
                          setViopModal({
                            symbol: item.symbol,
                            direction: "LONG",
                            entryPrice: entryVal > 0 ? entryVal : 100,
                            stopPrice: stopVal > 0 && stopVal < entryVal ? Number(stopVal.toFixed(2)) : Number((entryVal * 0.96).toFixed(2)),
                            target1r: t161 != null ? Number(t161) : undefined,
                            target2r: t361 != null ? Number(t361) : undefined,
                            triggered: Boolean(w3?.w1_tepesi_kirildi),
                            hasReaction: item.pre_pu30?.has_oversold_dip1 ? Boolean(item.pre_pu30?.has_reaction ?? true) : true,
                            gvtOrGkdLevel: w1?.p1_price != null ? Number(w1.p1_price) : undefined,
                            signalLabel: `1-2-3 İtki & Fib Zaman (${String(item.interval || interval).toUpperCase()})`,
                          });
                        }}
                        className="px-2.5 py-1 rounded-lg border border-emerald-500/40 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50 text-[11px] font-bold"
                      >
                        🧮 VİOP Planı
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setChartModal({
                            symbol: item.symbol,
                            interval: (item.interval || interval) as ChartInterval,
                            signalPref: "pu30",
                          })
                        }
                        className="px-2.5 py-1 rounded-lg border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/50 text-[11px] font-bold"
                      >
                        📈 Grafiği Aç
                      </button>
                    </div>
                  </div>

                  {/* Sade Türkçe İşlem & VİOP Özeti (3 Madde) */}
                  <div className="rounded-xl border border-cyan-500/30 bg-slate-900/80 p-3.5 text-xs text-slate-200 space-y-1.5 leading-relaxed">
                    <div className="font-bold text-cyan-300">
                      🗣️ Bu Hissede Ne Oluyor? (Sade Türkçe İşlem &amp; VİOP Özeti)
                    </div>
                    <ul className="space-y-1 text-slate-300 list-disc pl-4">
                      <li>
                        <strong className="text-white">Ne Bulundu?</strong>{" "}
                        {item.has_signal && imp ? (
                          <>
                            {item.symbol} ({String(item.interval).toUpperCase()}) grafiğinde{" "}
                            <strong>
                              {item.dip1?.price?.toFixed(2)} ₺ → {item.dip2?.price?.toFixed(2)} ₺
                            </strong>{" "}
                            arasında <strong>PU30 dip dönüşü (0 noktası)</strong> tamamlandı
                            {w1
                              ? ` ve ardından ${w1.p1_price} ₺'ye (+%${w1.gain_pct}) 1 Nolu İtki Dalgası (W1)`
                              : ""}
                            {w2
                              ? ` ile ${w2.p2_price} ₺'ye (Fibo ${w2.price_retracement_fib}) 2 Nolu Düzeltme Dibi (W2) kuruldu.`
                              : "."}{" "}
                            {String(item.interval) === "15m"
                              ? "⚠️ 15dk (PU15) tek başına sinyallerde Saatlik (1S) onay yoksa öğleden sonra yeni dip tuzağı riski vardır; 1S grafikle birlikte doğrulayın."
                              : "1S/4S fraktal kuralına göre 0-1-2 kalıbı ana 3. dalga rallisinin hazırlığıdır."}
                          </>
                        ) : item.pre_pu30?.has_oversold_dip1 ? (
                          <>
                            {item.symbol} ({String(item.interval).toUpperCase()}) grafiğinde{" "}
                            <strong>{Number(item.pre_pu30.oversold_price).toFixed(2)} ₺</strong> (RSI {item.pre_pu30.oversold_rsi}) seviyesinde 1. aşırı satım dibi oluştu ancak henüz RSI &gt; 30 üzerinde 2. bir dip (`PU30`) kurulmadı (Semih Hoca ASELS 15dk kuralı: <strong>En az 1 dip daha beklenir</strong>).
                          </>
                        ) : (
                          <>
                            {item.symbol} ({String(item.interval).toUpperCase()}) grafiğinde şu an aktif bir PU30 dip uyumsuzluğu veya tamamlanmış 0-1-2 itki yapısı bulunmuyor.
                          </>
                        )}
                      </li>
                      <li>
                        <strong className="text-white">Ne Zaman İşleme Girilir / Beklenir?</strong>{" "}
                        {item.has_signal && imp && w1 ? (
                          w3?.w1_tepesi_kirildi ? (
                            <>
                              ✅ 1. Dalga (W1 / GVT) zirvesi olan <strong>{w1.p1_price} ₺</strong> yukarı kırıldı (en yüksek {w3.max_price_after_w2} ₺ görüldü); 3. dalga ralli teyidi aktif.
                            </>
                          ) : (
                            <>
                              ⏳ 1. Dalga (W1 / GVT) zirvesi olan <strong>{w1.p1_price} ₺</strong> üzerinde kapanış bekleniyor. Bu seviye kırılmadan erken girmek, 2. düzeltme dalgası uzarsa stop olma riski taşır.
                            </>
                          )
                        ) : item.pre_pu30?.has_oversold_dip1 ? (
                          <>
                            ⏳ Henüz işleme girilmez! İlk tepki yükselişinde erken Long açmak tuzaktır; fiyatın tekrar aşağı salınıp RSI &gt; 30 üzerinde 2. dip (PU30) yapması ve GVT direncini kırması beklenmelidir.
                          </>
                        ) : (
                          <>
                            ⏳ Yeni bir aşırı satım (RSI &lt; 30) sonrası 2. dip (PU30) ve GVT kırılımı oluşana kadar beklenmelidir.
                          </>
                        )}
                      </li>
                      <li>
                        <strong className="text-white">Stop &amp; Hedef Planı:</strong>{" "}
                        {item.has_signal && imp ? (
                          <>
                            Koruma stopu 2. dip altı <strong>{Number(w2?.p2_price ?? item.dip2?.price ?? 0).toFixed(2)} ₺</strong> (ana iptal: {Number(item.dip2?.price ?? 0).toFixed(2)} ₺).{" "}
                            {imp.fib_fiyat_hedefleri ? (
                              <>
                                Fibonacci ralli hedefleri: <strong>%161.8 ({Number(imp.fib_fiyat_hedefleri["1.618"]?.target_from_w2 ?? 0).toFixed(2)} ₺)</strong> ve ana &ldquo;Arkana Yaslan&rdquo; hedefi <strong>%361.8 ({Number(imp.fib_fiyat_hedefleri["3.618"]?.target_from_w2 ?? 0).toFixed(2)} ₺)</strong>.{" "}
                              </>
                            ) : null}
                            VİOP&apos;ta 100 paylık kontrat boyutu ve Takasbank teminat hesabı için üstteki <strong>&ldquo;🧮 VİOP Planı&rdquo;</strong> butonuna tıklayın.
                          </>
                        ) : item.pre_pu30?.has_oversold_dip1 ? (
                          <>
                            İzleme referans stopu <strong>{(Number(item.pre_pu30.oversold_price) * 0.975).toFixed(2)} ₺</strong> (1. dip -%2.5). 2. dip tamamlanmadan hedef (%161.8 / %361.8) kesinleşmez; VİOP risk simülasyonu için <strong>&ldquo;🧮 VİOP Planı&rdquo;</strong> butonuna tıklayın.
                          </>
                        ) : (
                          <>
                            Aktif kurulum olmadığı için stop ve hedef seviyesi hesaplanmadı; VİOP simülasyonu için <strong>&ldquo;🧮 VİOP Planı&rdquo;</strong> butonunu kullanabilirsiniz.
                          </>
                        )}
                      </li>
                    </ul>
                  </div>

                  {item.pre_pu30?.has_oversold_dip1 && (
                    <div className="rounded-xl border border-amber-500/35 bg-amber-950/25 p-3.5 space-y-1.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-amber-200">
                        <span>1. Aşırı Satım Dibi: <strong>{Number(item.pre_pu30.oversold_price).toFixed(2)} ₺</strong> (RSI {item.pre_pu30.oversold_rsi}) · {item.pre_pu30.oversold_date}</span>
                        <span>Güncel RSI: <strong>{item.pre_pu30.current_rsi}</strong> · {item.pre_pu30.reaction_label}</span>
                      </div>
                      <p className="text-amber-100/90 leading-relaxed">
                        <strong>📌 Semih Hoca Kuralı (En Az 1 Dip Daha):</strong> {item.pre_pu30.explanation}
                      </p>
                    </div>
                  )}

                  {item.status && <p className="text-amber-300 text-sm">{item.error_message || "Veri kalitesi veya geçmiş mum sayısı yetersiz; sinyal değerlendirilmedi."} · {item.bar_count ?? 0} mum</p>}

                  {item.has_signal && imp && (
                    <>
                      {/* 0 - 1 - 2 Anchor Summary */}
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                          <div className="text-slate-400 font-bold">PU30 Dip 1 → Dip 2 (t0 = 0 Zaman)</div>
                          <div className="text-white font-mono font-bold mt-1 text-sm">
                            {item.dip1.price.toFixed(2)} ₺ → {item.dip2.price.toFixed(2)} ₺
                          </div>
                          <div className="text-emerald-400 font-mono mt-0.5">
                            RSI: {item.dip1.rsi.toFixed(1)} → {item.dip2.rsi.toFixed(1)}
                          </div>
                          <div className="text-slate-500 mt-1">
                            {item.dip1.date} → {item.dip2.date}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-800/60">
                            Dönüşün başladığı ana taban ve RSI güçlenmesi.
                          </p>
                        </div>

                        {w1 ? (
                          <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/15 p-3.5">
                            <div className="text-cyan-300 font-bold">1 Nolu İtki Dalgası (t0 → t1)</div>
                            <div className="text-white font-mono font-bold mt-1 text-sm">
                              {imp.p0_price} ₺ → {w1.p1_price} ₺ (+%{w1.gain_pct})
                            </div>
                            <div className="text-cyan-200 font-mono mt-0.5">
                              Süre: {w1.duration_bars} bar | RSI: {w1.rsi_start} → {w1.rsi_peak} (+{w1.rsi_delta})
                            </div>
                            <div className="text-slate-400 mt-1">
                              Yeşil Mum: %{Math.round(w1.bull_bar_ratio * 100)} | Gövde/Boy: {w1.avg_body_to_range} | Hacim: {w1.volume_multiplier}x
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-800/60">
                              İlk yükseliş dalgasının hızı, alıcı iştahı ve hacim desteği.
                            </p>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5 text-slate-400">
                            <div>1-2 yapısı henüz kesinleşmedi ({imp.durum})</div>
                            <p className="text-[11px] text-slate-500 mt-1.5">
                              1. tepe sonrası sağlıklı bir 2. dip oluşmadan Dalga 3 ölçülmez.
                            </p>
                          </div>
                        )}

                        {w2 && (
                          <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-3.5">
                            <div className="text-amber-300 font-bold">2 Nolu Düzeltme (t1 → t2 Zaman Startı)</div>
                            <div className="text-white font-mono font-bold mt-1 text-sm">
                              {w1.p1_price} ₺ → {w2.p2_price} ₺ (Fibo {w2.price_retracement_fib})
                            </div>
                            <div className="text-amber-200 font-mono mt-0.5">
                              Süre: {w2.duration_bars} bar | W2/W1 Süre: {w2.time_ratio_dt2_over_dt1}x
                            </div>
                            <div className="text-slate-400 mt-1">
                              t2 Tarihi: {w2.t2_date} | t1 Konumu (0..2): {w2.t1_position_in_02}
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-800/60">
                              Ana dibi bozmayan geri çekilme derinliği; 0.382-0.786 arası idealdir.
                            </p>
                          </div>
                        )}

                        {w3 && (
                          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-3.5">
                            <div className="text-emerald-300 font-bold">3 Nolu Dalga (t2 Sonrası Gerçekleşen)</div>
                            <div className="text-white font-mono font-bold mt-1 text-sm">
                              Zirve: {w3.max_price_after_w2} ₺ ({w3.w1_tepesi_kirildi ? "W1 KIRILDI ✅" : "W1 Bekleniyor"})
                            </div>
                            <div className="text-emerald-200 font-mono mt-0.5">
                              W3/W1 Fiyat: {w3.w3_vs_w1_price_ratio}x | W3/W1 Süre: {w3.w3_vs_w1_time_ratio}x
                            </div>
                            <div className="text-slate-400 mt-1">
                              Zirve Tarihi: {w3.max_date_after_w2} (+{w3.bars_from_t2_to_peak} bar)
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-800/60">
                              W1 tepesi geçildiyse ana ralli fazı başlamış demektir (&gt;1.618x güçlü).
                            </p>
                          </div>
                        )}
                      </div>

                      {/* 1-2 Oluşumu Sonrası %361.8 Dahil Fibonacci Fiyat Hedefleri */}
                      {imp.fib_fiyat_hedefleri && (
                        <div className="rounded-xl border border-violet-500/30 bg-violet-950/15 p-3.5 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-bold text-violet-300">
                              🎯 1-2 Oluşumu Sonrası Fibonacci Fiyat Hedefleri (%100 → %361.8 &ldquo;Arkana Yaslan&rdquo; Seviyesi)
                            </span>
                            {w3?.hedef_361_goruldu && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                ✅ %361 HEDEFİ GÖRÜLDÜ
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
                            {(["1.000", "1.618", "2.618", "3.618"] as const).map((ratioKey) => {
                              const target = imp.fib_fiyat_hedefleri[ratioKey];
                              if (!target) return null;
                              const is361 = ratioKey === "3.618";
                              return (
                                <div
                                  key={ratioKey}
                                  className={`rounded-lg border p-2.5 ${
                                    is361
                                      ? "border-amber-400/50 bg-amber-950/25"
                                      : "border-slate-800 bg-slate-950/80"
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className={is361 ? "font-bold text-amber-300" : "font-bold text-slate-300"}>
                                      Fib {ratioKey} ({target.pct_label})
                                    </span>
                                    {target.reached && <span className="text-[10px] text-emerald-400">✅</span>}
                                  </div>
                                  <div className="text-sm font-black text-white mt-1">
                                    {Number(target.target_from_w2).toFixed(2)} ₺
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    Dip 0 bazlı: {Number(target.target_from_w0).toFixed(2)} ₺
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-[11px] text-slate-400">
                            <strong className="text-slate-200">📌 Semih Hoca İtki Kuralı:</strong>{" "}
                            1. dalga ve 2. dip netleştikten sonra 1. dalga boyunun %161.8, %261.8 ve ana ralli hedefi <strong>%361.8 (3.618x)</strong> seviyeleri izlenir.
                          </p>
                        </div>
                      )}

                      {/* Fib Time Table */}
                      {imp.fib_zaman_w1_referans && (
                        <div className="space-y-2">
                          <div className="overflow-x-auto rounded-xl border border-slate-800">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-900/90 text-slate-400 uppercase">
                                <tr>
                                  <th className="py-2.5 px-3">Fib Zaman Seviyesi</th>
                                  <th className="py-2.5 px-3">Mod A: W1-Bazlı (Δt1 × Oran)</th>
                                  <th className="py-2.5 px-3">Mod A Kapanış</th>
                                  <th className="py-2.5 px-3">Mod B: 0–2 Sündürme (Δt02 × Oran)</th>
                                  <th className="py-2.5 px-3">Mod B Kapanış</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/70 font-mono">
                                {["0.382", "0.618", "1.000", "1.382", "1.618", "2.618", "3.618"].map((k) => {
                                  const fa = imp.fib_zaman_w1_referans[k];
                                  const fb = imp.fib_zaman_02_sundurme[k];
                                  if (!fa || !fb) return null;
                                  return (
                                    <tr key={k} className="hover:bg-slate-900/40">
                                      <td className="py-2 px-3 font-bold text-violet-300">Fib {k}</td>
                                      <td className="py-2 px-3 text-slate-300">
                                        +{fa.bar_offset} bar → {fa.target_date}
                                      </td>
                                      <td className="py-2 px-3 text-emerald-400 font-bold">
                                        {fa.close_at_target ? `${fa.close_at_target} ₺` : "Gelecek Bar"}
                                      </td>
                                      <td className="py-2 px-3 text-slate-300">
                                        +{fb.bar_offset} bar → {fb.target_date}
                                      </td>
                                      <td className="py-2 px-3 text-cyan-400 font-bold">
                                        {fb.close_at_target ? `${fb.close_at_target} ₺` : "Gelecek Bar"}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <p className="text-[11px] text-slate-400 px-1">
                            <strong className="text-slate-200">📌 Tablo Nasıl Okunur?</strong>{" "}
                            Mod A (yalnızca 1. dalga süresi bazlı) ve Mod B (0→2 toplam düzeltme döngüsü bazlı), fiyatın ivme veya dönüş yapabileceği hedef tarih pencerelerini verir; <code className="text-slate-300">Gelecek Bar</code> yazan satırlar henüz gelmemiş ileri tarihli zaman hedefleridir.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: BACKTEST & RULES */}
      {activeTab === "backtest" && (
        <div className="space-y-6">
          <div className="workspace-panel workspace-panel-body space-y-4">
            <h2 className="text-lg font-semibold text-white">
              Kayıtlı BIST100 karşılaştırması &amp; VİOP Pay Vadeli Değerlendirmesi
            </h2>
            <p className="text-xs text-slate-400">
              Kayıtlı referans tablosu. Spot sinyallerin %2 risk bütçesi, 100x kontrat çarpanı, %20 Takasbank başlangıç teminatı ve %0.05 çift yön komisyon varsayımıyla VİOP Pay Vadeli performansına nasıl dönüştüğünü birlikte gösterir.
            </p>
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-slate-400 uppercase">
                  <tr>
                    <th className="py-3 px-4">Periyot</th>
                    <th className="py-3 px-4">Giriş Tetik Modu</th>
                    <th className="py-3 px-4">İşlem Sayısı</th>
                    <th className="py-3 px-4">Başarı (Win Rate)</th>
                    <th className="py-3 px-4">Ort. Getiri</th>
                    <th className="py-3 px-4">Medyan Getiri</th>
                    <th className="py-3 px-4">Profit Factor</th>
                    <th className="py-3 px-4">VİOP Kaldıraç</th>
                    <th className="py-3 px-4">VİOP Net EV</th>
                    <th className="py-3 px-4">VİOP Teminat &amp; Risk Notu</th>
                    <th className="py-3 px-4">Açıklama</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 font-mono">
                  {BIST100_BACKTEST_SUMMARY.map((row, i) => (
                    <tr
                      key={i}
                      className={row.highlight ? "bg-emerald-950/20 text-emerald-200" : "text-slate-300"}
                    >
                      <td className="py-3 px-4 font-bold">{row.tf}</td>
                      <td className="py-3 px-4 font-sans font-bold">{row.mode}</td>
                      <td className="py-3 px-4">{row.signals}</td>
                      <td className="py-3 px-4 font-bold text-emerald-400">{row.winRate}</td>
                      <td className="py-3 px-4 font-bold text-cyan-300">{row.avgRet}</td>
                      <td className="py-3 px-4">{row.medianRet}</td>
                      <td className="py-3 px-4 font-bold">{row.pf}</td>
                      <td className="py-3 px-4 font-sans text-amber-300 font-semibold">{row.viopLeverage}</td>
                      <td className="py-3 px-4 font-bold text-emerald-300">{row.viopNetEv}</td>
                      <td className="py-3 px-4 font-sans text-slate-300 text-[11px] leading-relaxed">{row.viopMarginNote}</td>
                      <td className="py-3 px-4 font-sans text-slate-400">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400">
              <strong className="text-slate-200">📌 Sütun Rehberi:</strong>{" "}
              <strong>Başarı (Win Rate)</strong> kârlı kapanan işlem yüzdesini, <strong>Ort. / Medyan Getiri</strong> sinyal başına getiriyi (medyan uç değer etkisini ayıklar), <strong>Profit Factor</strong> toplam kârın toplam zarara oranını (&gt;1.50 güçlü sistem), <strong>VİOP Net EV</strong> ise %2 risk bütçesi, 100x kontrat çarpanı, %20 Takasbank teminatı ve %0.05 çift yönlü komisyon düşüldükten sonraki beklenen net getiriyi gösterir.
            </p>
          </div>

          <div className="workspace-panel workspace-panel-body space-y-4">
            <h2 className="text-lg font-semibold text-white">Kural doğrulama matrisi</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {RULE_MATRIX.map((r: any) => (
                <div key={r.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-emerald-400">{r.id}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-200">
                      {r.status}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-white">{r.title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">{r.rule}</p>
                  <div className="text-[11px] font-mono text-cyan-300 bg-cyan-950/30 border border-cyan-500/20 rounded-lg px-2.5 py-1.5">
                    Örnek: {r.examples}
                  </div>
                  {r.meaning && (
                    <p className="text-[11px] text-slate-400 pt-1">
                      <strong className="text-slate-300">📌 Pratik Etkisi:</strong> {r.meaning}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PYTEST SUITE */}
      {activeTab === "pytest" && (
        <div className="workspace-panel workspace-panel-body space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Birim ve regresyon testleri</h2>
              <p className="text-xs text-slate-400">
                Paket seçin ve çalıştırın. Veri güvenilirliği ağ gerektirmeyen timeout, önbellek ve eksik mum senaryolarını doğrular; MTF paketi strateji Lab kurallarını denetler.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => runPytestSuite()}
                disabled={loadingPytest}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-500 disabled:opacity-50"
              >
                {loadingPytest ? "Yükleniyor…" : executionMode === "report" ? "Seçilen paketin raporunu göster" : "Seçilen paketi çalıştır"}
              </button>
              <button
                onClick={() => runPytestSuite("all")}
                disabled={loadingPytest}
                className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-900 text-slate-200 font-bold text-xs hover:bg-slate-800 disabled:opacity-50"
              >
                Tüm testleri çalıştır
              </button>
            </div>
          </div>

          {executionMode === "report" && <p className="rounded-xl border border-cyan-500/30 p-3 text-xs text-cyan-200">Vercel görünümü: Testler geliştirme / CI ortamında çalıştırılır. Burada yayınla birlikte gelen tarihli rapor incelenir; canlıda yeniden çalıştırılmaz.</p>}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="Test paketi seçimi">
            {suites.map((suite) => <button key={suite.id} aria-pressed={selectedSuite === suite.id} disabled={loadingPytest} onClick={() => setSelectedSuite(suite.id)} className={`rounded-xl border p-4 text-left ${selectedSuite === suite.id ? "border-emerald-500 bg-emerald-950/40" : "border-slate-700 bg-slate-950"}`}>
              <strong className="text-sm text-white">{suite.label}</strong><span className="block text-xs text-slate-400 mt-2">{suite.description}</span>
            </button>)}
          </div>
          {loadingPytest && <p role="status" className="text-cyan-300 text-sm">Testler çalışıyor. Tamamlandığında her testin sonucu ve süresi burada gösterilecek.</p>}
          {!loadingPytest && !pytestData && <EmptyState title="Henüz test sonucu yok" description="Bir test paketi seçip doğrulamayı başlatın. Geçen ve başarısız kontroller burada gösterilecek." />}

          {pytestData && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span
                  className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                    pytestData.passed
                      ? "bg-emerald-950 border border-emerald-500/50 text-emerald-300"
                      : "bg-rose-950 border border-rose-500/50 text-rose-300"
                  }`}
                >
                  {pytestData.timed_out ? "Süre sınırına ulaşıldı" : pytestData.passed ? "Paket geçti" : `Paket başarısız (kod ${pytestData.exit_code})`}
                </span>
                <span className="text-xs text-slate-400">{pytestData.label} · {pytestData.duration_sec} sn · {new Date(pytestData.completed_at).toLocaleString("tr-TR")}</span>
              </div>
              <div className="workspace-metrics" aria-live="polite">
                {([ ["Toplam", pytestData.summary.total], ["Geçen", pytestData.summary.passed], ["Başarısız", pytestData.summary.failed], ["Hata", pytestData.summary.error], ["Atlanan", pytestData.summary.skipped] ] as const).map(([label, count]) => <MetricCard key={label} label={label} value={count} />)}
              </div>
              <p className="text-[11px] text-slate-400">
                <strong className="text-slate-200">📌 Sonuçlar Ne Anlama Geliyor?</strong>{" "}
                Üretim geçişi için <strong>Başarısız = 0</strong>, <strong>Hata = 0</strong> ve <strong>Atlanan = 0</strong> olmalıdır; geçen her test ilgili matematiksel kuralın ve veri korumasının bozulmadığını doğrular.
              </p>
              <div className="max-h-96 overflow-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs"><caption className="sr-only">Test sonuçları</caption><thead className="bg-slate-900 text-slate-300"><tr><th className="p-3">Test</th><th className="p-3">Sonuç</th><th className="p-3">Süre</th></tr></thead><tbody>
                  {pytestData.results.map((test, i) => <tr key={i} className="border-t border-slate-800"><td className="p-3 break-all text-slate-300">{test.name}{test.message && <p className="mt-1 text-rose-300">{test.message}</p>}</td><td className={`p-3 ${test.status === "passed" ? "text-emerald-300" : "text-amber-300"}`}>{({passed: "Geçti", failed: "Başarısız", error: "Hata", skipped: "Atlandı"} as Record<string, string>)[test.status]}</td><td className="p-3 text-slate-400">{test.duration_sec} sn</td></tr>)}
                </tbody></table>
              </div>
              <details><summary className="cursor-pointer text-sm text-slate-400">Ayrıntılı test çıktısı</summary>
              <pre className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs font-mono text-slate-300 overflow-x-auto max-h-[500px] overflow-y-auto whitespace-pre-wrap">
                {pytestData.output}
              </pre>
              </details>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: LIVE SIGNAL JOURNAL */}
      {activeTab === "journal" && (
        <div className="space-y-6">
          <PlainGuideBanner
            storageKey="lab_journal"
            title="Canlı Sinyal Günlüğünü (Append-Only) 3 Adımda Nasıl Okursun?"
            steps={[
              "1. Adım (Sıfır Geleceğe Bakış): Bu tablodaki her sinyal mum kapandıktan sonra canlıda ilk görülebildiği 'knowable_at' zaman damgasıyla kaydedilir; geriye dönük silinmez.",
              "2. Adım (Saatlik Güven Seviyesi): Sinyalin yanındaki Saatlik Güven Seviyesi (GVT veya GKD) kırılmadan işlem tetiklenmiş sayılmaz.",
              "3. Adım (Grafik & VİOP Doğrulaması): '📈 Grafiği Aç' ile uyumsuzluk eğimini incele, VİOP kontrat planı için VİOP Rehberi'ndeki hesaplayıcıyı kullan.",
            ]}
            ctaHref="/viop-rehber"
            ctaLabel="VİOP & Strateji Rehberi"
          />
        <div className="workspace-panel workspace-panel-body space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white flex flex-wrap items-center gap-1.5">
                <span>Sinyal günlüğü</span>
                <TermHint id="KNOWABLE_AT" />
              </h2>
              <p className="text-xs text-slate-400">
                Tarayıcı çalıştıkça tespit edilen tüm sinyallerin `knowable_at` zaman damgası ve saatlik güven seviyeleriyle değiştirilemez (append-only) kaydı.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => loadJournal(true)}
                disabled={loadingJournal}
                className="px-4 py-2 rounded-xl border border-emerald-500/40 bg-emerald-950/40 text-emerald-300 font-bold text-xs hover:bg-emerald-900/40 disabled:opacity-50"
              >
                {loadingJournal ? "Taranıyor..." : "⚡ Tüm BIST100 (1G / 4S / 1S) Tara & Günlüğe Kaydet"}
              </button>
              <button
                onClick={() => loadJournal(false)}
                disabled={loadingJournal}
                className="px-4 py-2 rounded-xl border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 font-bold text-xs disabled:opacity-50"
              >
                {loadingJournal ? "Yükleniyor..." : "Günlüğü yenile"}
              </button>
            </div>
          </div>

          {journalRows.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 text-slate-400 text-xs">
              Henüz kayıtlı sinyal günlüğü satırı yok veya tarayıcı yeni başlatıldı. Yukarıdaki tarama butonunu çalıştırdığınızda tüm sinyaller kaydedilir.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-900 text-slate-400 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Tarih</th>
                    <th className="py-2.5 px-3">Sembol</th>
                    <th className="py-2.5 px-3">TF</th>
                    <th className="py-2.5 px-3">Tip</th>
                    <th className="py-2.5 px-3">1. Dip/Tepe</th>
                    <th className="py-2.5 px-3">2. Dip/Tepe</th>
                    <th className="py-2.5 px-3">Son Fiyat</th>
                    <th className="py-2.5 px-3">Saatlik Güven Seviyesi</th>
                    <th className="py-2.5 px-3">Durum</th>
                    <th className="py-2.5 px-3">Bilinebilir Zaman</th>
                    <th className="py-2.5 px-3">Grafik</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {journalRows.map((r, idx) => (
                    <tr key={idx} className="hover:bg-slate-900/40">
                      <td className="py-2 px-3 text-slate-400">{r.date || r.confirm_date || "—"}</td>
                      <td className="py-2 px-3 font-bold text-white">{r.symbol}</td>
                      <td className="py-2 px-3 text-slate-300">{r.interval}</td>
                      <td className={`py-2 px-3 font-bold ${r.signal_type === "NU70" ? "text-rose-400" : "text-emerald-400"}`}>
                        {r.signal_type}
                      </td>
                      <td className="py-2 px-3 text-slate-300">
                        {r.p1_price ? `${r.p1_price} (RSI ${r.p1_rsi})` : "—"}
                      </td>
                      <td className="py-2 px-3 text-slate-300">
                        {r.p2_price ? `${r.p2_price} (RSI ${r.p2_rsi})` : "—"}
                      </td>
                      <td className="py-2 px-3 text-white">{r.entry_price ? `${r.entry_price} ₺` : "—"}</td>
                      <td className="py-2 px-3 text-cyan-300">{r.trust_level_price || "—"}</td>
                      <td className="py-2 px-3 text-amber-300">{r.trust_level_state || r.trust_level_durum || "—"}</td>
                      <td className="py-2 px-3 text-slate-400">{r.knowable_at}</td>
                      <td className="py-2 px-3">
                        <button
                          type="button"
                          onClick={() =>
                            setChartModal({
                              symbol: r.symbol,
                              interval: (["15m", "1h", "4h", "1d"].includes(r.interval) ? r.interval : "1h") as ChartInterval,
                              signalPref: r.signal_type === "NU70" ? "nu70" : "pu30",
                            })
                          }
                          className="px-2 py-1 rounded-lg border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 hover:bg-cyan-900/50 text-[10px] font-bold whitespace-nowrap"
                        >
                          📈 Grafiği Aç
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-slate-400">
            <strong className="text-slate-200">📌 Tablo Sütunları Ne Anlama Geliyor?</strong>{" "}
            <strong>1./2. Dip/Tepe</strong> uyumsuzluğun iki fiyat ve RSI ucunu, <strong>Saatlik Güven Seviyesi</strong> alt-periyot GVT/GKD kırılım eşik fiyatını, <strong>Durum</strong> eşiğin kırılıp kırılmadığını, <strong>Bilinebilir Zaman (knowable_at)</strong> ise sinyalin mum kapandıktan sonra canlıda ilk görülebildiği anı (gelecekten veri sızıntısı önlemi) gösterir.
          </p>
        </div>
        </div>
      )}
      </section>
      {chartModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 overflow-y-auto"
          onClick={() => setChartModal(null)}
        >
          <div className="w-full max-w-5xl my-auto" onClick={(e) => e.stopPropagation()}>
            <SemihDivergenceChart
              symbol={chartModal.symbol}
              defaultInterval={chartModal.interval}
              defaultSignalPref={chartModal.signalPref || "auto"}
              onClose={() => setChartModal(null)}
            />
          </div>
        </div>
      )}
      {viopModal && (
        <div
          role="dialog"
          aria-modal="true"
          data-viop-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 overflow-y-auto"
          onClick={() => setViopModal(null)}
        >
          <div className="w-full max-w-4xl my-auto" onClick={(e) => e.stopPropagation()}>
            <ViopCalculator
              signalPreset={viopModal}
              compact
              onClose={() => setViopModal(null)}
            />
          </div>
        </div>
      )}
    </WorkspacePage>
  );
}
