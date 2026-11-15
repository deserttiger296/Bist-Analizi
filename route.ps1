$harnessDir = Join-Path $env:USERPROFILE ("claude agent yap" + [char]0x0131 + "s" + [char]0x0131)
& (Join-Path $harnessDir "route.ps1") @args
exit $LASTEXITCODE