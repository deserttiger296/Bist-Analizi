<#
.SYNOPSIS
    BIST Analizi - Kendini Yazan Otonom Hata Tamir Motoru (Self-Writing Agentic Autofix)
.DESCRIPTION
    Hata/stack trace baglamini patch_applier.py ile cikarir, route.ps1 veya codex exec
    (-s workspace-write) uzerinden dosya yamalarini dogrudan uygular, yedek alir,
    bagimsiz review + TypeScript / MTF UI / /lab test kapilarindan gecirir ve hata olursa
    otomatik geri alir (rollback).
.EXAMPLE
    .\scripts\agentic_autofix.ps1 -Latest
    .\scripts\agentic_autofix.ps1 -ErrorText "TypeError at src/app/login/page.tsx:42" -Writer auto
    .\scripts\agentic_autofix.ps1 -ErrorText "Traceback..." -NoWrite
#>
param(
    [switch]$Latest,
    [string]$ErrorText = "",
    [string]$ErrorFile = "",
    [string]$Source = "manual",
    [string]$Url = "",
    [string]$Stack = "",
    [string]$UserAgent = "",
    [ValidateSet("auto", "patch", "codex")]
    [string]$Writer = "auto",
    [switch]$NoWrite,
    [switch]$SkipTests,
    [switch]$AutoPush,
    [switch]$LaunchWindow,
    [switch]$RunTests
)

$ErrorActionPreference = "Continue"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogFile = Join-Path $RepoRoot ".cache\runtime_errors.jsonl"
$HistoryFile = Join-Path $RepoRoot ".ecc\autofix_history.jsonl"
$PatchApplier = Join-Path $RepoRoot "scripts\patch_applier.py"
$CheckScriptsPath = "C:\Users\ogun\claude agent yapısı\check-scripts.ps1"
$RouteScript = "C:\Users\ogun\claude agent yapısı\route.ps1"

$VenvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (Test-Path $VenvPython) {
    $PythonExe = $VenvPython
} else {
    $PythonExe = "python"
}

function Format-WinArg([string]$Value) {
    if ($null -eq $Value) { return '""' }
    $escaped = $Value.Replace('"', '\"')
    return '"' + $escaped + '"'
}

if ($LaunchWindow) {
    $argTokens = @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", (Format-WinArg $PSCommandPath))
    $handoffErrorFile = ""
    if ($ErrorFile) {
        $handoffErrorFile = $ErrorFile
    } elseif ($ErrorText -or $Stack) {
        $handoffErrorFile = [System.IO.Path]::GetTempFileName()
        $combined = $ErrorText
        if ($Stack) { $combined = "$combined`n$Stack" }
        Set-Content -Path $handoffErrorFile -Value $combined -Encoding UTF8
    }

    if ($Latest) { $argTokens += "-Latest" }
    if ($handoffErrorFile) { $argTokens += @("-ErrorFile", (Format-WinArg $handoffErrorFile)) }
    if ($Source) { $argTokens += @("-Source", (Format-WinArg $Source)) }
    if ($Url) { $argTokens += @("-Url", (Format-WinArg $Url)) }
    if ($UserAgent) { $argTokens += @("-UserAgent", (Format-WinArg $UserAgent)) }
    if ($Writer) { $argTokens += @("-Writer", (Format-WinArg $Writer)) }
    if ($NoWrite) { $argTokens += "-NoWrite" }
    if ($SkipTests) { $argTokens += "-SkipTests" }
    if ($AutoPush) { $argTokens += "-AutoPush" }

    $proc = Start-Process -FilePath "powershell.exe" -ArgumentList ($argTokens -join " ") -WorkingDirectory $RepoRoot -PassThru
    Write-Host "[AUTOFIX] Ayri PowerShell penceresinde baslatildi (PID: $($proc.Id))." -ForegroundColor Cyan
    exit 0
}

