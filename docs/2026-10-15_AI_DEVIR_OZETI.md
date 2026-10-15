# 15 Ekim 2026 — BIST RSI PU30 projesi, başka AI için devir özeti

## Kullanıcının esas isteği
Çalışan orijinal siyah Quantum Sniper RSI PU30/NU70 ekranı ve klasik motor korunacak. Deneysel MTF strateji ayrı sayfa ve ayrı API ile çalışacak. Eski mavi Next.js/MOSTRSI kart ekranı bizim klasik RSI PU ekranımız değildir. Yeni değişiklikleri klasik motora taşımayın.

## Yetkili ekranlar ve yönlendirme
- Üretim: https://bist-analizi-five.vercel.app
- Klasik: `/index.html#rsipu30`. Sayfa hashesiz açıldığında da RSI PU30 seçilir. Periyotlar 1S, 4S, 1G; orijinal tarama, kartlar ve grafik modali korunur.
- Test: `/mtf-lab.html`. Üç evre filtresi, ayrı tarama/tek hisse formu, kendi DOM ve JavaScript dosyası vardır. Tarama kullanıcı düğmesiyle başlar.
- `/` zaten `/index.html` adresine yönlenir. “Ana uygulamaya dön” `/` adresine gider.
- `/rsi-pu30` eski MOSTRSI sayfasını açıyordu; isim RSI olmasına rağmen `getMostRsiScan("1h")` çağrılıyordu. `next.config.ts` artık bunu `/index.html#rsipu30` adresine yönlendirir. `/rsi-pu30/:symbol` klasik ekrana sembol sorgusuyla gider ve orijinal grafik modali açılır.
- Klasik yalnız `app.js`, laboratuvar yalnız `mtf-lab.js` yükler. Ortak sayfa bağlantıları `strategy-pages.css`; laboratuvar stilleri kendi container'ına sınırlıdır. Aynı sayfada tab yapısı kaldırılmıştır.

Haberler ve Geçmiş Testler menüleri başka Next.js arayüzüne gidiyordu; orijinal menüden çıkarıldı. `/news` ve `/backtest` eski adresleri de orijinal ana ekrana yönlenir. Önceki haber kaynağı sabit demo örnekler içeriyordu; eski test sayfasının çağırdığı backtest endpoint'i projede yoktu. Bu iki özelliğin çalıştığı iddia edilmez ve örnek veri orijinal sisteme taşınmaz. Eski kaynaklar silinmedi; ileride gerçek bağlantılar kurulacaksa orijinal siyah arayüz içinde ayrıca geliştirilmeli.

## Klasik sınırı
`python_bot/engine/signals/rsi_pu30.py`, `python_bot/engine/data/provider.py`, `python_bot/signal_api.py`, `src/lib/rsiPu30Engine.ts` Git HEAD'deki MTF öncesi sürümleriyle normalleştirilmiş içerik karşılaştırmasında aynıdır. `scan_universe_rsi_pu30` ve `get_symbol_chart_data` dönüşleri ve lokal Fibonacci davranışı değişmez. Klasik motor laboratuvarı çağırmaz. Lab modülü yalnız laboratuvar isteğinde lazy import edilir.

## Ayrı API ve dosyalar
- Klasik: `/api/scan/rsi-pu30`, `/api/scan/rsi-pu30/{symbol}`.
- Lab: `/api/mtf-lab`, `/api/mtf-lab/{symbol}`; sınırlı tarama `?symbols=ISCTR,BAGFS`.
- Python: `python_bot/engine/signals/pu30_mtf.py`, `python_bot/mtf_lab_api.py`.
- Next proxy: `src/app/api/mtf-lab/route.ts`, `[symbol]/route.ts`.
- Router, Vercel lite `api/index.py` ve tam `python_bot/main_api.py` içine eklenmiştir. Yerel FastAPI de iki HTML sayfasını sunar.
- Lab endpoint'leri no-store; klasik yanıt şemasına MTF alanı eklenmez.

## MTF kararları
1S, aynı 1S snapshot'ından BIST seansına göre türetilen 4S ve günlük analiz edilir. Son açık mumlar iptal kontrolüne dahildir. Veri eksik/gecikmişken olumlu karar üretilmez.
- 4S ikinci dip sonrası 1S/4S low bu dibi kırarsa veya 4S RSI tekrar 30 altına düşerse 4S PU iptal edilir. Pivot sağ onayı beklenmez.
- EARLY_REACTION: günlük sağlam + geçerli 1S PU + geçerli 4S PU yok. Ana alım değildir.
- FULL_CONFIRMATION: günlük sağlam + geçerli 4S PU + iki dip arası direnç üzerinde kapanış + güncel fiyat da direnç üstünde. Sadece anlık iğne yeterli değildir. Matris ayrıca geçmiş saatlik tepki olayını zorunlu kılmaz.
- Makro Fibonacci yalnız tam onayda hesaplanır. Dip1 öncesindeki teyitli ana tepe, dip2'ye kadar son 100 bar içinde aranır; dip2 low üzerinden 0.382/0.50/0.618 hedefleri çıkar. Uygun tepe yoksa seviye uydurulmaz. Hedef fiyatın gerçekleşmesi garanti değildir.
- WAITING_CONFIRMATION, DAILY_VETO, DATA_UNAVAILABLE ayrı tanılardır; üç evreye zorla atanmaz. Bunlar lab'da açılır tanı alanında gerekçeleriyle görülebilir.

