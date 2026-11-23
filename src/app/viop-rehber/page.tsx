"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  WorkspacePage,
  Panel,
  MetricCard,
  StatusBadge,
} from "@/components/ui/Workspace";
import { ViopCalculator, type ViopSignalPreset } from "@/components/ViopCalculator";
import { PlainGuideBanner } from "@/components/PlainGuideBanner";
import { TermHint } from "@/components/GlossaryTooltip";
import {
  GLOSSARY_LIST,
  GLOSSARY_TERMS,
  type GlossaryCategory,
} from "@/lib/glossary";
import { BIST_STOCK_FUTURES_MULTIPLIER, BIST_VIOP_SYMBOLS } from "@/lib/viop";

const BIST_VIOP_PRESETS: Array<{
  id: string;
  title: string;
  subtitle: string;
  badgeTone: "positive" | "warning" | "negative";
  badgeText: string;
  preset: ViopSignalPreset;
}> = [
  {
    id: "THYAO_SHORT",
    title: "THYAO Short (1S+4S NU70 + GKD Kırılımı)",
    subtitle: "325,75 ₺ GKD kırılımı onaylı · Stop 340,04 ₺ · 2R Hedef 297,17 ₺",
    badgeTone: "positive",
    badgeText: "ONAYLI VİOP SHORT",
    preset: {
      symbol: "THYAO",
      direction: "SHORT",
      entryPrice: 325.75,
      stopPrice: 340.04,
      target1r: 311.46,
      target2r: 297.17,
      triggered: true,
      gvtOrGkdLevel: 325.75,
      signalLabel: "1S+4S NU70 Onaylı Short",
    },
  },
  {
    id: "VAKBN_LONG",
    title: "VAKBN Long (PU30 + GVT Üstü Kapanış)",
    subtitle: "26,40 ₺ GVT kırılımı onaylı · Stop 25,60 ₺ · 2R Hedef 28,00 ₺",
    badgeTone: "positive",
    badgeText: "ONAYLI VİOP LONG",
    preset: {
      symbol: "VAKBN",
      direction: "LONG",
      entryPrice: 26.4,
      stopPrice: 25.6,
      target1r: 27.2,
      target2r: 28.0,
      triggered: true,
      gvtOrGkdLevel: 26.4,
      signalLabel: "PU30 + GVT Onaylı Long",
    },
  },
  {
    id: "ASELS_TRAP",
    title: "ASELS Bekle/Tuzak (15dk Tek Başına NU70)",
    subtitle: "Saatlikte uyumsuzluk yokken 15dk NU70 tuzaktır · Öğleden sonra yeni tepe riski",
    badgeTone: "negative",
    badgeText: "⚠️ 15DK TUZAK · İŞLEM AÇMA",
    preset: {
      symbol: "ASELS",
      direction: "SHORT",
      entryPrice: 82.0,
      stopPrice: 84.5,
      target1r: 79.5,
      target2r: 77.0,
      triggered: false,
      fractalPhaseCode: "TUZAK_15DK_YENI_ZIRVE_BEKLENIR",
      gvtOrGkdLevel: 82.0,
      signalLabel: "15dk Tek Başına Tuzak",
    },
  },
];

