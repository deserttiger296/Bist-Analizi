# 📊 SME QP Analiz Motoru - Geliştirme ve Analiz Raporu

**Proje Adı:** BIST Analyst - SME QP Analiz Motoru
**Tarih:** 04.06.2026
**Mimar:** Antigravity AI (FinTech Systems Architect)

Bu rapor, Semih Murat Ersoy'a (SME) ait mekanik ticaret kurallarının, projeye dijital ve otonom bir kuant (quant) motoru olarak nasıl entegre edildiğini özetlemektedir.

---

## 1. Sistemin Temel Amacı ve Konumlandırması
SME QP Analiz Motoru, ana sistemdeki 22-parametreli karmaşık "Confluence (Kesişim) Motorundan" **tamamen bağımsız** bir yapı olarak kurgulanmıştır. Amacı; piyasadaki gürültüyü filtreleyerek, yalnızca katı Fibonacci ve Pozitif Uyumsuzluk (PU) matematiksel kurallarına uyan hisselerde mekanik ve duygusuz işlem (trade) sinyalleri üretmektir.

Sistem, `http://localhost:3000/qp` adresinde çalışan özel, cam efektli (glassmorphism) ve koyu temalı bir Frontend Dashboard'una sahip olacak şekilde inşa edilmiştir.

---

## 2. Entegre Edilen Algoritmik Kurallar (Faz 1 Tamamlandı)

Yazılımın çekirdeğine (`src/lib/quant/qpStrategy.ts`) aşağıdaki kurallar tavizsiz bir şekilde if-else döngülerine çevrilerek eklenmiştir:

### A. Haftalık Periyot ve Sınır Kuralı
* Sistem yalnızca Yahoo Finance v8 API üzerinden çekilen **Haftalık (1W) OHLC** verilerini kabul etmektedir.
* **Katı Sınır:** Haftalık RSI(14) verisinde dip noktası mutlaka **30 referans çizgisinin üzerinde** olmalıdır. 30'un altındaki RSI dipleri sistem tarafından "Geçersiz PU" sayılarak reddedilmektedir.

### B. Güven Veren Tepe (GVT) ve Ana Dip Tespiti
* Fiyat grafiğinde "Ana Zirve" (%100 noktası) tespiti için sadece en yüksek rakam aranmaz. Özel bir `pivothigh(8, 8)` fonksiyonu ile sağında ve solunda 8 haftalık onay almış, gerçek ve **Güven Veren Tepe (GVT)** yapıları tespit edilir.
* Matematiksel Fibo Cetveli, bu onaylı GVT noktasından, PU'nun başladığı "Ana Dip" (%0) noktasına çekilir.

### C. Tetikleyiciler ve İndikatör Körlüğü
* **Net PU Beklememe Kuralı:** Sistem, fiyatta düşen dip ve RSI'da yükselen dip oluştuğunu onayladığı an, fiyatın %23.6 seviyesini kırmasını beklemez. Direkt olarak **AKTİF** fazına geçer.
* **İndikatör Körlüğü:** İşlem aktif olduktan sonra tüm osilatörler göz ardı edilir ve risk/hedef yönetimi tamamen Fibonacci seviyelerine bırakılır.

### D. Çıkış ve Mega Ralli
* **Kar Al:** Fiyat **%78.6** seviyesine ulaştığında "Mutlak Dönüş" beklentisiyle pozisyon realize uyarısı verilir.
* **MEGA RALLİ:** Fiyat eğer %100 seviyesini (Güven Veren Tepeyi) kırarsa, sistem anında **MEGA RALLİ** durumuna geçer ve arayüzde özel fuşya/neon renklerle "Asla Kaçırılmamalı" uyarısı verir.

---

## 3. Yol Haritası ve Planlanan Yeni Faz (Rölatif Güç / Alfa)

Sisteme çok yakında **"Hisse/XU100 Parite Analizi"** eklenecektir. Bu analiz, yukarıdaki mekanik kurallara ek olarak şu Alfa (Alpha) yeteneklerini kazandıracaktır:

1. **Güçlü Alfa Tespiti:** Hisse/Endeks oran grafiğinde Haftalık RSI "Yükselen Dipler" yapıyorsa, endeks düşerken dahi hissenin elde tutulmasını (KORU) ve endeks döndüğünde ilk alınacak hisse olmasını sağlayacaktır.
2. **Dikey Aşağı Kırılım (Rölatif Sat):** Hisse, kendi başına yükseliyor gibi görünse de endeks rasyosu "Dikey Aşağı Kırılım" yaparsa, sistem "Sektör Değiştir / Pozisyon Azalt" uyarısı vererek gizli para çıkışlarını yakalayacaktır.

---

## 4. Sonuç

**SME QP Analiz Motoru**, hem anlık verilerle API üzerinden hisse sorgulayabilen yüksek performanslı bir backend'e, hem de göz yormayan, fütüristik bir kullanıcı arayüzüne kavuşmuştur. Yeni eklenecek "Rölatif Güç" modülüyle birlikte, Türkiye'deki bireysel algoritmik ticaret sistemleri arasında en katı, mekanik ve güvenilir yapı taşı olacaktır.