## Alt periyot NU / MOST
Yalnız laboratuvar 15m veri çeker. 15m ve 1h kapanmış barlarında teyitli fiyat HH + RSI LH, alt periyot NU baskısıdır; bunun için RSI70 şartı aranmaz. Son 2/3 alçalan RSI tepesinden regresyon çizgisi kurulur; uygun RSI pivotu yoksa NU fiyat pivotlarındaki RSI çiftine başvurulur. RSI trend kırılımı kapalı barla teyit edilir. İki periyotta baskı varsa yalnız birinin kırması diğerini temizlemez.
`calc_most`: fiyat EMA9 (adjust=False), %1.1 takip stopu. Bu, eski MOSTRSI 14/VAR5/%9 sistemi değildir. Son açık fiyatla MOST değerleri geçici gösterilir; ilk 9 bar olmadan hazır sayılmaz. 4S/günlük uyumu yokken alt periyot NU çözülmemişse LOWER_TF_NU_PRESSURE olur. Günlük veri UNKNOWN ise bu kırmızı kategoriyle veri eksikliği örtülmez.

## Son günlük mantık düzeltmesi
`daily_structure`: fiyat son teyitli günlük destek altına inse bile sağında iki kapanmış günlük mum beklenmez. Son canlı günlük RSI > destek pivotundaki RSI ve >=30 ise `INTACT`, `source/support_source=DAILY_FORMING_PU` döner. Bu sadece adaydır; `valid_pu30` teyidi uydurulmaz. RSI <= önceki dip RSI veya <30 ise BROKEN; bağımsız NU70 veto koşulu korunur. Önceki dip RSI hesaplanamıyorsa UNKNOWN.
BAGFS gerçek veri kontrolü: 1S PU=True, 4S PU=False, günlük INTACT/DAILY_FORMING_PU, sonuç EARLY_REACTION. Destek yaklaşık21.12, son low20.88, dip RSI29.124, güncel günlük RSI31.355. Bunlar kontrol anı değerleridir, sabit kodlanmamıştır.
Kart ve detayda 1S/4S PU, günlük durum/kaynak, güncel ve eski dip RSI, destek, son low ve açık gerekçe görünür.

## Önceki sistem düzeltmeleri / kaynak sınırı
Bu çalışma oturumundaki önceki sistem incelemesinde gezinme, Back/Forward, Escape ve modal dışına tıklayarak kapatma davranışları düzeltilmişti. FinBERT yükleme geri dönüşü, doğrulanmamış ML için shadow davranışı ve sabit kur kullanımına ilişkin düzeltmeler çalışma ağacında korunur. Kullanıcının `scripts/extract_semih_messages.py` dosyasını silmeyin.
Semih Hoca'ya atfedilen kullanıcı mesajları incelendi; `docs/SEMIH_KAYNAK_KURALLAR.md` kaynak/yorum ayrımını kaydeder. Doğrudan yayınla doğrulanmamış alıntıları bağımsız doğrulanmış söz gibi sunmayın. Pivot pencereleri, minimum tepki ve sinyal ömrü gibi her parametreyi hocaya atfetmeyin. Bu mimari değişikliği yeni kârlılık/backtest kanıtı değildir.

## Doğrulama ve çalışma biçimi
Python: `.\.venv\Scripts\python.exe -m pytest python_bot/tests -q`.
UI: `node --test scripts/test_mtf_lab_ui.cjs`.
Build/deploy: `npx.cmd --yes vercel deploy --prod --yes`; mevcut bağlı Vercel projesi kullanılır.
Son yerel kontrol: 220 Python testi ve 6 UI testi geçti. Vercel üretim build kontrolü de başarılıdır. Ayrı sayfa/script, doğru dönüş/legacy yönlendirmeleri, MOST el hesabı, açık bar iptali, kapalı direnç, günlük aday eşikleri ve klasik şema izolasyonu test kapsamındadır.
Canlı tam tarama önceki günlük düzeltmesi öncesi 100 lab satırı, klasik96 başarılı hisse döndürdü; her ikisinde4 veri uyarısı vardı. Klasik7 eşleşme ve lab5 erken/2 tam/5 alt NU, yalnız o snapshot'a aittir. Veri sağlayıcı eksikleri saklanmaz; partial yanıt başarı gibi gösterilmez. Tam lab taraması yaklaşık192sn sürdü; tarayıcı süre sınırı280sn, Vercel300sn. Sonraki AI yavaşlık varsa önce veri erişimini ölçsün, klasik motoru değiştirmesin.
Tam kod rehberi: `docs/MTF_LAB_IZOLE_ENTEGRASYON.md`. Üretim URL'si, yönlendirme Location başlıkları ve BAGFS günlük kaynak/evre çıktısı son yayından sonra yeniden kontrol edilmelidir.

## Son canlı doğrulama
Günlük düzeltmesinden sonraki yayında `/`, `/rsi-pu30`, `/rsi-pu30/BAGFS` doğru Location ile307 döndü. İki HTML200, bağımsız scriptler doğru. BAGFS canlı endpoint'inde EARLY_REACTION/DAILY_FORMING_PU doğrulandı; iki hisselik BAGFS+ISCTR taramasında1 erken/1 tam onay ve0 veri uyarısı alındı. Klasik BAGFS detay şeması orijinal kaldı. Tarayıcı otomasyon köprüsü zaman aşımına uğradığından tıklayarak görsel kontrol tamamlanamadı; DOM davranışı VM testleri ve HTTP kontrolleriyle doğrulandı. Tamamlanmış görsel test iddia edilmez.

Son üretim sürümü READY: `dpl_DmRM6aZFgE15EKSraF8ipRPrPYFA`. Son yayın sonrası `/news`, `/backtest`, `/rsi-pu30` doğru ana ekrana307; `/index.html`, `/mtf-lab.html`200; BAGFS tekrar EARLY_REACTION ve DAILY_FORMING_PU doğrulandı. Güncel toplam:220 Python testi,6 UI testi geçti.
