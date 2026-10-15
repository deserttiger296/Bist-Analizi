# PU30: iptal ve 1S / 4S / 1G kararları

> Güncel mimari: MTF yalnız ayrı laboratuvarda çalışır. Klasik motor MTF öncesi davranışına döndürülmüştür. Geçerli entegrasyon: [MTF_LAB_IZOLE_ENTEGRASYON.md](MTF_LAB_IZOLE_ENTEGRASYON.md). Aşağıdaki önceki MTF bağlama anlatımları tarihsel nottur.

15 Ekim 2026 güncel revizyon: `pu30-mtf-v5`. Kullanıcının dört katmanlı karar matrisi uygulanır. Önceki `pu30-strict-v3` dip eşleştirme koşulları korunur; sinyalin geçerliliği ve işlem statüsü `pu30-mtf-v5` ile değerlendirilir. Bu belge teknik sinyal koşullarını açıklar; fiyat hedefi veya getiri garantisi içermez.

## Hatanın kaynağı

- `_fetch_adjusted_bars` varsayılan olarak oluşan mumu çıkarıyordu. PU30 taraması ve grafik artık oluşan mumu da ister. MOSTRSI gibi diğer tüketicilerin varsayılanı değişmedi.
- `detect_rsi_pu30` sonrasında ikinci dibin delinmesi ve RSI'ın yeniden 30 altına inmesi kontrol edilmiyordu. Daha yeni pivot teyidi yokken eski çift canlı kalabiliyordu.
- `bars_since_confirm`, dip tarihinden değil, sağ iki mumun tamamlandığı teyit anından sayılıyordu. Bu nedenle “1 bar önce”, “2. dip bir bar önce oluştu” demek değildi. API ve kart artık dipten ve teyitten sonraki kapalı mumları ayrı verir; son veri mumunun tarihi ve açık/kapalı durumu görünür.
- Önceki çapraz kontrol bir diğer periyotta PU bulunmasını yeterli görüyordu. 1S + 1G, geçerli 4S olmadan ana ralli etiketine dönüşebiliyordu.
- Önceki Fibonacci dipler arasındaki ara tepeyi kullanıyordu; makro düşüş dalgasını temsil etmiyordu.
- RSI uç noktalarında 10/30 dakikalık CDN önbellek politikası eski sinyali sunabiliyordu. RSI liste ve detay yanıtları artık `Cache-Control: no-store` döner. MOSTRSI önbelleği değişmedi.

## İptal ve veri zamanı

İkinci dipten sonraki herhangi bir mumun düşük fiyatı dip2'nin altına inerse veya katı PU30'da RSI herhangi bir sonraki mumda 30 altına düşerse aynı çift iptal edilir. Son mumun açık olması iptali engellemez. RSI'ın tekrar yükselmesi eski çifti canlandırmaz; yeni bir geçerli çift gerekir.

Açık mumlar yeni pivot veya alım teyidi üretemez. Açık mum yalnızca mevcut yapıyı veto edebilir. Direnç üzerinde kapanış, kapanmış 1S veya 4S mumuyla ve 4S PU'nun gerçekten bilinebilir olduğu zamandan sonra kontrol edilir. En güncel kapanış tekrar direnç altına dönerse aktif alım statüsü kaldırılır.

4S seans mumları karar mekanizmasının kullandığı aynı 1S veri serisinden sentezlenir. Böylece 15 Ekim'deki saatlik 20,88 düşük fiyatı 4S serisinden dışarıda kalmaz. Yeterli saatlik geçmiş yoksa sağlayıcının 4S yolu denenir. Kaynak son mum zamanına göre gecikme kontrolü eklenmiştir; düzenli hafta içi seansında saatlik kaynağın beklenen zamandan 90 dakikadan fazla geride olması STALE sayılır. Tatil/yarım gün takvimi hâlâ sertifikalı değildir; tarihsel veri için canlı güncellik statüsü kullanılmamalıdır.

İptal yeni sağlayıcı verisi hesaplandığında uygulanır. Bu sistem borsa akışına bağlı tick bazlı canlı emir sistemi değildir; veri sağlayıcısının kendi gecikmesini ortadan kaldırmaz.

## Durumlar

| Durum | Koşullar | Aktif alım |
|---|---|---|
| `EARLY_REACTION` | Günlük yapı sağlam, 1S geçerli PU30, 4S geçerli PU30 yok/iptal | Hayır; seanslık yeni dip ve teyit beklenir |
| `FULL_CONFIRMATION` | Geçerli/onaylı 4S PU30, ara direnç üzerinde kapanış ve direnç üstünde güncel fiyat, sağlam günlük yapı, üç periyotta güncel veri | Evet, koşullu teknik onay |
| `WAITING_CONFIRMATION` | Giriş koşullarının yalnız bir kısmı sağlandı | Hayır |
| `DAILY_VETO` | Günlük destek kırık, RSI <30 veya geçerli günlük NU70 | Hayır |
| `DATA_UNAVAILABLE` | Periyot verisi eksik/gecikmiş veya günlük yapı belirlenemedi | Hayır |