const STRATEGY_PLAYBOOKS: Array<{
  num: string;
  title: string;
  badge: string;
  tone: "positive" | "warning" | "negative" | "neutral";
  whenToUse: string;
  trigger: string;
  stopAndTarget: string;
  plainTip: string;
  termId: string;
}> = [
  {
    num: "Strateji 1",
    title: "PU30 + Alt Periyot GVT Kırılımı = VİOP Long",
    badge: "YÜKSELİŞ (LONG)",
    tone: "positive",
    whenToUse:
      "Günlük/4S veya Saatlik grafikte katı PU30 (fiyat daha düşük 2. dip yaparken RSI 30 altından 30 üstüne çıkış) oluştuğunda.",
    trigger:
      "Aceleyle dipte alım yapılmaz! Alt zaman diliminde (1G/4S için 1S; 1S için 15dk) Güven Tazeleyen Tepe (GVT) direnci hacimli mum kapanışıyla yukarı kırıldığında Long pozisyon açılır.",
    stopAndTarget:
      "İptal stopu 2. dibin %2,5 altına konur. İlk hedef 1R (maliyeti sıfırlama), ana hedef 2R veya 1-2 itki yapısı kurulduysa %161.8 / %361.8 Fibonacci uzatmasıdır.",
    plainTip:
      "Halk diliyle: Düşen bıçağı havada tutma; önce fiyatın son ara tepeyi (GVT) devirip 'ben döndüm' demesini bekle.",
    termId: "GVT",
  },
  {
    num: "Strateji 2",
    title: "1S + 4S Çoklu NU70 + GKD Kırılımı = VİOP Short (2R Ana Hedef)",
    badge: "ANA DÜŞÜŞ (SHORT 2R)",
    tone: "negative",
    whenToUse:
      "Hem 1 Saatlik (1S) hem de 4 Saatlik (4S) grafikte aynı anda NU70 (fiyat yeni zirve yaparken RSI 70 üstünden 70 altına düşüş) ve Asılan Adam / Kayan Yıldız tepe mumu oluştuğunda.",
    trigger:
      "İki tepe arasındaki en derin çukur olan Güven Kıran Dip (GKD) desteği alt periyotta (15dk/1S) aşağı kırıldığında yakın vade F_<SEMBOL>AAYY kontratında VİOP Short (Satım) açılır.",
    stopAndTarget:
      "İptal stopu 2. tepenin +%2,5 üstüdür. 4S de uyumsuzluğu desteklediği için düşüş dalgası derindir: 1R'de yarısı kapatılıp stop girişe çekilir, kalan kontratla 2R ana hedef beklenir.",
    plainTip:
      "Spot piyasada sadece elindeki hisseyi satabilirsin; VİOP Pay Vadeli'de ise GKD kırıldığında düşüşten doğrudan TL kârı yazarsın.",
    termId: "GKD",
  },
  {
    num: "Strateji 3",
    title: "1S NU70 Var ama 4S NU70 Yok = Kısa 1R Salınım Kâr Al",
    badge: "ARA DÜZELTME (1R KÂR AL)",
    tone: "warning",
    whenToUse:
      "1 Saatlik (1S) grafikte NU70 oluşup 15dk GKD kırıldığında, ancak 4 Saatlik (4S) ana trendde henüz NU70 yorulması görülmediğinde.",
    trigger:
      "15dk GKD kırılımıyla düşük kontrat adediyle taktiksel VİOP Short veya mevcut Long pozisyonda kâr realizasyonu yapılır.",
    stopAndTarget:
      "Stop yine 2. tepenin +%2,5 üstüdür; ancak 4S trend hâlâ yukarı olduğu için 2R beklenmez! 1R hedefinde tam kâr al yapılır çünkü fiyat 1R düzeltmesinden sonra dönüp 4S trend yönünde yeni zirve arayabilir.",
    plainTip:
      "Ana nehir (4S) yukarı akarken gelen saatlik düzeltme sadece kısa bir nefeslenmedir; 1R çorba parasını cebine koy ve çekil.",
    termId: "1R",
  },
  {
    num: "Strateji 4",
    title: "15dk Tek Başına NU70 & Tepkisiz Şelale = İŞLEM AÇMA (Korunma Kuralı)",
    badge: "TUZAK & ŞELALE FİLTRESİ",
    tone: "negative",
    whenToUse:
      "Durum A: Saatlikte hiçbir uyumsuzluk yokken sadece 15dk grafikte görülen NU70. Durum B: RSI < 30 aşırı satıma inmiş ama henüz hiçbir yukarı tepki mumu (has_reaction=false) vermemiş sert şelale düşüşü.",
    trigger:
      "Her iki durumda da VİOP'ta TERS İŞLEM AÇILMAZ! 15dk tek başına NU70 'öğlene kadar düşerim, öğleden sonra dönüp yeni zirve yaparım' tuzağıdır.",
    stopAndTarget:
      "15dk tuzakta öğleden sonra yeni zirve alınıp 1S NU70 doğana kadar Short açılmaz. Aşırı satım şelalesinde ise 1. dip + tepki + RSI > 30 üzerinde 2. dip (En Az 1 Dip Daha kuralı) tamamlanmadan Long girilmez.",
    plainTip:
      "VİOP'ta en büyük kazanç, tuzak sinyalde elini tetikten çekip teminatını korumaktır.",
    termId: "FRAKTAL_15DK_TUZAK",
  },
  {
    num: "Strateji 5",
    title: "Piyasa-Nötr Pair Trading (Güçlü PU30 Long + Zayıf NU70 Short)",
    badge: "PİYASA-NÖTR HEDGE",
    tone: "neutral",
    whenToUse:
      "BIST100 endeksinin yönü belirsiz veya haber akışı oynakken hem güçlü dönüş yapan hem de zirvede yorulan hisseler aynı anda tarayıcıya düştüğünde.",
    trigger:
      "Test Merkezi (/lab) Long/Short Matrisi'nde GVT üstü onaylı en güçlü PU30 hissesinde VİOP Long açılırken, aynı anda GKD altı onaylı en zayıf NU70 hissesinde eşit TL büyüklüğünde VİOP Short açılır.",
    stopAndTarget:
      "Her iki bacağın kendi GVT/GKD iptal stopu bağımsız korunur. Endeks sert düşse bile Short bacak kâr yazar, endeks ralli yapsa Long bacak taşır; iki hisse arasındaki göreceli güç farkından (spread) net getiri hedeflenir.",
    plainTip:
      "Endeks nereye giderse gitsin geceleri rahat uyumak isteyen kurumsal fonların piyasa-nötr korunma yöntemidir.",
    termId: "PAIR_TRADING",
  },
];

