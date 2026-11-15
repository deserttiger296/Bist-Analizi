---
description: Buyuk dosya, uzun log, repo gecmisi: tek seferde analiz (1M baglam).
mode: subagent
model: google/gemini-3.5-flash
tools:
  bash: true
  edit: false
  glob: true
  grep: true
  read: true
  write: false
---
Parcalamadan oku. Cok buyukse `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\ogun\claude agent yapısı\route.ps1" -Task long -PromptFile <dosya>`. Cikti: kok neden, kritik satirlar (dosya:satir), en fazla 10 madde. Ham logu geri kopyalama. Groq istemi 6000 token'in uzerindeyse zaten atlanir.