Evre 2 için güncel veya tarihsel saatlik PU ayrıca zorunlu değildir; kullanıcının açık formülü günlük sağlamlık + geçerli 4S PU + direnç üstü fiyattır. Önceki kapanış teyidi şartı korunur. 1S/4S/1G veri kalitesi birlikte kontrol edilir. API `layer_flags` alanında `1G_Saglam`, `1S_PU`, `4S_PU` Boolean değerlerini döndürür.

Saatlik PU için eşit fiyatlı ikinci dip kabul edilir (RSI2 > RSI1 ve RSI2 > 30 devam eder). 4S/1G varsayılanı daha düşük ikinci diptir; `PU30Config.allow_equal_price` açıkça ayarlanabilir. Bir saatlik düşük fiyat 4S ikinci dip mumunun kapanışından sonraki barlarda 4S dip2 fiyatının altına inerse, 4S serisi henüz yenilenmemiş olsa da 4S PU iptal edilir.

MTF yapıları yalnız 5 mum geçtiği için silinmez: geçerli yapı, fiyat/RSI veya günlük/veri veto koşullarıyla bozulana kadar karar hesabında korunur. Böylece geçerli 4S rallisi, eski sinyal ömrü filtresi yüzünden yanlışlıkla Evre 1'e düşmez. Tek periyotlu `detect_rsi_pu30` çağrılarının yakın tarih filtresi varsayılanı korunur.

Günlük veto tercihi: güncel/geçerli günlük PU varsa onun ikinci dibi, aksi halde son teyitli günlük fiyat dibi destek kabul edilir. Bu destek korunmalı, güncel günlük RSI en az 30 olmalı ve geçerli günlük NU70 bulunmamalıdır. Günlükte ayrıca mutlaka PU30 bulunması şart değildir. Bu sayısal günlük veto algoritması Semih Hoca'nın doğrudan alıntısı olarak sunulmaz; kullanıcının istediği günlük yapı kontrolünün açık uygulama tanımıdır.

## Makro Fibonacci

Tam onaydan sonra 4S ikinci dipte biten son 100 mumluk pencerenin içinde, ilk dipten önce teyit edilmiş fiyat tepelerinin en yükseği ana tepe adayıdır. Tepe kendi sağ iki mumuyla ilk dipten önce teyit edilmiş olmalıdır. Son geçerli 4S ikinci dip tabandır. Bu belirlenebilir ve test edilebilir seçim, düşüşün başlangıcına ilişkin algoritmik bir yaklaşımdır; her grafikte görsel olarak seçilecek ana tepeyle eşitliği iddia edilmez.

`hedef_0382 = son_dip + 0.382 × (ana_tepe − son_dip)`

Örneğin ana tepe 40,00 ve son dip 20,90 ise hedef 28,20 TL'dir. 0.500 / 0.618 / 1.000 seviyeleri de aynı büyük dalgadan hesaplanır. Teyitli ana tepe bulunamazsa makro hedef UNAVAILABLE olur; dar dipler arası seviyeye sessizce dönülmez. Tam onay yoksa makro hedef yayımlanmaz. Ekran etiketi “İlk ana hedef (Makro Fibo 0.382)”dir; “garantili” değildir.

## Kod ve doğrulama

- Sinyal iptali / canlı veri / grafik API: `python_bot/engine/signals/rsi_pu30.py`
- Karar durumları / günlük veto / makro dalga: `python_bot/engine/signals/pu30_mtf.py`
- Kaynak zamanı: `python_bot/engine/data/provider.py`
- HTTP önbellek: `python_bot/signal_api.py`
- Liste ve grafik arayüzü: `public/static/app.js`, yerel Python sürümü için `python_bot/static/app.js`
- Regresyonlar: `python_bot/tests/test_pu30_mtf.py`

20,90 → 20,88 ve RSI 30,7 → 29,2 değerleri bağımsız iptal senaryolarıyla test edilir. Açık mum teyidi, direnç eşitliği, eksik periyot, günlük veto, saatlik tepkinin sıralaması ve makro Fibonacci aralığı ayrı testlere sahiptir.

Önceki `VARIANT_COMPARISON.md` raporu bu yeni MTF durum makinesinin performans testi değildir. Mevcut tek-periyot backtest aracı üç periyotlu günlük veto/direnç sıralamasını uygulamaz; v4 için başarı veya kârlılık sonucu olarak kullanılmaz.
