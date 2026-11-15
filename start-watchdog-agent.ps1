<#
.SYNOPSIS
    BIST Analizi - Otonom PowerShell Gozcu Ajani (Self-Writing Watchdog Agent)
.DESCRIPTION
    PowerShell penceresinde canli calisir. .cache/runtime_errors.jsonl ve opsiyonel
    sunucu log dosyalarini izler; yinelenen hatalari 5 dakika cooldown ile tekillestirir;
    yeni hata yakalandiginda doğrudan scripts/agentic_autofix.ps1 motorunu cagirarak
    dosyalara duzeltme yazar, testleri kosar ve basarisizlikta geri alir.
.PARAMETER LaunchWindow
    Gozcuyu yeni ve ayri bir PowerShell penceresinde baslatir.
.PARAMETER AutoFix
    Hata yakalandiginda otomatik kod yazma/duzeltme modunu etkinlestirir (varsayilan aciktir).
.PARAMETER MonitorOnly
    Dosyalara yazmadan yalnizca canli hata izleme modunda calisir.
.PARAMETER AutoPush
    Test kapisi yesil gectiginde hedefli degisiklikleri commit + git push origin main yapar.
.PARAMETER Writer
    Yazma motoru secimi: auto (Groq patch -> Codex yedek), patch, codex.
.PARAMETER WatchLogs
    Ek olarak izlenecek sunucu/uygulama log dosya yollari.
.EXAMPLE
    .\start-watchdog-agent.ps1 -LaunchWindow
    .\start-watchdog-agent.ps1 -AutoFix -Writer auto
    .\start-watchdog-agent.ps1 -MonitorOnly
#>
param(
    [switch]$LaunchWindow,
    [switch]$AutoFix,
    [switch]$MonitorOnly,
    [switch]$AutoPush,
    [ValidateSet("auto", "patch", "codex")]
    [string]$Writer = "auto",
    [string[]]$WatchLogs = @(),
    [int]$PollSeconds = 2,
    [int]$CooldownSeconds = 300
)

$ErrorActionPreference = "Continue"
$RepoRoot = $PSScriptRoot
$AutofixScript = Join-Path $RepoRoot "scripts\agentic_autofix.ps1"
$LogFile = Join-Path $RepoRoot ".cache\runtime_errors.jsonl"

# Normalise -WatchLogs if passed comma-joined via powershell -File
$NormalizedWatchLogs = @()
foreach ($entry in @($WatchLogs)) {
    if ([string]::IsNullOrWhiteSpace($entry)) { continue }
    foreach ($part in ($entry -split ",")) {
        $trimmed = $part.Trim()
        if ($trimmed) { $NormalizedWatchLogs += $trimmed }
    }
}

$EffectiveAutoFix = $true
if ($MonitorOnly) {
    $EffectiveAutoFix = $false
} elseif ($AutoFix) {
    $EffectiveAutoFix = $true
}

function Format-WinArg([string]$Value) {
    if ($null -eq $Value) { return '""' }
    $escaped = $Value.Replace('"', '\"')
    return '"' + $escaped + '"'
}

if ($LaunchWindow) {
    $argTokens = @(
        "-NoExit",
        "-ExecutionPolicy", "Bypass",
        "-File", (Format-WinArg $PSCommandPath),
        "-Writer", (Format-WinArg $Writer),
        "-PollSeconds", "$PollSeconds",
        "-CooldownSeconds", "$CooldownSeconds"
    )
    if ($MonitorOnly) {
        $argTokens += "-MonitorOnly"
    } else {
        $argTokens += "-AutoFix"
    }
    if ($AutoPush) { $argTokens += "-AutoPush" }
    if ($NormalizedWatchLogs.Count -gt 0) {
        $argTokens += @("-WatchLogs", (Format-WinArg ($NormalizedWatchLogs -join ",")))
    }

    $proc = Start-Process -FilePath "powershell.exe" -ArgumentList ($argTokens -join " ") -WorkingDirectory $RepoRoot -PassThru
    Write-Host "[GOZCU] Yeni PowerShell penceresi acildi (PID: $($proc.Id))." -ForegroundColor Green
    exit 0
}

try {
    $Host.UI.RawUI.WindowTitle = "BIST Otonom Hata Tamir Ajani (Self-Writing Watchdog)"
    Clear-Host
} catch {}