const COMMON_MISTAKES: Array<{
  title: string;
  mistake: string;
  solution: string;
  termId: string;
}> = [
  {
    title: "1. Tüm Nakdi Başlangıç Teminatına Bağlamak (Sıfır Serbest Teminat)",
    mistake:
      "100.000 ₺ sermayenin tamamıyla 15–16 kontrat açıp hesapta hiç boş nakit bırakmamak. İlk %2'lik ters harekette gün sonu uzlaşmasında (MTM) teminat sürdürme sınırının altına düşer ve T+1 saat 15:00'e kadar Margin Call (Teminat Tamamlama) doğar.",
    solution:
      "Hesaptaki toplam risk bütçesini işlem başına %1–%2 ile sınırla; serbest teminat tamponun toplam sermayenin en az %50–%65'i olsun.",
    termId: "MARGIN_CALL",
  },
  {
    title: "2. GVT veya GKD Kırılmadan 'Uyumsuzluk Var' Diye Erken Atlamak",
    mistake:
      "Sadece RSI uyumsuzluğu göründü diye alt periyot kırılımını (GVT/GKD) beklemeden pozisyon açmak. Güçlü trendlerde fiyat uyumsuzluğu ezip geçebilir.",
    solution:
      "Uyumsuzluk sadece 'hazırlık' sinyalidir; tetik yalnızca alt periyotta GVT yukarı veya GKD aşağı kırıldığında çekilir.",
    termId: "GVT",
  },
  {
    title: "3. Vade Sonu Son 2–3 İş Gününde Rollover (Vade Taşıma) Unutmak",
    mistake:
      "BIST Pay Vadeli kontratlarını ayın son iş gününe kadar açık bırakmak. Pay Vadeli sözleşmeler nakit değil FİZİKİ TESLİMAT uzlaşmalıdır (Long isen 100 hisse/kontrat nakit bedeli, Short isen takasta gerçek hisse teslim yükümlülüğü ve temerrüt faizi doğar).",
    solution:
      "Vade sonundan 2–3 iş günü önce yakın vade (ör. F_THYAO1126) pozisyonu kapatıp bir sonraki ay kontratına (F_THYAO1226) taşı.",
    termId: "ROLLOVER",
  },
  {
    title: "4. Pay Vadeli'de Akşam Seansı (19:00–23:00) Var Sanmak",
    mistake:
      "Endeks kontratlarında (XU030) akşam seansı olduğu için Pay Vadeli hisse kontratlarını da gece kapatabileceğini düşünmek.",
    solution:
      "Pay Vadeli sözleşmelerde akşam seansı YOKTUR; işlemler yalnızca 09:30–18:10 normal seansta yapılır. Gece küresel risk taşıyorsan 18:10 öncesi pozisyon boyunu ayarla.",
    termId: "VIOP_PAY_VADELI",
  },
  {
    title: "5. Efektif Kaldıracı 4.0x Üzerine Çıkarmak",
    mistake:
      "5x–10x teorik teminat kaldıracını sonuna kadar kullanmak. 5x kaldıraçta hissede %4 ters hareket ana sermayenin %20'sini tek işlemde siler.",
    solution:
      "Efektif kaldıracı (Toplam Pozisyon / Toplam Sermaye) 2.5x altında (GÜVENLİ) tut; 4.0x üstüne (YÜKSEK RİSK) asla çıkma.",
    termId: "EFEKTIF_KALDIRAC",
  },
];