function Ensure-ParentDir([string]$FilePath) {
    $dir = Split-Path -Parent $FilePath
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

function Write-AutofixHistory([hashtable]$Entry) {
    try {
        Ensure-ParentDir $HistoryFile
        $jsonLine = ($Entry | ConvertTo-Json -Compress -Depth 6)
        Add-Content -Path $HistoryFile -Value $jsonLine -Encoding UTF8
    } catch {
        Write-Warning "Autofix gecmisi yazilamadi: $($_.Exception.Message)"
    }
}

function Get-GitChangedFiles() {
    $lines = @(& git -C $RepoRoot status --porcelain 2>$null)
    $paths = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.Length -lt 4) { continue }
        $rawPath = $line.Substring(3).Trim()
        if ($rawPath -match " -> ") {
            $rawPath = ($rawPath -split " -> ")[-1].Trim()
        }
        $rawPath = $rawPath.Trim('"').Replace("\", "/")
        if ($rawPath) { [void]$paths.Add($rawPath) }
    }
    return @($paths | Select-Object -Unique)
}

function New-PreCodexSnapshot([string[]]$ExistingDirtyFiles) {
    $snapId = "codex_" + (Get-Date -Format "yyyyMMddTHHmmss") + "_" + $PID
    $snapDir = Join-Path $RepoRoot (".cache\autofix_backups\" + $snapId)
    New-Item -ItemType Directory -Path $snapDir -Force | Out-Null

    $trackedBackup = @()
    foreach ($rel in $ExistingDirtyFiles) {
        $src = Join-Path $RepoRoot ($rel.Replace("/", "\"))
        if (Test-Path $src -PathType Leaf) {
            $dst = Join-Path $snapDir ($rel.Replace("/", "\"))
            Ensure-ParentDir $dst
            Copy-Item -LiteralPath $src -Destination $dst -Force
            $trackedBackup += $rel
        }
    }
    return @{
        SnapshotId = $snapId
        SnapshotDir = $snapDir
        PreDirtyFiles = @($ExistingDirtyFiles)
        BackedUpFiles = @($trackedBackup)
    }
}

function Restore-CodexSnapshot($Snapshot, [string[]]$FilesAfterCodex) {
    $preSet = @{}
    foreach ($f in @($Snapshot.PreDirtyFiles)) { $preSet[$f] = $true }
    $backedSet = @{}
    foreach ($f in @($Snapshot.BackedUpFiles)) { $backedSet[$f] = $true }

    foreach ($rel in @($FilesAfterCodex)) {
        $winRel = $rel.Replace("/", "\")
        $target = Join-Path $RepoRoot $winRel
        if ($backedSet.ContainsKey($rel)) {
            $bak = Join-Path $Snapshot.SnapshotDir $winRel
            if (Test-Path $bak -PathType Leaf) {
                Ensure-ParentDir $target
                Copy-Item -LiteralPath $bak -Destination $target -Force
            }
        } elseif (-not $preSet.ContainsKey($rel)) {
            & git -C $RepoRoot ls-files --error-unmatch -- $rel *> $null
            if ($LASTEXITCODE -eq 0) {
                & git -C $RepoRoot checkout -- $rel
            } elseif (Test-Path $target) {
                Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

function Invoke-VerificationSuite([string[]]$ChangedFiles) {
    Write-Host "`n[3/4] Dogrulama Kapisi Calistiriliyor..." -ForegroundColor Cyan

    # Guvenlik kontrolu: gizli dosyalar asla degismis olamaz
    foreach ($rel in @($ChangedFiles)) {
        $norm = $rel.Replace("\", "/").ToLowerInvariant()
        if ($norm -match "(^|/)\.env" -or $norm -match "\.(pem|key|pfx)$" -or $norm -match "(^|/)\.git/") {
            Write-Host "[GUVENLIK HATASI] Yasakli dosya degistirildi: $rel" -ForegroundColor Red
            return $false
        }
    }

    # 1. TypeScript check
    Write-Host "  -> npx --no-install tsc --noEmit" -ForegroundColor Gray
    Push-Location $RepoRoot
    try {
        & npx --no-install tsc --noEmit
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[FAIL] TypeScript kontrolu basarisiz oldu." -ForegroundColor Red
            return $false
        }

        # 2. MTF Lab UI testleri
        Write-Host "  -> node --test scripts/test_mtf_lab_ui.cjs" -ForegroundColor Gray
        & node --test (Join-Path $RepoRoot "scripts\test_mtf_lab_ui.cjs")
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[FAIL] MTF Lab UI testleri basarisiz oldu." -ForegroundColor Red
            return $false
        }

        # 3. Eger Python dosyasi degistiyse /lab gate calistir
        $hasPyChange = $false
        foreach ($rel in @($ChangedFiles)) {
            if ($rel -match "\.py$") { $hasPyChange = $true; break }
        }
        if ($hasPyChange) {
            Write-Host "  -> scripts/run_lab_gate.py (.py dosyasi degistigi icin)" -ForegroundColor Gray
            & $PythonExe (Join-Path $RepoRoot "scripts\run_lab_gate.py")
            if ($LASTEXITCODE -ne 0) {
                Write-Host "[FAIL] /lab Python gate basarisiz oldu." -ForegroundColor Red
                return $false
            }
        }

        # 4. Eger .ps1 dosyasi degistiyse syntax kontrolu yap
        if (Test-Path $CheckScriptsPath) {
            foreach ($rel in @($ChangedFiles)) {
                if ($rel -match "\.ps1$") {
                    $psTarget = Join-Path $RepoRoot ($rel.Replace("/", "\"))
                    Write-Host "  -> check-scripts.ps1 $rel" -ForegroundColor Gray
                    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $CheckScriptsPath $psTarget
                    if ($LASTEXITCODE -ne 0) {
                        Write-Host "[FAIL] PowerShell syntax kontrolu basarisiz: $rel" -ForegroundColor Red
                        return $false
                    }
                }
            }
        }
    } finally {
        Pop-Location
    }

    Write-Host "[PASS] Tum dogrulama testleri basarili!" -ForegroundColor Green
    return $true
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  BIST OTONOM KENDINI YAZAN TAMIR MOTORU (AUTOFIX v2.0)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Hata kaynagini belirle
if ($ErrorFile) {
    if (-not (Test-Path $ErrorFile)) {
        Write-Error "Hata dosyasi bulunamadi: $ErrorFile"
        exit 1
    }
    $ErrorText = Get-Content -Path $ErrorFile -Raw -Encoding UTF8
} elseif (-not $ErrorText) {
    if (-not (Test-Path $LogFile)) {
        Write-Host "Kayitli runtime hatasi bulunamadi ($LogFile)." -ForegroundColor Green
        exit 0
    }
    $lines = @(Get-Content -Path $LogFile -Encoding UTF8 | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($lines.Count -eq 0) {
        Write-Host "Hata kaydi bos ($LogFile)." -ForegroundColor Green
        exit 0
    }
    $latestObj = $lines[-1] | ConvertFrom-Json
    $ErrorText = "$($latestObj.message)"
    if ($latestObj.stack) { $Stack = "$($latestObj.stack)" }
    if ($latestObj.source) { $Source = "$($latestObj.source)" }
    if ($latestObj.url) { $Url = "$($latestObj.url)" }
    if ($latestObj.userAgent) { $UserAgent = "$($latestObj.userAgent)" }
}

if ([string]::IsNullOrWhiteSpace($ErrorText)) {
    Write-Host "Islenecek hata metni bos." -ForegroundColor Yellow
    exit 0
}

$fullErrorPayload = @"
Kaynak    : $Source
URL       : $Url
Cihaz/UA  : $UserAgent
Hata      : $ErrorText
Stack Trace:
$Stack
"@

$tmpErrorFile = [System.IO.Path]::GetTempFileName()
$tmpPromptFile = [System.IO.Path]::GetTempFileName()
$tmpRespFile = [System.IO.Path]::GetTempFileName()
$tmpReviewFile = [System.IO.Path]::GetTempFileName()

try {
    Set-Content -Path $tmpErrorFile -Value $fullErrorPayload -Encoding UTF8

    Write-Host "[1/4] Ilgili kod baglami cikariliyor..." -ForegroundColor Yellow
    $contextText = ""
    if (Test-Path $PatchApplier) {
        $ctxLines = @(& $PythonExe $PatchApplier extract-context --repo-root $RepoRoot --error-file $tmpErrorFile --window 40 --max-files 4)
        if ($LASTEXITCODE -eq 0 -and $ctxLines.Count -gt 0) {
            $contextText = ($ctxLines -join "`n")
        }
    }

    if ($NoWrite) {
        Write-Host "[MOD: -NoWrite] Dosyalara yazilmadan yalnizca teshis uretiliyor..." -ForegroundColor Cyan
        $diagPrompt = @"
Asagidaki hatayi analiz et. Hicbir dosya degistirmeden kok nedeni ve en kucuk yama onerisini yaz.

$fullErrorPayload

ILGILI KOD KESITLERI:
$contextText
"@
        Set-Content -Path $tmpPromptFile -Value $diagPrompt -Encoding UTF8
        if (Test-Path $RouteScript) {
            $diagOut = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $RouteScript -Task debug -Fast -PromptFile $tmpPromptFile)
            Write-Host ($diagOut -join "`n") -ForegroundColor White
        } else {
            Write-Warning "route.ps1 bulunamadi: $RouteScript"
        }
        exit 0
    }

    $appliedMode = ""
    $backupDir = ""
    $backupId = ""
    $rootCause = ""
    $changedFiles = @()
    $codexSnapshot = $null

    # Stage 1: Groq (-Fast) JSON Patch -> patch_applier.py
    if (($Writer -eq "auto" -or $Writer -eq "patch") -and (Test-Path $RouteScript) -and (Test-Path $PatchApplier) -and -not [string]::IsNullOrWhiteSpace($contextText)) {
        Write-Host "[2/4] Asama 1: route.ps1 -Task debug -Fast + patch_applier.py deneniyor..." -ForegroundColor Magenta
        $patchPrompt = @"
Sen otonom bir hata duzeltme ajanisin. YALNIZCA gecerli tek bir JSON nesnesi dondur (baska aciklama veya markdown yazma).
Kurallar:
- Yalnizca asagidaki kod kesitlerinde gecen goreceli dosya yollarini duzenle.
- "search" alani hedef dosyada Birebir ve TEK sefer gecerli olmalidir.
- .env, gizli anahtar, .git veya node_modules dosyalarina dokunma.

Beklenen JSON semasi:
{
  "root_cause": "Kisa kok neden ozeti",
  "edits": [
    {
      "file": "src/ornek/dosya.ts",
      "search": "degistirilecek birebir mevcut kod blogu",
      "replace": "yeni duzeltilmis kod blogu",
      "reason": "neden bu degisiklik yapildi"
    }
  ]
}

HATA RAPORU:
$fullErrorPayload

KOD KESITLERI (satir numarasi oneklerini "12: " kisminda arama metnine EKLEME!):
$contextText
"@
        Set-Content -Path $tmpPromptFile -Value $patchPrompt -Encoding UTF8
        $rawLines = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $RouteScript -Task debug -Fast -PromptFile $tmpPromptFile)
        if ($LASTEXITCODE -eq 0 -and $rawLines.Count -gt 0) {
            $rawResp = ($rawLines -join "`n")
            Set-Content -Path $tmpRespFile -Value $rawResp -Encoding UTF8
            $applyOut = @(& $PythonExe $PatchApplier apply --repo-root $RepoRoot --response-file $tmpRespFile)
            $applyJsonText = ($applyOut -join "`n")
            if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($applyJsonText)) {
                try {
                    $applyResult = $applyJsonText | ConvertFrom-Json
                    if ($applyResult.ok -eq $true) {
                        $appliedMode = "patch"
                        $backupDir = "$($applyResult.backup_dir)"
                        $backupId = "$($applyResult.backup_id)"
                        $rootCause = "$($applyResult.root_cause)"
                        $changedFiles = @($applyResult.changed_files)
                        Write-Host "[YAZILDI - PATCH] Degisen dosyalar: $($changedFiles -join ', ')" -ForegroundColor Green
                    }
                } catch {
                    Write-Warning "Patch apply ciktisi ayristirilamadi: $($_.Exception.Message)"
                }
            } else {
                Write-Warning "Asama 1 patch uygulanamadi ($applyJsonText)."
            }
        } else {
            Write-Warning "route.ps1 debug cagrisi yanit donduremedi."
        }
    }

    # Stage 2 fallback: Codex CLI workspace-write
    if (-not $appliedMode -and ($Writer -eq "auto" -or $Writer -eq "codex")) {
        $codexCmd = Get-Command codex -ErrorAction SilentlyContinue
        if ($codexCmd) {
            Write-Host "[2/4] Asama 2: codex exec (-s workspace-write) ile dogrudan yaziliyor..." -ForegroundColor Magenta
            $preDirty = @(Get-GitChangedFiles)
            $codexSnapshot = New-PreCodexSnapshot -ExistingDirtyFiles $preDirty
            $backupId = $codexSnapshot.SnapshotId
            $backupDir = $codexSnapshot.SnapshotDir

            $codexPrompt = @"
Bu repoda canli bir hata yakalandi. Lutfen hedef dosyalari inceleyip EN KUCUK ve GUVENLI duzeltmeyi dogrudan dosyalara yaz.
Kurallar:
- .env*, secret, key, node_modules veya .git dosyalarina asla dokunma.
- Yalnizca bu hatanin kok nedeni icin gereken dosyalari degistir.
- Duzeltme sonrasi ne degistirdigini kisaca ozetle.

$fullErrorPayload

ILGILI KOD KESITLERI:
$contextText
"@
            $codexOut = @($codexPrompt | & codex exec --skip-git-repo-check --ephemeral -s workspace-write --approve-for-me -C $RepoRoot -c model_reasoning_effort=low -o $tmpRespFile -)
            $codexExit = $LASTEXITCODE
            $afterDirty = @(Get-GitChangedFiles)
            $preMap = @{}
            foreach ($p in $preDirty) { $preMap[$p] = $true }
            $touchedByCodex = @($afterDirty | Where-Object { -not $preMap.ContainsKey($_) })
            if ($touchedByCodex.Count -eq 0 -and $afterDirty.Count -gt 0) {
                $touchedByCodex = $afterDirty
            }

            if ($codexExit -eq 0 -and $touchedByCodex.Count -gt 0) {
                $appliedMode = "codex"
                $changedFiles = $touchedByCodex
                if (Test-Path $tmpRespFile) {
                    $summaryTxt = (Get-Content -Path $tmpRespFile -Raw -Encoding UTF8)
                    if ($summaryTxt) {
                        $rootCause = ($summaryTxt.Trim() -split "`r?`n")[0]
                        if ($rootCause.Length -gt 240) { $rootCause = $rootCause.Substring(0, 240) }
                    }
                }
                Write-Host "[YAZILDI - CODEX] Degisen dosyalar: $($changedFiles -join ', ')" -ForegroundColor Green
            } else {
                Write-Warning "Codex yazma islemi basarisiz oldu veya hic dosya degistirmedi (ExitCode: $codexExit)."
                if ($codexOut.Count -gt 0) { Write-Host ($codexOut -join "`n") -ForegroundColor Gray }
            }
        } else {
            Write-Warning "codex CLI bulunamadi."
        }
    }

    if (-not $appliedMode -or $changedFiles.Count -eq 0) {
        Write-AutofixHistory @{
            timestamp = (Get-Date).ToUniversalTime().ToString("o")
            status = "no_fix_applied"
            writer = $Writer
            error = $ErrorText
            source = $Source
        }
        Write-Host "[SONUC] Otomatik yama uygulanamadi." -ForegroundColor Red
        exit 1
    }

    # Bagimsiz ikinci goz (Cross-Review)
    if (Test-Path $RouteScript) {
        $diffLines = @(& git -C $RepoRoot diff -- @changedFiles 2>$null)
        if ($diffLines.Count -gt 0) {
            if ($diffLines.Count -gt 220) {
                $diffSnippet = ($diffLines[0..219] -join "`n") + "`n... [TRUNCATED]"
            } else {
                $diffSnippet = ($diffLines -join "`n")
            }
            $reviewPrompt = @"
Asagidaki otomatik hata duzeltme diff'ini guvenlik ve dogruluk acisindan kisaca denetle (1-4 satir):

HATA: $ErrorText

DIFF:
$diffSnippet
"@
            Set-Content -Path $tmpReviewFile -Value $reviewPrompt -Encoding UTF8
            $reviewArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $RouteScript, "-Task", "review", "-PromptFile", $tmpReviewFile)
            if ($appliedMode -eq "codex") {
                $reviewArgs += @("-Fast", "-ExcludeProvider", "codex")
                Write-Host "[INCELEME] route.ps1 -Task review -Fast (-ExcludeProvider codex) calisiyor..." -ForegroundColor Cyan
            } else {
                $reviewArgs += @("-ExcludeProvider", "groq")
                Write-Host "[INCELEME] route.ps1 -Task review (-ExcludeProvider groq) calisiyor..." -ForegroundColor Cyan
            }
            $revOut = @(& powershell.exe @reviewArgs)
            if ($revOut.Count -gt 0) {
                Write-Host ($revOut -join "`n") -ForegroundColor Gray
            }
        }
    }

    # Test / Dogrulama Kapisi
    $testsPassed = $true
    if (-not $SkipTests) {
        $testsPassed = Invoke-VerificationSuite -ChangedFiles $changedFiles
    } else {
        Write-Host "[UYARI] -SkipTests verildi, dogrulama atlandi." -ForegroundColor Yellow
    }

    if (-not $testsPassed) {
        Write-Host "`n[ROLLBACK] Testler basarisiz oldugu icin degisiklikler geri aliniyor..." -ForegroundColor Red
        if ($appliedMode -eq "patch" -and $backupDir) {
            & $PythonExe $PatchApplier restore --repo-root $RepoRoot --backup-dir $backupDir | Out-Null
        } elseif ($codexSnapshot) {
            Restore-CodexSnapshot -Snapshot $codexSnapshot -FilesAfterCodex @(Get-GitChangedFiles)
        }
        Write-AutofixHistory @{
            timestamp = (Get-Date).ToUniversalTime().ToString("o")
            status = "rolled_back"
            writer = $appliedMode
            root_cause = $rootCause
            changed_files = $changedFiles
            backup_id = $backupId
            error = $ErrorText
        }
        exit 1
    }

    # Opsiyonel AutoPush (yalnizca hedefli dosyalar)
    $pushed = $false
    if ($AutoPush -and -not $SkipTests) {
        Write-Host "`n[4/4] -AutoPush etkin: Degisen dosyalar commit ve push ediliyor..." -ForegroundColor Cyan
        Push-Location $RepoRoot
        try {
            & git add -- @changedFiles
            if ($LASTEXITCODE -ne 0) { throw "git add basarisiz" }
            $shortErr = ($ErrorText -replace "\s+", " ").Trim()
            if ($shortErr.Length -gt 55) { $shortErr = $shortErr.Substring(0, 55) }
            & git commit -m "fix(watchdog): $shortErr"
            if ($LASTEXITCODE -ne 0) { throw "git commit basarisiz" }
            & git push origin main
            if ($LASTEXITCODE -ne 0) { throw "git push basarisiz" }
            $pushed = $true
            Write-Host "[PUSH OK] GitHub / Vercel dagitimina gonderildi." -ForegroundColor Green
        } catch {
            Write-Warning "AutoPush basarisiz: $($_.Exception.Message)"
        } finally {
            Pop-Location
        }
    }

    Write-AutofixHistory @{
        timestamp = (Get-Date).ToUniversalTime().ToString("o")
        status = "fixed"
        writer = $appliedMode
        root_cause = $rootCause
        changed_files = $changedFiles
        backup_id = $backupId
        pushed = $pushed
        error = $ErrorText
    }

    Write-Host "`n[TAMAMLANDI] Yama ($appliedMode) basariyla uygulandi ve dogrulandi." -ForegroundColor Green
    exit 0
} finally {
    Remove-Item -LiteralPath $tmpErrorFile, $tmpPromptFile, $tmpRespFile, $tmpReviewFile -Force -ErrorAction SilentlyContinue
}