$modeLabel = if ($EffectiveAutoFix) { "Tam Otonom Yazici (Self-Writing Autofix | Writer=$Writer)" } else { "Yalnizca Izleme (-MonitorOnly)" }
if ($EffectiveAutoFix -and $AutoPush) { $modeLabel += " + AutoPush" }

Write-Host @"
================================================================================
   BIST ANALIZI — OTONOM SELF-WRITING GOZCU AJANI v2.0
================================================================================
   * Mod             : $modeLabel
   * Telemetri Logu  : .cache\runtime_errors.jsonl
   * Ek Loglar       : $(if ($NormalizedWatchLogs.Count -gt 0) { $NormalizedWatchLogs -join ", " } else { "(yok)" })
   * Tamir Motoru    : scripts\agentic_autofix.ps1
   * Cooldown        : $CooldownSeconds sn (yinelenen hata tekillestirme)
================================================================================
"@ -ForegroundColor Cyan

$cacheDir = Split-Path -Parent $LogFile
if (-not (Test-Path $cacheDir)) {
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
}
if (-not (Test-Path $LogFile)) {
    New-Item -ItemType File -Path $LogFile -Force | Out-Null
}

function Get-ErrorFingerprint([string]$Source, [string]$Message, [string]$Stack) {
    $firstLine = ""
    if ($Stack) {
        $split = @($Stack -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        if ($split.Count -gt 0) { $firstLine = $split[0].Trim() }
    }
    $norm = ("$Source|$Message|$firstLine").ToLowerInvariant()
    $norm = [regex]::Replace($norm, "\b\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}:\d{2}[^\s]*", "<ts>")
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($norm)
        $hashBytes = $sha.ComputeHash($bytes)
        return ([System.BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

$SeenFingerprints = @{}

function Test-ShouldProcessFingerprint([string]$Fingerprint) {
    $now = Get-Date
    # Eski kayitlari temizle (30 dk ustu)
    $expired = @()
    foreach ($k in @($SeenFingerprints.Keys)) {
        if (($now - $SeenFingerprints[$k]).TotalSeconds -gt 1800) {
            $expired += $k
        }
    }
    foreach ($k in $expired) { $SeenFingerprints.Remove($k) }

    if ($SeenFingerprints.ContainsKey($Fingerprint)) {
        $elapsed = ($now - $SeenFingerprints[$Fingerprint]).TotalSeconds
        if ($elapsed -lt $CooldownSeconds) {
            return $false
        }
    }
    $SeenFingerprints[$Fingerprint] = $now
    return $true
}

function Invoke-WatchdogRepair([string]$Message, [string]$Source, [string]$Url, [string]$Stack, [string]$UserAgent) {
    $fp = Get-ErrorFingerprint -Source $Source -Message $Message -Stack $Stack
    if (-not (Test-ShouldProcessFingerprint -Fingerprint $fp)) {
        Write-Host "[ATLANDI - COOLDOWN] Yinelenen hata ($CooldownSeconds sn icinde): $Message" -ForegroundColor DarkGray
        return
    }

    try { [Console]::Beep(1000, 180) } catch {}
    Write-Host ("`n" + ("=" * 80)) -ForegroundColor Red
    Write-Host ("YENI HATA YAKALANDI! [" + (Get-Date -Format "HH:mm:ss") + "]") -ForegroundColor Red
    Write-Host ("=" * 80) -ForegroundColor Red
    Write-Host "  Mesaj : $Message" -ForegroundColor White
    Write-Host "  Kaynak: $Source" -ForegroundColor Gray
    if ($Url) { Write-Host "  URL   : $Url" -ForegroundColor Gray }

    if (-not $EffectiveAutoFix) {
        Write-Host "[MONITOR-ONLY] Otomatik yazma kapali (-MonitorOnly). Manuel tetiklemek icin scripts\agentic_autofix.ps1 kullanin." -ForegroundColor Yellow
        return
    }

    if (-not (Test-Path $AutofixScript)) {
        Write-Warning "Tamir motoru bulunamadi: $AutofixScript"
        return
    }

    $tmpErrFile = [System.IO.Path]::GetTempFileName()
    try {
        $combinedText = $Message
        if ($Stack) { $combinedText = "$Message`n$Stack" }
        Set-Content -Path $tmpErrFile -Value $combinedText -Encoding UTF8

        $fixArgs = @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", $AutofixScript,
            "-ErrorFile", $tmpErrFile,
            "-Source", $Source,
            "-Writer", $Writer
        )
        if ($Url) { $fixArgs += @("-Url", $Url) }
        if ($UserAgent) { $fixArgs += @("-UserAgent", $UserAgent) }
        if ($AutoPush) { $fixArgs += "-AutoPush" }

        Write-Host "[TAMIR BASLADI] scripts\agentic_autofix.ps1 calistiriliyor..." -ForegroundColor Magenta
        & powershell.exe @fixArgs
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[GOZCU] Duzeltme ve test kapisi BASARILI." -ForegroundColor Green
        } else {
            Write-Host "[GOZCU] Tamir uygulanamadi veya geri alindi (ExitCode: $LASTEXITCODE)." -ForegroundColor Yellow
        }
    } finally {
        Remove-Item -LiteralPath $tmpErrFile -Force -ErrorAction SilentlyContinue
    }
}

# Dosya satir imleclerini baslat
$TelemetryCursor = @(Get-Content -Path $LogFile -Encoding UTF8 -ErrorAction SilentlyContinue).Count
$ExtraLogCursors = @{}
foreach ($extraPath in $NormalizedWatchLogs) {
    if (Test-Path $extraPath -PathType Leaf) {
        $ExtraLogCursors[$extraPath] = @(Get-Content -Path $extraPath -Encoding UTF8 -ErrorAction SilentlyContinue).Count
    } else {
        $ExtraLogCursors[$extraPath] = 0
    }
}

$ErrorPattern = "Traceback \(most recent call last\)|SyntaxError:|Unhandled(?:Rejection| Exception)|FATAL|TypeError:|ReferenceError:"
Write-Host "`n[GOZCU AKTIF] Dinleniyor... Hata geldiginde otomatik duzeltme uygulanacaktir.`n" -ForegroundColor Green

while ($true) {
    Start-Sleep -Seconds $PollSeconds

    # 1. JSONL telemetri logunu tara
    $currentLines = @(Get-Content -Path $LogFile -Encoding UTF8 -ErrorAction SilentlyContinue)
    if ($currentLines.Count -lt $TelemetryCursor) {
        # Dosya kesildiyse/yenilendiyse imleci sifirla
        $TelemetryCursor = 0
    }
    if ($currentLines.Count -gt $TelemetryCursor) {
        $newEntries = $currentLines[$TelemetryCursor..($currentLines.Count - 1)]
        $TelemetryCursor = $currentLines.Count

        foreach ($line in $newEntries) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $err = $null
            try { $err = $line | ConvertFrom-Json } catch { continue }
            if ($null -eq $err) { continue }

            $msg = "$($err.message)"
            $src = if ($err.source) { "$($err.source)" } else { "telemetry" }
            $urlVal = if ($err.url) { "$($err.url)" } else { "" }
            $stackVal = if ($err.stack) { "$($err.stack)" } else { "" }
            $uaVal = if ($err.userAgent) { "$($err.userAgent)" } else { "" }

            Invoke-WatchdogRepair -Message $msg -Source $src -Url $urlVal -Stack $stackVal -UserAgent $uaVal
        }
    }

    # 2. Opsiyonel sunucu metin loglarini tara (-WatchLogs)
    foreach ($extraPath in $NormalizedWatchLogs) {
        if (-not (Test-Path $extraPath -PathType Leaf)) { continue }
        $logLines = @(Get-Content -Path $extraPath -Encoding UTF8 -ErrorAction SilentlyContinue)
        $cursor = [int]$ExtraLogCursors[$extraPath]
        if ($logLines.Count -lt $cursor) { $cursor = 0 }
        if ($logLines.Count -gt $cursor) {
            $newSlice = $logLines[$cursor..($logLines.Count - 1)]
            $ExtraLogCursors[$extraPath] = $logLines.Count

            for ($i = 0; $i -lt $newSlice.Count; $i++) {
                $ln = $newSlice[$i]
                if ($ln -match $ErrorPattern -and $ln -notmatch "\[TELEMETRY ERROR CAUGHT\]") {
                    $endIdx = [Math]::Min($newSlice.Count - 1, $i + 15)
                    $snippet = ($newSlice[$i..$endIdx] -join "`n")
                    Invoke-WatchdogRepair -Message $ln.Trim() -Source ("log:" + (Split-Path -Leaf $extraPath)) -Url "" -Stack $snippet -UserAgent ""
                    $i = $endIdx
                }
            }
        }
    }
}
