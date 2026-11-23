export type GlossaryCategory = "teknik" | "itki" | "risk" | "viop";

export interface GlossaryEntry {
  id: string;
  title: string;
  plain: string;
  example: string;
  category: GlossaryCategory;
}

export const GLOSSARY_TERMS: Record<string, GlossaryEntry> = {
  PU30: {
    id: "PU30",
    title: "PU30 (Pozitif Uyumsuzluk)",
    plain:
      "Fiyat daha düşük bir 2. dip yaparken RSI göstergesinin 30 altından 30 üstüne çıkmasıdır. Satıcıların gücünü kaybettiğini ve dönüş ihtimalinin arttığını anlatır.",
    example: "1. dip 98 ₺ (RSI 25) → 2. dip 96 ₺ (RSI 34) ise katı PU30 oluşur.",
    category: "teknik",
  },
  NU70: {
    id: "NU70",
    title: "NU70 (Negatif Uyumsuzluk)",
    plain:
      "Fiyat yeni zirve yaparken RSI göstergesinin 70 üstünden 70 altına gerilemesidir. Yükseliş sürse bile alıcı iştahının zayıfladığına işaret eder.",
    example: "THYAO 330 ₺ (RSI 76) → 336 ₺ (RSI 64) olduğunda NU70 oluşur.",
    category: "teknik",
  },
  NU70_ADAY: {
    id: "NU70_ADAY",
    title: "NU70_ADAY (Erken Tepe İzleme)",
    plain:
      "Fiyat yeni zirve yaparken RSI düşüşü görülen ancak %3 geri çekilme veya 5 bar mesafe gibi katı şartları henüz tamamlamamış erken uyarı adayıdır.",
    example: "PGSUS yeni tepede RSI 66; kesin satış için GKD kırılımı beklenir.",
    category: "teknik",
  },
  GVT: {
    id: "GVT",
    title: "GVT (Güven Tazeleyen Direnç)",
    plain:
      "PU30 sinyali sonrası alt zaman diliminde (1G/4S için 1S; 1S için 15dk) yukarı kırılması gereken alım teyit eşiğidir. Kırılmadan işlem erken sayılır.",
    example: "VAKBN 26,40 ₺ GVT üstü saatlik kapanışta alım onaylanır.",
    category: "teknik",
  },
  GKD: {
    id: "GKD",
    title: "GKD (Güven Kıran Dip)",
    plain:
      "NU70 sinyali sonrası alt zaman diliminde (1G/4S için 1S; 1S için 15dk) aşağı kırılması gereken satış veya VİOP short teyit desteğidir.",
    example: "THYAO 325,75 ₺ GKD altında kapanış gelirse VİOP short teyitlenir.",
    category: "teknik",
  },
  ASILAN_ADAM: {
    id: "ASILAN_ADAM",
    title: "Asılan Adam (Hanging Man)",
    plain:
      "Yükseliş zirvesinde küçük gövde ve uzun alt fitille oluşan yorulma mumudur. NU70 ile aynı tepede görülürse dönüş olasılığını güçlendirir.",
    example: "Zirvede uzun alt fitil sonrası gelen kırmızı kapanış mumu teyit verir.",
    category: "teknik",
  },
  KAYAN_YILDIZ: {
    id: "KAYAN_YILDIZ",
    title: "Kayan Yıldız (Shooting Star)",
    plain:
      "Zirvede yukarı sert fitil atıp kapanışa doğru aşağıda kalan, alıcıların yukarıda reddedildiğini gösteren dönüş mumudur.",
    example: "Sabah sert yükseliş sonrası gün sonu gövdesi dipte kapanan tepe mumu.",
    category: "teknik",
  },
  FRAKTAL_15DK_TUZAK: {
    id: "FRAKTAL_15DK_TUZAK",
    title: "15dk Tek Başına Tuzak",
    plain:
      "Saatlikte (1S) uyumsuzluk yokken yalnızca 15 dakikalıkta görülen NU70 tuzaktır: öğlene kadar düşüp öğleden sonra yeni zirve yapabilir; asıl satış 1S NU70 doğunca başlar.",
    example: "15dk NU70 sonrası öğleden sonra gelen yeni zirve 1S NU70 ile gerçek satışı başlatır.",
    category: "teknik",
  },
  EN_AZ_1_DIP_DAHA: {
    id: "EN_AZ_1_DIP_DAHA",
    title: "En Az 1 Dip Daha Kuralı",
    plain:
      "RSI 30 altına indikten sonra ilk tepki gelse bile henüz RSI > 30 üzerinde 2. dip (PU30) kurulmadıysa fiyatın en az 1 dip daha yapmasını bekleme kuralıdır.",
    example: "ASELS 15dk ilk sıçramada acele etmek yerine 2. dip ve GVT kırılımı beklenir.",
    category: "teknik",
  },
  KNOWABLE_AT: {
    id: "KNOWABLE_AT",
    title: "Bilinebilir Zaman (knowable_at)",
    plain:
      "Bir sinyalin yalnızca mum kapandıktan sonra canlı ekranda gerçekten görülebildiği ilk andır. Geçmiş testlerde geleceği görme (look-ahead) hatasını engeller.",
    example: "14:00–15:00 saatlik barının sinyali 15:00 kapanışında bilinir olur.",
    category: "teknik",
  },
  T0_T1_T2: {
    id: "T0_T1_T2",
    title: "t0 / t1 / t2 İtki Çapaları",
    plain:
      "t0 sinyalin başladığı 2. dip/tepe noktasını, t1 ilk güçlü dalganın (W1) bittiği ucu, t2 ise düzeltmenin (W2) tamamlanıp 3. dalga zaman sayacının başladığı noktayı gösterir.",
    example: "100 ₺ (t0) → 112 ₺ (t1) → 105 ₺ (t2) üçlüsü 1-2 yapısını kurar.",
    category: "itki",
  },
  W1_W2_W3: {
    id: "W1_W2_W3",
    title: "W1 / W2 / W3 İtki Dalgaları",
    plain:
      "W1 ilk yön değiştirici dalgadır, W2 ana başlangıç noktasını bozmadan yapılan düzeltmedir, W3 ise W1 zirvesinin kırılmasıyla hızlanan ana trend dalgasıdır.",
    example: "W1 tepesi hacimle geçildiğinde W3 ana ralli fazı başlar.",
    category: "itki",
  },
  T2_TEYIDI: {
    id: "T2_TEYIDI",
    title: "t2 Teyidi vs W1 Kırılımı",
    plain:
      "t2 Teyidi düzeltme dönüşünde daha erken ama riskli girişi, W1 Kırılımı ise 1. dalga ucu geçilince gelen daha güvenli onaylı girişi ifade eder.",
    example: "t2 girişi stopu yakın tutar; W1 kırılımı başarı oranını yükseltir.",
    category: "itki",
  },
  FIB_1618: {
    id: "FIB_1618",
    title: "Fib 1.618 (%161.8 Hedefi)",
    plain:
      "1. dalga boyunun 1,618 katının düzeltme noktası (t2) üzerinden projeksiyonuyla bulunan ilk ana 3. dalga fiyat hedefidir.",
    example: "W1 = 10 ₺ ve t2 = 105 ₺ ise lineer %161.8 hedefi 121,18 ₺ olur.",
    category: "itki",
  },
  FIB_3618: {
    id: "FIB_3618",
    title: "Fib 3.618 (%361.8 Arkana Yaslan)",
    plain:
      "Güçlü 1-2 yapılarında 1. dalga boyunun 3,618 katına uzanan büyük ralli hedefidir. Geniş vade trend takibinde ana hedef bölgesi olarak izlenir.",
    example: "Günlük PU30 sonrası kurulan 1-2 yapısında %361.8 tam trend hedefidir.",
    category: "itki",
  },
  FIB_ZAMAN_MOD_A: {
    id: "FIB_ZAMAN_MOD_A",
    title: "Fib Zaman Mod A (W1-Bazlı)",
    plain:
      "1. dalganın süresini (Δt1 bar sayısı) Fibonacci oranlarıyla (0.382–3.618) çarpıp t2 anına ekleyerek olası hedef zaman penceresini hesaplar.",
    example: "W1 = 10 bar sürdüyse 1.618 zaman penceresi t2 + 16 bar sonrasıdır.",
    category: "itki",
  },
  FIB_ZAMAN_MOD_B: {
    id: "FIB_ZAMAN_MOD_B",
    title: "Fib Zaman Mod B (0–2 Sündürme)",
    plain:
      "t0 ile t2 arasındaki toplam süreyi (Δt02) Fibonacci oranlarıyla ileri taşıyarak alternatif dönüş veya hedef zaman penceresini tahmin eder.",
    example: "t0 → t2 toplam 20 bar sürdüyse 0.618 projeksiyonu +12 bar sonrasını verir.",
    category: "itki",
  },
  LINEER_LOG: {
    id: "LINEER_LOG",
    title: "Lineer vs Logaritmik Ölçek",
    plain:
      "Lineer ölçek mutlak TL farkıyla (ör. +10 ₺), Logaritmik ölçek ise yüzdesel katlarla (ör. +%10) hedef hesaplar. Büyük fiyat hareketlerinde Log ölçek daha gerçekçidir.",
    example: "20 ₺'den 40 ₺'ye %100 çıkışta Log projeksiyon orantılı hedef üretir.",
    category: "itki",
  },
  A_PLUS_IDEAL_12: {
    id: "A_PLUS_IDEAL_12",
    title: "A+ İdeal 1-2 Yapısı",
    plain:
      "2. dalga düzeltmesinin 1. dalga boyunun %38.2 ile %78.6 altın geri çekilme bandı içinde kaldığı en temiz ve dengeli itki kurulumudur.",
    example: "10 ₺'lik ilk dalgadan sonra 6,18 ₺ geri çekilen W2 düzeltmesi A+ kalitededir.",
    category: "itki",
  },
  "1R": {
    id: "1R",
    title: "1R Hedefi (Kısa Kâr Al)",
    plain:
      "Giriş ile iptal stopu arasındaki risk mesafesine (1R) birebir eşit kâr hedefidir. Özellikle ara salınımlarda ilk kâr alma veya maliyet çekme noktasıdır.",
    example: "Risk 5 ₺ ise girişten 5 ₺ lehine hareket 1R hedefidir.",
    category: "risk",
  },
  "2R": {
    id: "2R",
    title: "2R Ana Hedef (TP1)",
    plain:
      "Göze alınan stop riskinin 2 katı (2R) ana kâr hedefidir. Başarılı olduğunda kayıpları telafi etmeyi kolaylaştıran 1'e 2 getiri sunar.",
    example: "Stop mesafesi 4 ₺ ise 2R hedefi 8 ₺ fiyat hareketidir.",
    category: "risk",
  },
  RR: {
    id: "RR",
    title: "R:R Oranı (Ödül / Risk)",
    plain:
      "Potansiyel kârın olası stop zararına oranıdır. Sağlıklı bir işlem planında en az 2.0x (1 riske karşı 2 ödül) hedeflenir.",
    example: "2.000 ₺ riske karşı 4.000 ₺ hedef = 2.0x R:R oranı.",
    category: "risk",
  },
  STOP_LOSS: {
    id: "STOP_LOSS",
    title: "İptal Stopu (Stop-Loss)",
    plain:
      "Analiz senaryosunun bozulduğu kabul edilen ve daha büyük zararı önlemek için pozisyondan çıkılan kesin fiyat sınırıdır.",
    example: "NU70 short işlemde 2. tepenin +%2,5 üstü iptal stopudur.",
    category: "risk",
  },
  WFO_OOS_FOLD: {
    id: "WFO_OOS_FOLD",
    title: "Walk-Forward (WFO) & OOS Fold",
    plain:
      "Geçmiş veriyi ardışık eğitim ve görülmemiş test (Out-of-Sample) dilimlerine bölerek stratejinin ezber değil gerçek performans üretip üretmediğini ölçer.",
    example: "4 ayrı zaman diliminde (Fold) sıfır veri sızıntısıyla yapılan test.",
    category: "risk",
  },
  PROFIT_FACTOR: {
    id: "PROFIT_FACTOR",
    title: "Profit Factor (Kâr Faktörü)",
    plain:
      "Tüm kârlı işlemlerin toplam kazancının, tüm zararlı işlemlerin toplam kaybına oranıdır. 1.0 üstü kârlı, 1.5 ve üzeri güçlü kabul edilir.",
    example: "15.000 ₺ toplam kâr / 10.000 ₺ toplam zarar = 1.50 Profit Factor.",
    category: "risk",
  },
  NET_EV: {
    id: "NET_EV",
    title: "Net EV (Beklenen Değer)",
    plain:
      "Komisyon ve fiyat kayması (slippage) düşüldükten sonra uzun vadede işlem başına beklenen ortalama net getiridir.",
    example: "+%0,85 Net EV, yüzlerce işlemde sermayenin istikrarlı büyümesine işaret eder.",
    category: "risk",
  },
  VIOP_PAY_VADELI: {
    id: "VIOP_PAY_VADELI",
    title: "VİOP Pay Vadeli (F_<HISSE>AAYY)",
    plain:
      "BIST hisselerinin gelecek vade sonundaki fiyatı üzerine açılan, hem yükselişe (Long) hem düşüşe (Short) işlem yapılabilen vadeli sözleşmedir. Akşam seansı yoktur (09:30–18:10).",
    example: "F_THYAO1126 kodu Kasım 2026 vadeli THYAO Pay Vadeli sözleşmesini gösterir.",
    category: "viop",
  },
  KONTRAT_100: {
    id: "KONTRAT_100",
    title: "1 Kontrat = 100 Hisse",
    plain:
      "BIST Pay Vadeli piyasasında 1 adet sözleşmenin standart olarak 100 adet spot hisseye denk gelmesidir. Fiyat 1 ₺ değiştiğinde 1 kontratta 100 ₺ kâr veya zarar yazılır.",
    example: "Hisse 300 ₺ iken 1 kontrat 30.000 ₺ pozisyon büyüklüğü taşır.",
    category: "viop",
  },
  BASLANGIC_SURDURME_TEMINAT: {
    id: "BASLANGIC_SURDURME_TEMINAT",
    title: "Başlangıç & Sürdürme Teminatı",
    plain:
      "Başlangıç teminatı pozisyon açmak için bloke edilen paradır. Takasbank'ın 2017 sonrası resmi gün sonu kuralına göre sürdürme teminatı başlangıcın %100'üdür; %75 oranı gün içi erken uyarı eşiğidir.",
    example: "30.000 ₺ kontratta %20 başlangıç = 6.000 ₺ teminat, %75 uyarı = 4.500 ₺.",
    category: "viop",
  },
  MARGIN_CALL: {
    id: "MARGIN_CALL",
    title: "Teminat Tamamlama (Margin Call)",
    plain:
      "Gün sonu uzlaşması (son 10 dk AOF) sonrasında teminatınız sürdürme sınırının altına düşerse T+1 saat 15:00'e kadar ek nakit yatırmanız istenir; tamamlanmazsa pozisyon resen kapatılır.",
    example: "6.000 ₺ teminat zarar sonrası 4.800 ₺'ye inerse 1.200 ₺ tamamlama çağrısı doğar.",
    category: "viop",
  },
  EFEKTIF_KALDIRAC: {
    id: "EFEKTIF_KALDIRAC",
    title: "Efektif Kaldıraç",
    plain:
      "Açtığınız toplam pozisyon büyüklüğünün hesabınızdaki toplam sermayeye oranıdır (Pozisyon / Sermaye). 2.5x altı güvenli, 2.5x–4.0x orta, 4.0x üstü yüksek risklidir.",
    example: "100.000 ₺ hesapta 240.000 ₺ pozisyon açmak 2,4x efektif kaldıraç demektir.",
    category: "viop",
  },
  ROLLOVER: {
    id: "ROLLOVER",
    title: "Rollover (Vade Taşıma) & Teslimat",
    plain:
      "Pay Vadeli sözleşmeler vade sonu iş gününde fiziki hisse teslimatına gider (Long nakit, Short hisse temerrüt riski). Bu yüzden son 2–3 iş gününde yakın vade kapatılıp sonraki aya taşınır.",
    example: "Ayın 27'sinde F_THYAO1126 kapatılıp F_THYAO1226 kontratına geçilmesi.",
    category: "viop",
  },
  PAIR_TRADING: {
    id: "PAIR_TRADING",
    title: "Pair Trading (Piyasa-Nötr Hedge)",
    plain:
      "Aynı anda güçlü PU30 hissede Long ve zayıf NU70 hissede VİOP Short pozisyon açarak genel borsa düşüş veya yükseliş riskini dengeleme stratejisidir.",
    example: "Endeks belirsizken güçlü VAKBN Long + zayıf THYAO Short eşleşmesi kurmak.",
    category: "viop",
  },
};

export const GLOSSARY_LIST: GlossaryEntry[] = Object.values(GLOSSARY_TERMS);

export function getGlossaryEntry(id: string): GlossaryEntry | undefined {
  if (typeof id !== "string") return undefined;
  const key = id.trim();
  if (!key) return undefined;
  if (Object.prototype.hasOwnProperty.call(GLOSSARY_TERMS, key)) {
    return GLOSSARY_TERMS[key];
  }
  const upperKey = key.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(GLOSSARY_TERMS, upperKey)) {
    return GLOSSARY_TERMS[upperKey];
  }
  return undefined;
}
