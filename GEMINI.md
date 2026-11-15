<!-- Bu dosya Bist-Analizi/CLAUDE.md'den otomatik senkronize edilmistir. -->
# BIST-Analizi: Agentic AI & Nicel Ticaret Sistemi Kılavuzu (ECC + REA + 13 Ajan)

## 0. Ekonomik Ajan & Token (`Cache read`) Koruma Kuralları
- **KESİN KURAL:** Ana oturumda uzun dosya okumaları, geniş çaplı kod taramaları veya uzun terminal/test çıktıları basma; bu işlemleri izole alt ajanlara (`scout`, `test-runner`, `long-context`) veya `route.ps1` komutuna devret. Ana oturuma yalnızca kısa SOP özeti döndür.
- **Hedefli Okuma:** Asla bir dosyanın tamamını tek seferde okuma. Önce `grep`/`glob` ile satır numarasını bul, sadece ilgili 30-60 satırlık bloğu oku.
- **Sıfır Haiku Postacı Kuralı:** Tek adımlı `route.ps1` çağrılarında (`-Task code`, `debug`, `review`, `decompose`, `doc`, `commit`) alt ajan uyandırıp fazladan Claude token'ı harcama; doğrudan terminalden `route.ps1 -Task ...` çalıştır (**0 Claude token**).
- **Hızlı/Ücretsiz Mod (`-Fast`):** Orta ölçekli kod, SQL, veri dönüşümü veya indikatör hesaplarında `route.ps1 -Task code -Fast` kullan (yavaş CLI'ları atlayıp 1.2 sn'de doğrudan ücretsiz Groq 120B LPU'ya gider).

## 1. Orkestrasyon: 13 Uzman Ajan Ordusu (10 Çekirdek + 3 BIST Uzmanı)
Ajanlar birbirine serbest metin değil, **MetaGPT SOP çıktısı** (`dosya:satır`, fonksiyon imzası, bağımlılık, doğrulama komutu) verir:

| Ajan | Ne Zaman Kullanılır | Çağrılan Motor / Komut |
|---|---|---|
| `bist-orchestrator` | Tekil BIST hisse analizi, ReAct + Boğa/Ayı + Shield Risk kararı | `bist_agent_core/agentic_engine.py <HISSE>` + `route.ps1 -Consensus` |
| `bist-radar` | "Piyasada fırsat bul" çoklu BIST-30/100 hisse taraması (İlk 3) | `bist_agent_core/agentic_engine.py THYAO ASELS ...` |
| `bist-risk-auditor` | Şeytanın Avukatı: Net EV, Half-Kelly (`%15` tavan), `%99 CVaR` ve Stop denetimi | `python_bot/engine/shield/` (`expected_value`, `kelly_sizing`, `risk_var`) |
| `scout` | Hızlı dosya/sembol keşfi ve bağımlılık haritası (SOP çıktısı) | Salt-okunur (`grep`/`glob`) / `groq gpt-oss-20b` |
| `architect` | Mimari tasarım, görev bölme (`-Task decompose`) ve uzlaşı (`-Consensus`) | `route.ps1 -Task decompose` / `route.ps1 -Task plan -Consensus` |
| `coder` | Ağır algoritma, quant motoru ve TypeScript/Python kodlama | `route.ps1 -Task code` (`codex` başta) veya `-Fast` (`groq 120b`) |
| `debugger` | Kök neden (`Confirm vs. Falsify`) + en küçük yama (`minimal diff`) | `route.ps1 -Task debug` |
| `data-sql` | SQL (`db/schema.sql`), ETL, JSON ve finansal veri şemaları | `route.ps1 -Task code -Fast` (`groq gpt-oss-120b`) |
| `python-scripter` | Python/PowerShell otomasyon, yfinance/BiQuote veri betikleri | `route.ps1 -Task code -CrossCheck` |
| `long-context` | Büyük doküman, backtest JSON ve uzun log analizi | `route.ps1 -Task long -PromptFile ...` (`gemini-3.5-flash`) |
| `test-runner` | Pytest/Node test koşumu + yeni sınır durumu testi üretimi | `route.ps1 -Task test` + `.\.venv\Scripts\python.exe -m pytest` |
| `cross-verifier` | Kodu yazandan bağımsız (`-ExcludeProvider`) P0/P1/P2 + OWASP denetimi | `route.ps1 -Task review -ExcludeProvider <provider>` |
| `doc-writer` | Teknik dokümantasyon, rapor ve commit mesajı | `route.ps1 -Task doc` (`groq qwen3.8-27b`) |

## 2. Nicel Ticaret Sistemi Yazılım Mimarisi
Nicel (quant) motor `python_bot/` altında konsolide edilmiştir:
* `python_bot/engine/brain/`: ML/alfa katmanı — feature engineering, dynamic weighting, FinBERT sentiment, meta-learning, HMM rejim tespiti.
* `python_bot/engine/shield/`: Kurumsal Risk Kalkanı — `expected_value.py` (BIST komisyon/slippage dahil Net EV), `kelly_sizing.py` (Half-Kelly & duyarlılık freni), `risk_var.py` (Parametrik ve Tarihsel VaR + Basel III **CVaR / Expected Shortfall**), `correlation_matrix.py`.
* `python_bot/engine/signals/`: `rsi_pu30.py` (RSI PU30/NU70 uyumsuzluk), `pu30_mtf.py` (Çoklu zaman dilimi MTF), `most_rsi.py`.
* `python_bot/engine/sniper/`: Emir yürütme mantığı (`execution_router.py`, `shadow_stop.py`).
* `python_bot/engine/stat_arb.py`: Engle-Granger ve Johansen eşbütünleşme testleri.
* `bist_agent_core/agentic_engine.py`: Otonom ReAct + TRY Savunma / USD Taarruz + Shield Risk karar motoru.
* `src/lib/` & `src/components/`: Next.js 15 ön yüzü, `rsiPu30Engine.ts`, `sniperEngine.ts`, `bist.ts`, `indicators.ts`, `cache.ts`.

## 3. Kodlama Standartları
* Tüm matematiksel hesaplamalarda `numpy.float64` veri tipi ve `math.isfinite` / `np.isfinite` sınır kontrolleri zorunludur.
* Veri çerçevelerinde vektörel işlemler tercih edilmeli, `for` döngülerinden kaçınılmalıdır.
* Zaman serisi doğrulamalarında ileriye dönük doğrulama (walk-forward validation - WFO) uygulanmalıdır; eğitim/seçim/test sınırlarında veri sızıntısı (`validation.py`) yasaktır.
* API anahtarları asla koda, loga veya sohbete yazılmaz; `.env` / `.env.local` veya kullanıcı ortam değişkenlerinden okunur.

## 4. Test ve Doğrulama Komutları (Windows & Repo Kökü)
* `python_bot/` altındaki tüm modüller `python_bot.engine...` mutlak importu kullanır; bu yüzden her komut **repo kökünden** (`C:\Users\ogun\Downloads\Bist-Analizi`) ve kökteki sanal ortamla (`.\.venv\Scripts\python.exe`) çalıştırılmalıdır:
  * **Birim ve Uyumluluk Testleri:** `.\.venv\Scripts\python.exe -m pytest python_bot/tests/ -v`
  * **Shield Risk Testleri:** `.\.venv\Scripts\python.exe -m pytest python_bot/tests/test_shield_risk.py -v`
  * **Otonom Hisse Analizi (ReAct + Shield):** `.\bist_agent_core\.venv\Scripts\python.exe bist_agent_core/agentic_engine.py THYAO`
  * **Sinyal Motoru (Port 8001 - Frontend Backend'i):** `.\.venv\Scripts\python.exe -m uvicorn python_bot.main_api:app --port 8001`
  * **Analitik Motor (Port 8000):** `.\.venv\Scripts\python.exe -m uvicorn python_bot.main:app --port 8000`
  * **MTF UI Testi:** `node --test scripts/test_mtf_lab_ui.cjs`
* **Bitirmeden Önce (ECC Disiplini):**
  1. Ücretsiz uç veya Codex'ten gelen kodu `route.ps1 -Task review -ExcludeProvider ...` ile bağımsız ikinci gözden geçir.
  2. İlgili `pytest` testlerini çalıştır; testler yeşil olmadan "bitti" deme.
  3. Kilometre taşını `.ecc/milestones.md` dosyasına 1-3 satırla kaydet.
  4. Canlı ajan trafiğini ve kotaları `http://localhost:8787` (Agent Hub) üzerinden takip et.

