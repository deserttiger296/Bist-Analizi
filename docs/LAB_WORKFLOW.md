# Test Merkezi önce

Her yeni özellik veya davranış değişikliği şu sırayı izler:

1. Hedef davranışı ve mevcut sistemle uyumluluk beklentisini tanımla.
2. İlgili senaryoyu Test Merkezi paketine ekle (`python_bot/lab_runner.py`).
3. Deneysel stratejiyi MTF Lab'de incele; veri eksikliğini onay olarak sunma.
4. `python scripts/run_lab_gate.py` çalıştır. Veri güvenilirliği, klasik RSI, MTF ve uyumluluk paketlerinin tamamı geçmelidir.
5. `node --test scripts/test_mtf_lab_ui.cjs` ve `npx tsc --noEmit` ile arayüz uyumluluğunu doğrula.
6. Sonuçları incele; başarısız/eksik kontroller çözülmeden üretime taşıma.

`/lab` testleri, test sürelerini ve tekil sonuçları gösterir. `/mtf-lab.html` deneysel stratejinin evrelerini ve gerekçelerini gösterir. İkisi birbirinin yerine geçmez.

CI'daki `lab-gate` işi aynı Python paketlerini ve MTF arayüz testlerini çalıştırır. `build` işi bu kapıya bağlıdır. JSON raporu CI artifact olarak saklanır. Diğer dağıtım kanallarının bu kapıyı zorunlu tutması depo barındırma/dağıtım ayarlarında ayrıca yapılandırılmalıdır.

Hedef uygulama: https://bist-analizi-five.vercel.app/index.html. Ana statik uygulamadan iki Lab'e ayrı bağlantılar verilir. Vercel Python paketinde test dosyaları bulunmadığından canlı sitede pytest başlatılmaz; `/lab`, `public/lab-results.json` içindeki tarihli test anlık görüntüsünü gösterir. Yayın öncesinde raporu `python scripts/run_lab_gate.py --report public/lab-results.json` ile yenile. Bu rapor canlı piyasa testi veya sonradan yapılan değişikliklerin doğrulaması olarak sunulamaz.