const CATEGORY_FILTERS: Array<{ id: "all" | GlossaryCategory; label: string }> = [
  { id: "all", label: "Tümü" },
  { id: "teknik", label: "Teknik & Uyumsuzluk" },
  { id: "itki", label: "1-2-3 İtki & Fib" },
  { id: "risk", label: "Risk & WFO" },
  { id: "viop", label: "VİOP & Teminat" },
];

export default function ViopRehberPage() {
  const [selectedPresetId, setSelectedPresetId] = useState<string>("THYAO_SHORT");
  const [glossarySearch, setGlossarySearch] = useState<string>("");
  const [glossaryCategory, setGlossaryCategory] = useState<"all" | GlossaryCategory>("all");

  const activePresetObj = useMemo(
    () =>
      BIST_VIOP_PRESETS.find((p) => p.id === selectedPresetId) ??
      BIST_VIOP_PRESETS[0],
    [selectedPresetId]
  );

  const filteredGlossary = useMemo(() => {
    const q = glossarySearch.trim().toLocaleLowerCase("tr-TR");
    return GLOSSARY_LIST.filter((entry) => {
      if (glossaryCategory !== "all" && entry.category !== glossaryCategory) {
        return false;
      }
      if (!q) return true;
      const haystack =
        `${entry.id} ${entry.title} ${entry.plain} ${entry.example}`.toLocaleLowerCase(
          "tr-TR"
        );
      return haystack.includes(q);
    });
  }, [glossarySearch, glossaryCategory]);

  return (
    <WorkspacePage
      eyebrow="REHBER VE EĞİTİM · VİOP & STRATEJİ"
      title="VİOP & Strateji Rehberi"
      description="BIST Pay Vadeli (VİOP) kontrat mekaniklerini, PU30/NU70 + GVT/GKD strateji kurallarını ve stop-öncelikli kontrat/teminat hesabını sade Türkçe ile adım adım öğrenin ve canlı hesaplayın."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/lab" className="rsi-button">
            Test Merkezi (/lab)
          </Link>
          <Link href="/impulse-lab" className="rsi-button">
            İtki & WFO Lab
          </Link>
        </div>
      }
    >
      {/* 3-Step Plain Turkish Orientation Banner */}
      <PlainGuideBanner
        storageKey="viop_rehber_intro"
        title="Bu Rehberi ve VİOP Hesaplayıcıyı 3 Adımda Nasıl Kullanırsın?"
        steps={[
          "1. Adım (Mekanik): Spot hisse ile VİOP Pay Vadeli (1 kontrat = 100 hisse, çift yönlü Long/Short, Takasbank teminat ve vade kuralları) farkını aşağıdaki karşılaştırma tablosundan öğren.",
          "2. Adım (Canlı Hesap): Hazır BIST senaryolarından birini (THYAO Short, VAKBN Long, ASELS 15dk Tuzak) seç veya kendi fiyat/stop değerlerini girerek kaç kontrat açman gerektiğini hesapla.",
          "3. Adım (Strateji & Sözlük): 5 somut strateji oyun planını, en sık yapılan 5 VİOP hatasını ve A'dan Z'ye sade Türkçe teknik sözlüğü inceleyerek işlem disiplinini kur.",
        ]}
        ctaHref="/lab#longshort"
        ctaLabel="Canlı Long/Short Matrisine Git"
      />

      {/* Quick KPI Summary Strip */}
      <div className="workspace-metrics">
        <MetricCard
          label="Kontrat Çarpanı"
          value={`${BIST_STOCK_FUTURES_MULTIPLIER} Adet Pay`}
          detail="1 Pay Vadeli kontrat = 100 spot hisse senedi"
          tone="positive"
        />
        <MetricCard
          label="Takasbank Sürdürme"
          value="%100 Gün Sonu"
          detail="Gün içi %75 erken uyarı · T+1 15:00 Margin Call"
          tone="warning"
        />
        <MetricCard
          label="Seans & Vade Taşıma"
          value="09:30 – 18:10"
          detail="Akşam seansı YOK · Son 2-3 iş günü Rollover"
          tone="neutral"
        />
        <MetricCard
          label="BIST VİOP Evreni"
          value={`${BIST_VIOP_SYMBOLS.size} Pay Vadeli`}
          detail={`${Object.keys(GLOSSARY_TERMS).length} sade Türkçe sözlük terimi`}
          tone="positive"
        />
      </div>

      {/* SECTION 1: Spot vs VİOP Pay Vadeli Comparison Table */}
      <Panel
        id="spot-vs-viop"
        title="1. Spot Hisse vs VİOP Pay Vadeli — Sade Türkçe Karşılaştırma"
        description="Borsa İstanbul Pay Vadeli İşlem Sözleşmeleri ile normal spot hisse alım-satımı arasındaki tüm temel farklar."
      >
        <div className="workspace-table-wrap">
          <table className="workspace-table">
            <thead>
              <tr>
                <th>Özellik</th>
                <th>Spot BIST Hisse (Normal Alım)</th>
                <th>
                  VİOP Pay Vadeli Sözleşme{" "}
                  <TermHint id="VIOP_PAY_VADELI" />
                </th>
                <th>Ne Anlama Gelir? (Sade Türkçe)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Sözleşme Büyüklüğü</strong>{" "}
                  <TermHint id="KONTRAT_100" />
                </td>
                <td>1 Lot = 1 Adet Hisse</td>
                <td>
                  <strong>1 Kontrat = 100 Adet Hisse</strong> (Çarpan = 100)
                </td>
                <td>
                  Hisse fiyatı 300 ₺ ise 1 VİOP kontratı 30.000 ₺ pozisyon büyüklüğü taşır. Fiyat 1 ₺ oynadığında kontrat başına ±100 ₺ kâr/zarar yazar.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>İşlem Yönü (Long / Short)</strong>
                </td>
                <td>Yalnızca Yükseliş (Al-Bekle-Sat)</td>
                <td>
                  <strong>Çift Yönlü:</strong> Yükseliş (Long) &amp; Düşüş (Short)
                </td>
                <td>
                  PU30 + GVT onayında Long (Alım), NU70 + GKD kırılımında ise elinde hisse olmadan doğrudan Short (Satım) açıp düşüşten TL kazanabilirsin.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Başlangıç &amp; Sürdürme Teminatı</strong>{" "}
                  <TermHint id="BASLANGIC_SURDURME_TEMINAT" />
                </td>
                <td>%100 Peşin (30.000 ₺ için 30.000 ₺)</td>
                <td>
                  Yaklaşık <strong>%15 – %25 Başlangıç Teminatı</strong> (Takasbank SPAN)
                </td>
                <td>
                  Takasbank 2017 sonrası resmi gün sonu kuralına göre sürdürme teminatı başlangıcın <strong>%100&apos;üdür</strong>; <strong>%75</strong> eşiği aracı kurum gün içi erken uyarı sınırıdır.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Günlük Uzlaşma (MTM) &amp; Margin Call</strong>{" "}
                  <TermHint id="MARGIN_CALL" />
                </td>
                <td>Satana kadar nakit bakiyen değişmez</td>
                <td>
                  Her gün son 10 dk AOF (VWAP) ile kâr/zarar nakde yansır
                </td>
                <td>
                  Gün sonunda teminatın başlangıç/sürdürme tutarının altına inerse <strong>T+1 saat 15:00&apos;e</strong> (kurumlarda ~14:30) kadar teminat tamamlama çağrısı doğar.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>Kontrat Kodu, Vade &amp; Rollover</strong>{" "}
                  <TermHint id="ROLLOVER" />
                </td>
                <td>Süresiz (Örn: THYAO)</td>
                <td>
                  <code>F_&lt;SEMBOL&gt;AAYY</code> (Örn: <code>F_THYAO1126</code>)
                </td>
                <td>
                  Her ayın son iş günü vade biter ve Pay Vadeli&apos;de <strong>fiziki teslimat</strong> vardır. Teslimata kalmamak için vade sonundan <strong>2–3 iş günü önce</strong> sonraki aya rollover yapılır.
                </td>
              </tr>
              <tr>
                <td>
                  <strong>İşlem Saatleri &amp; Akşam Seansı</strong>
                </td>
                <td>10:00 – 18:00 (Tek fiyat + Sürekli)</td>
                <td>
                  <strong>09:30 – 18:10 Kesintisiz</strong> (Akşam seansı <strong>YOKTUR</strong>)
                </td>
                <td>
                  Endeks kontratlarının aksine Pay Vadeli hisse sözleşmelerinde 19:00–23:00 akşam seansı yapılmaz; emirler 09:30–18:10 arasında iletilir.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      {/* SECTION 2: Interactive ViopCalculator + 3 Live BIST Presets */}
      <Panel
        id="viop-calculator-section"
        title="2. Canlı VİOP Kontrat, Teminat ve Risk Hesaplayıcı"
        description="Önce örnek BIST senaryolarından birini seçin veya kendi sermaye, giriş ve stop fiyatınızı girin. Sistem stop mesafesine göre güvenli kontrat adedini aşağı yuvarlayarak hesaplar."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Hazır BIST Senaryoları:
            </span>
            {BIST_VIOP_PRESETS.map((item) => {
              const active = item.id === selectedPresetId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedPresetId(item.id)}
                  aria-pressed={active}
                  className={`rounded-xl border px-3.5 py-2 text-left text-xs transition-all ${
                    active
                      ? "border-[#69ddbb] bg-[#152d27] text-white shadow-md"
                      : "border-[#2e4057] bg-[#0e1723] text-slate-300 hover:border-[#69ddbb]/60"
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold">
                    <span>{item.title}</span>
                    <StatusBadge tone={item.badgeTone}>
                      {item.badgeText}
                    </StatusBadge>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {item.subtitle}
                  </div>
                </button>
              );
            })}
          </div>

          <ViopCalculator initialPreset={activePresetObj.preset} />
        </div>
      </Panel>

      {/* SECTION 3: 5 Concrete VİOP Strategy Playbooks */}
      <Panel
        id="viop-playbooks"
        title="3. Sistemin 5 Somut VİOP Strateji Oyun Planı (Playbook)"
        description="Sistemdeki PU30, NU70, GVT/GKD ve 15dk tuzak kurallarının VİOP Pay Vadeli kontratlarında adım adım uygulanışı."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {STRATEGY_PLAYBOOKS.map((pb) => (
            <article
              key={pb.num}
              className="flex flex-col justify-between rounded-xl border border-[#29384b] bg-[#0e1723] p-4 space-y-3"
            >
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-[#182738] px-2 py-0.5 font-mono text-xs font-bold text-[#7de4c7]">
                      {pb.num}
                    </span>
                    <strong className="text-sm font-bold text-[#eaf0f6]">
                      {pb.title}
                    </strong>
                    <TermHint id={pb.termId} />
                  </div>
                  <StatusBadge tone={pb.tone}>{pb.badge}</StatusBadge>
                </div>

                <div className="space-y-1.5 text-xs text-slate-300 leading-relaxed">
                  <p>
                    <strong className="text-slate-100">Ne Zaman Aranır?</strong>{" "}
                    {pb.whenToUse}
                  </p>
                  <p>
                    <strong className="text-[#7de4c7]">Giriş Tetiği:</strong>{" "}
                    {pb.trigger}
                  </p>
                  <p>
                    <strong className="text-amber-200">
                      Stop &amp; Kâr Hedefi:
                    </strong>{" "}
                    {pb.stopAndTarget}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-[#26384d] bg-[#111c2a] px-3 py-2 text-xs text-[#b7cde2]">
                <strong>💡 Sade Türkçe Özeti:</strong> {pb.plainTip}
              </div>
            </article>
          ))}
        </div>
      </Panel>

      {/* SECTION 4: 5 Common VİOP Mistakes & Safety Checklist */}
      <Panel
        id="viop-mistakes-checklist"
        title="4. VİOP'ta En Sık Yapılan 5 Hata ve Güvenlik Kontrol Listesi"
        description="Emir göndermeden önce teminat sıfırlanmasını ve fiziki teslimat sürprizlerini önleyen 5 altın kontrol maddesi."
      >
        <div className="space-y-3">
          {COMMON_MISTAKES.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-[#29384b] bg-[#0e1723] p-4 space-y-1.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm font-bold text-[#eaf0f6]">
                  {item.title}
                </strong>
                <TermHint id={item.termId} />
              </div>
              <p className="text-xs text-rose-200/95 leading-relaxed">
                <strong>❌ Yanlış Uygulama:</strong> {item.mistake}
              </p>
              <p className="text-xs text-emerald-200/95 leading-relaxed">
                <strong>✅ Doğru Kural:</strong> {item.solution}
              </p>
            </div>
          ))}
        </div>
      </Panel>

      {/* SECTION 5: Searchable A-Z Plain-Turkish Glossary */}
      <Panel
        id="plain-turkish-glossary"
        title={`5. A'dan Z'ye Sade Türkçe Teknik & VİOP Sözlük (${GLOSSARY_LIST.length} Terim)`}
        description="Platformdaki tüm kısaltmaların (PU30, NU70, GVT, GKD, 1R/2R, WFO, Rollover, Margin Call) normal bir insanın anlayacağı dilde açıklaması ve BIST örnekleri."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {CATEGORY_FILTERS.map((cat) => {
                const active = glossaryCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setGlossaryCategory(cat.id)}
                    aria-pressed={active}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? "border-[#69ddbb] bg-[#152d27] text-[#7de4c7]"
                        : "border-[#2e4057] bg-[#0e1723] text-slate-300 hover:border-[#69ddbb]/50"
                    }`}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>

            <div className="w-full sm:w-72">
              <input
                type="search"
                value={glossarySearch}
                onChange={(e) => setGlossarySearch(e.target.value)}
                placeholder="Sözlükte ara (ör. GVT, Kaldıraç, Rollover)..."
                aria-label="Sözlükte terim ara"
                className="w-full rounded-lg border border-[#34475e] bg-[#0b1420] px-3 py-2 text-xs text-[#dbe6f3] focus:border-[#69ddbb] focus:outline-none"
              />
            </div>
          </div>

          {filteredGlossary.length === 0 ? (
            <div className="rounded-xl border border-[#29384b] bg-[#0e1723] p-6 text-center text-xs text-slate-400">
              Aradığınız ifadeye uygun sözlük terimi bulunamadı. Filtreyi sıfırlayarak tüm terimleri görebilirsiniz.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredGlossary.map((entry) => (
                <article
                  key={entry.id}
                  data-glossary-card
                  data-term-id={entry.id}
                  className="flex flex-col justify-between rounded-xl border border-[#29384b] bg-[#0e1723] p-3.5 space-y-2"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <strong className="text-xs font-bold text-[#eaf0f6]">
                        {entry.title}
                      </strong>
                      <span className="rounded border border-[#324861] bg-[#121e2c] px-1.5 py-0.5 font-mono text-[10px] text-[#7de4c7]">
                        {entry.category.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {entry.plain}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[#223246] bg-[#111b28] px-2.5 py-1.5 text-[11px] text-[#9dc4db]">
                    <strong>Örnek:</strong> {entry.example}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </WorkspacePage>
  );
}
