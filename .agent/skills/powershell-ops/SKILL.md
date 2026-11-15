---
name: powershell-ops
description: Best practices, syntax validation, and safe execution patterns for Windows PowerShell (.ps1) tasks.
---

# PowerShell Execution Checklist
- Prefer `Join-Path` over string concatenation (`\`) for Windows paths.
- Quote paths containing spaces (`"C:\Program Files\..."`).
- When invoking native executables (`npx.cmd`, `ollama`, `docker`), check `$LASTEXITCODE -ne 0` immediately after execution.
- Always parse-check generated `.ps1` files before declaring completion. Use single quotes so the outer shell does not expand `$null` / `$errors`:
  ```powershell
  # Windows PowerShell 5.1 (built-in); use pwsh instead of powershell for 7+
  powershell -NoProfile -Command '$e = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile("script.ps1", [ref]$null, [ref]$e); if ($e) { $e; exit 1 }'
  ```
  In `C:\Users\ogun\claude agent yapısı` you can also run `.\check-scripts.ps1` (all .ps1 files) or `.\check-scripts.ps1 file.ps1`.
- Run the parse check under **both** `powershell` (5.1) and `pwsh` (7+) when the script must work on both and `pwsh` is installed.
