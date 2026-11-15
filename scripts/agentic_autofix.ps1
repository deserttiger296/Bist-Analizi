<#
.SYNOPSIS
    BIST Analizi - Otonom Hata Yakalama ve Ajanlı Otomatik Düzeltme Motoru (Self-Healing Watchdog)
.DESCRIPTION
    Runtime/istemci veya API hatalarını .cache/runtime_errors.jsonl dosyasından okur,
    route.ps1 üzerindeki debugger ajanını (Groq 120B / Codex) devreye sokar,
    kök nedeni ve en küçük yamayı (minimal diff) çıkarır ve test kapısını doğrular.
.EXAMPLE
    .\scripts\agentic_autofix.ps1 -Latest
    .\scripts\agentic_autofix.ps1 -ErrorText "TypeError: Cannot read properties of undefined"
#>
param(
    [switch]$Latest,
    [string]$ErrorText,
    [switch]$Watch,
    [switch]$RunTests
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogFile = Join-Path $RepoRoot ".cache\runtime_errors.jsonl"
$RouteScript = "C:\Users\ogun\claude agent yapısı\route.ps1"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🛡️ BIST OTONOM HATA YAKALAYICI & AJANLI TAMİR MOTORU" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

function Invoke-AgentFix([string]$TargetError, [string]$ContextInfo) {
    Write-Host "`n[1/3] Hata Ajanına Aktarılıyor..." -ForegroundColor Yellow
    Write-Host "Hata Özeti: $TargetError" -ForegroundColor Gray

    $Prompt = @"
Aşağıdaki runtime/istemci hatasını incele, kök nedeni ve en küçük yamayı (minimal diff) üret.
HATA:
$TargetError

BAĞLAM:
$ContextInfo
"@

    if (Test-Path $RouteScript) {
        Write-Host "[2/3] route.ps1 -Task debug -Fast çalıştırılıyor..." -ForegroundColor Magenta
        & powershell -ExecutionPolicy Bypass -File $RouteScript -Task debug -Fast -Prompt $Prompt
    } else {
        Write-Warning "route.ps1 bulunamadı: $RouteScript"
    }

    if ($RunTests) {
        Write-Host "`n[3/3] Test Kapısı Doğrulanıyor..." -ForegroundColor Cyan
        & node --test "$RepoRoot\scripts\test_mtf_lab_ui.cjs"
    }
}

if ($ErrorText) {
    Invoke-AgentFix -TargetError $ErrorText -ContextInfo "Kullanıcı parametresi olarak sağlandı."
    exit 0
}

if ($Latest -or -not $Watch) {
    if (-not (Test-Path $LogFile)) {
        Write-Host "Kayıtlı runtime hatası bulunamadı ($LogFile)." -ForegroundColor Green
        Write-Host "Sistem sağlıklı ve canlı izlemede." -ForegroundColor Green
        exit 0
    }

    $Lines = Get-Content $LogFile -Tail 5
    if ($Lines.Count -eq 0) {
        Write-Host "Hata kaydı boş." -ForegroundColor Green
        exit 0
    }

    $LatestJson = $Lines[-1] | ConvertFrom-Json
    Write-Host "Yakalanan Son Hata:" -ForegroundColor Red
    Write-Host "  Zaman : $($LatestJson.timestamp)" -ForegroundColor Gray
    Write-Host "  URL   : $($LatestJson.url)" -ForegroundColor Gray
    Write-Host "  Kaynak: $($LatestJson.source)" -ForegroundColor Gray
    Write-Host "  Mesaj : $($LatestJson.message)" -ForegroundColor Yellow

    Invoke-AgentFix -TargetError "$($LatestJson.message)`n$($LatestJson.stack)" -ContextInfo "URL: $($LatestJson.url) | UserAgent: $($LatestJson.userAgent)"
    exit 0
}

if ($Watch) {
    Write-Host "Canlı Hata Dinleyici Başlatıldı (.cache\runtime_errors.jsonl izleniyor)..." -ForegroundColor Yellow
    Get-Content $LogFile -Wait -Tail 1 | ForEach-Object {
        try {
            $Err = $_ | ConvertFrom-Json
            Write-Host "`n🚨 YENİ HATA YAKALANDI: $($Err.message)" -ForegroundColor Red
            Invoke-AgentFix -TargetError "$($Err.message)`n$($Err.stack)" -ContextInfo "URL: $($Err.url)"
        } catch {}
    }
}
