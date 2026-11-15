$harnessDir = Join-Path $env:USERPROFILE ("claude agent yap" + [char]0x0131 + "s" + [char]0x0131)
& (Join-Path $harnessDir "check-scripts.ps1") @args
exit $LASTEXITCODE