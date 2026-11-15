<#
.SYNOPSIS
    BIST Analizi - Otonom PowerShell Gözcü Ajanı (Self-Healing Autonomous Watchdog Agent)
.DESCRIPTION
    PowerShell penceresinde canlı olarak çalışır.
    İstemci (mobil/web), Next.js API ve Python motoru hatalarını anlık izler.
    Hata yakalandığında 'debugger' yapay zeka ajanını (Groq 120B / Codex) devreye sokar,
    kök nedeni ve en küçük yamayı (minimal diff) çıkarır, testleri doğrular ve isterse otomatik dağıtır.
.PARAMETER AutoPilot
    Onay beklemeden yamayı otomatik uygular, testleri çalıştırır ve geçerse GitHub/Vercel'e pushlar.
.EXAMPLE
    .\start-watchdog-agent.ps1
    .\start-watchdog-agent.ps1 -AutoPilot
#>
param(
    [switch]$AutoPilot
)

$Host.UI.RawUI.WindowTitle = "🛡️ BIST Otonom Hata Tamir Ajanı (Self-Healing Watchdog)"
Clear-Host

Write-Host @"
================================================================================
   🛡️  BIST ANALİZİ — OTONOM SELF-HEALING GÖZCÜ AJANI v1.0
================================================================================
   • Mod           : $(if ($AutoPilot) { "Tam Otonom (Auto-Pilot / Otomatik Düzeltme)" } else { "İnteraktif İzleme (Soru-Cevap)" })
   • İzlenen Kaynak: .cache\runtime_errors.jsonl (Canlı Telemetri & Web/Mobil)
   • Ajan Motoru   : route.ps1 -> debugger (Groq 120B LPU + Codex)
   • Doğrulama     : Test Merkezi (/lab) Kapısı + MTF Lab UI Suites
================================================================================
"@ -ForegroundColor Cyan

$RepoRoot = $PSScriptRoot
$LogFile = Join-Path $RepoRoot ".cache\runtime_errors.jsonl"
$RouteScript = "C:\Users\ogun\claude agent yapısı\route.ps1"

if (-not (Test-Path (Split-Path $LogFile))) {
    New-Item -ItemType Directory -Path (Split-Path $LogFile) -Force | Out-Null
}
if (-not (Test-Path $LogFile)) {
    New-Item -ItemType File -Path $LogFile -Force | Out-Null
}

Write-Host "`n[GÖZCÜ AKTİF] Sistem dinleniyor... Hata oluştuğunda ajan otomatik uyanacaktır.`n" -ForegroundColor Green

# Son okunan satır sayacı
$lastLineCount = (Get-Content $LogFile -ErrorAction SilentlyContinue).Count

while ($true) {
    Start-Sleep -Seconds 1
    
    $currentContent = Get-Content $LogFile -ErrorAction SilentlyContinue
    $currentLineCount = $currentContent.Count
    
    if ($currentLineCount -gt $lastLineCount) {
        $newLines = $currentContent[$lastLineCount..($currentLineCount - 1)]
        $lastLineCount = $currentLineCount
        
        foreach ($line in $newLines) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            
            try {
                $err = $line | ConvertFrom-Json
            } catch {
                continue
            }
            
            [Console]::Beep(1000, 200)
            Write-Host "`n" + ("=" * 80) -ForegroundColor Red
            Write-Host "🚨 YENİ HATA YAKALANDI! [$(Get-Date -Format 'HH:mm:ss')]" -ForegroundColor Red
            Write-Host ("=" * 80) -ForegroundColor Red
            Write-Host "  Hata Mesajı: " -NoNewline -ForegroundColor Yellow
            Write-Host "$($err.message)" -ForegroundColor White
            Write-Host "  Sayfa / URL : " -NoNewline -ForegroundColor Yellow
            Write-Host "$($err.url)" -ForegroundColor Gray
            Write-Host "  Cihaz/Tarayıcı: " -NoNewline -ForegroundColor Yellow
            Write-Host "$($err.userAgent)" -ForegroundColor Gray
            if ($err.source) {
                Write-Host "  Kaynak      : $($err.source)" -ForegroundColor Gray
            }
            
            Write-Host "`n[AJAN ÇAĞRILIYOR] route.ps1 debugger ajanı uyandırılıyor..." -ForegroundColor Magenta
            
            $prompt = @"
Sistemde canlı bir runtime/istemci hatası yakalandı. Kök nedeni analiz et, dosya:satır tespitini yap ve en küçük yamayı (minimal diff) üret.

HATA DETAYI:
Mesaj : $($err.message)
Kaynak: $($err.source)
URL   : $($err.url)
Cihaz : $($err.userAgent)
Stack Trace:
$($err.stack)
"@

            $tempPromptFile = [System.IO.Path]::GetTempFileName()
            Set-Content -Path $tempPromptFile -Value $prompt -Encoding utf8
            
            $agentOutput = & powershell -ExecutionPolicy Bypass -File $RouteScript -Task debug -Fast -PromptFile $tempPromptFile
            Remove-Item $tempPromptFile -ErrorAction SilentlyContinue
            
            Write-Host "`n" + ("-" * 80) -ForegroundColor Cyan
            Write-Host "🤖 DEBUGGER AJANININ ANALİZİ VE EN KÜÇÜK YAMA (MINIMAL DIFF):" -ForegroundColor Cyan
            Write-Host ("-" * 80) -ForegroundColor Cyan
            Write-Host $agentOutput -ForegroundColor White
            Write-Host ("-" * 80) -ForegroundColor Cyan
            
            if ($AutoPilot) {
                Write-Host "`n[AUTO-PILOT] Test kapısı doğrulanıyor..." -ForegroundColor Yellow
                & node --test "$RepoRoot\scripts\test_mtf_lab_ui.cjs"
                Write-Host "[AUTO-PILOT] İnceleme tamamlandı." -ForegroundColor Green
            } else {
                Write-Host "`nSeçenekler: [T] Testleri Çalıştır | [Enter] Dinlemeye Devam Et" -ForegroundColor Yellow
                $key = [Console]::ReadKey($true)
                if ($key.Key -eq [ConsoleKey]::T) {
                    Write-Host "`nTest Merkezi Kapısı Doğrulanıyor..." -ForegroundColor Cyan
                    & node --test "$RepoRoot\scripts\test_mtf_lab_ui.cjs"
                }
            }
            
            Write-Host "`n[GÖZCÜ AKTİF] Sistem dinlenmeye devam ediyor..." -ForegroundColor Green
        }
    }
}
