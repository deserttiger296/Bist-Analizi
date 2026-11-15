@echo off
title BIST Otonom Hata Tamir Ajani (Self-Writing Watchdog)
powershell -ExecutionPolicy Bypass -NoExit -File "%~dp0start-watchdog-agent.ps1" -AutoFix
