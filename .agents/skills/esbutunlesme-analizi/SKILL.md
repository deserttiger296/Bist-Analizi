---
name: esbutunlesme-analizi
description: Belirtilen iki finansal varlık arasındaki Engle-Granger eşbütünleşme ilişkisini test eder.
paths:
  - "data/*.csv"
  - "src/tools/*.py"
disable-model-invocation: true
allowed-tools:
  - run_command
---

# Eşbütünleşme Analizi Beceri Yönergesi

Bu beceri `/esbutunlesme-analizi [varlik_A] [varlik_B]` şeklinde çağrıldığında aşağıdaki adımları sırasıyla yürütür:

1. `stat_engine.py` aracını çalıştırarak Engle-Granger istatistiğini hesaplar:
   `python src/tools/stat_engine.py --asset_a $0 --asset_b $1`

2. Çıktıdaki p-değerini (p-value) analiz eder. Eğer p-değeri < 0.05 ise, çiftin eşbütünleşik olduğu kanıtlanmıştır.

3. Eğer varlıklar eşbütünleşik ise, geriye dönük sınamayı (backtest) başlatmak için:
   `python src/core/backtest.py --pair $0,$1`
   komutu çağrılır.

4. Sonuçlar kullanıcıya açıkça raporlanır.
