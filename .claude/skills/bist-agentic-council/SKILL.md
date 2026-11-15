---
name: bist-agentic-council
description: Run the isolated BIST Agentic AI Quant Engine (bist_agent_core) and orchestrate multi-provider SOP tasks (decompose, code, debug, review) via route.ps1.
---

# BIST Agentic AI Karar Konseyi & `route.ps1` SOP Orkestrasyonu

## 1. İzole Karar Motoru (`bist_agent_core`)
Global veya ana proje paketlerine dokunmadan `%100` izole sanal ortamda çalışır:
```powershell
.\bist_agent_core\.venv\Scripts\python.exe bist_agent_core/agentic_engine.py THYAO ASELS EREGL PGSUS
```
- **Çıktı:** `XU100.IS` & `USDTRY=X` makro rejimi + TRY Savunma Hattı (EMA21, SMA50, SMA200, ATR Stop) + USD Taarruz Hattı (USD ATH iskonto, Fib hedefleri) + `0-100` Agentic Conviction Score.

## 2. Çoklu Sağlayıcı SOP Orkestrasyonu (`route.ps1`)
- **Görev Bölme (Architect):** `.\route.ps1 -Task decompose -Prompt "..."`
- **Minimal Diff Kodlama (Coder / Codex):** `.\route.ps1 -Task code -Prompt "..."`
- **Hata Avcısı (Debugger):** `.\route.ps1 -Task debug -Prompt "..."`
- **Bağımsız İkinci Göz Denetimi (Cross-Verifier):** `.\route.ps1 -Task review -ExcludeProvider codex -Prompt "..."`
- **Kota & Durum:** `.\route.ps1 -Status`