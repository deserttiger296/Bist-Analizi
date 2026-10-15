# Semih Hoca: kaynak sözler ve uygulama tercihleri

Kontrol tarihi: 15 Ekim 2026. Kullanıcının tercihi: yöntem için Semih Hoca'nın kendi açıklamaları esas alınır. Genel RSI kaynakları yöntemin özel kurallarının yerine geçmez.

## İncelenen kaynak

Kullanıcının önceki görüşmede aktardığı mesajlar, yerel görüşme kaydı:
`C:/Users/ogun/.gemini/antigravity/brain/ec2cc568-511b-4738-8552-387d2420c1f1/.system_generated/logs/transcript_full.jsonl`.

Kaydın USER_INPUT içeriği incelendi. Aşağıdaki alıntılar kullanıcı tarafından Semih Murat Ersoy'a atfedilen mesajlardır; bağımsız, doğrudan bir yayın doğrulaması yapılmış değildir. Görüşmedeki eski asistan yorumları kaynak söz olarak kabul edilmez.

## Açıkça aktarılan kurallar

| Kaynak | Açıklama | Uygulama karşılığı |
|---|---|---|
| Adım 721, 2 Ekim 2026, 23:12 | “Rsi tepeleri düşüyor fiyat yükseliyorsa fiyat düşecek demektir”; ilk tepe RSI 70 üzerinde, sonraki tepe 70 altında | NU70'in fiyat yükselirken RSI tepelerinin alçalması ve 70 geçişi koşulları |
| Adım 721, 2 Ekim 2026, 23:13 | “Düşerken ilk rsi dibi 30 altında oluyor. Fiyat bir tepki sonrası düşmeye devam ediyor ve 2. Dibi 30 üzerinde yapıyor” | PU30'un fiyat düşerken RSI diplerinin yükselmesi ve 30 geçişi koşulları |
| Adım 859, 2 Ekim 2026, 23:24 | “4 saatlik ve günlük periyodlar uyumsuzlukta en güvenilir periyod” | 4 saatlik/günlük uyumsuzlukların izlenmesi |
| Adım 859, 2 Ekim 2026, 23:25 | “Fakat güven kırıcı dibi saatlik bazda arıyoruz”; 4 saatlikte aranırsa daha aşağıda sinyal üreteceği açıklanıyor | Saatlik yapı ile tetik seviyesi belirlenmesi |
| Adım 859, 2 Ekim 2026, 23:26 | “Dipten dönüşte 1 saatlik uyumsuzluk çıkarsa 4 saatlikte yoksa bu bir tepkidir”; “Kısa işlem için girilebilir” | Saatlik tepki ile üst zaman dilimi uyumsuzluğunun ayrılması |

Bu ifadeler yöntemi tanımlar; gelecek getirisine veya başarı oranına ilişkin doğrulanmış sonuç olarak sunulmaz.

## Kaynakta netleşmeyen noktalar

- Adım 1319, 5 Ekim mesajında VİOP/kısa vade bağlamında 30 altı/üstü ifadelerinden sonra “Hiç gerek yok” deniyor. Bu alıntı tek başına tüm PU30 eşiklerinin kaldırıldığı anlamında kullanılmaz. Mevcut katı PU30 davranışı korunur; yorum belirsizliği saklanır.
- Mevcut proje belgeleri 6 Ekim'de katı eşiklerin yeniden teyit edildiğini yazıyor. İncelenen özgün kayıtta bu teyit bulunamadı; şimdilik proje belgesindeki aktarım olarak değerlendirilir.
- Kırılımda iğne mi kapanış mı kullanılacağı bu metinlerde açıkça belirtilmiyor. Mevcut kapanış koşulu bir uygulama tercihidir.
- Güven tazeleyen tepenin PU30'a ayna olarak uygulanması ve saatlik yapının tam pivot algoritması bu metinlerden tek başına bütünüyle doğrulanamıyor. Eski grafik ekleriyle ayrıca karşılaştırılmalıdır.

## Hocanın açık sözü olarak sunulmayacak mevcut parametreler

İncelenen mesajlarda şu sayısal şartlar bulunmadı: en az %3 tepki/geri çekilme, 8–60 mum pivot mesafesi, sol 5/sağ 2 pivot penceresi, 5 mum sinyal ömrü ve fiyat pivotu çevresindeki 8 mumdan minimum/maksimum RSI seçimi. Bunlar mevcut algoritmanın ayarlarıdır. Kaynak bulunmadan hocaya atfedilmez; kaynak eksikliği tek başına bu ayarların yanlışlığını da kanıtlamaz. Bu incelemede değiştirilmediler.

## Canlı yöntem ile backtest farkı

`scan_universe_rsi_pu30`, `apply_hourly_trust_level` üzerinden saatlik güven seviyesini ve kırılımını hesaplar. `run_portfolio_backtest` ise uyumsuzluk pivotunun teyidinden sonra emir planlar; saatlik güven seviyesi kırılımını ve canlıdaki çoklu zaman dilimi sınıflamasını uygulamaz.

Dolayısıyla `VARIANT_COMPARISON.md` mevcut haliyle Semih Hoca'nın saatlik tetikli yönteminin tamamının performans doğrulaması olarak kullanılmaz. Canlı kuralla aynı giriş/çıkış zamanlarını kullanan ayrı bir doğrulama gereklidir.
