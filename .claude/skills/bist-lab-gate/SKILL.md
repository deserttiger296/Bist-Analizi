---
name: bist-lab-gate
description: Execute the mandatory BIST Test Center (/lab) verification gate including deterministic resilience/PU30/MTF/compatibility suites, MTF Lab UI isolation tests, and TypeScript checks.
---

# Zorunlu `/lab` Test Merkezi Doğrulama Kapısı

Her kod veya strateji değişikliğinden sonra sırasıyla şu 3 doğrulama komutunu çalıştır:

```powershell
.\.venv\Scripts\python.exe scripts/run_lab_gate.py
node --test scripts/test_mtf_lab_ui.cjs
npx --no-install tsc --noEmit
```

- **Katalog:** `python_bot/lab_runner.py` (`resilience`, `pu30`, `mtf`, `compatibility` paketleri).
- **Kural:** Hiçbir test atlanamaz (`skipped == 0`, `failed == 0`, `error == 0`).
- **Hafıza:** Geçiş tamamlandığında `.ecc/milestones.md` dosyasına 1-3 satırlık özet eklenir.