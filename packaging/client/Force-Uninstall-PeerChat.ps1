# Force-remove a stuck PeerChat per-user install (no rebuild needed).
# Run:
#   powershell -ExecutionPolicy Bypass -File Force-Uninstall-PeerChat.ps1

$ErrorActionPreference = "Continue"
$AppId = "com.peerchat.app"
$LegacyAppId = "com.lanmsg.app"
$InstallRoot = Join-Path $env:LOCALAPPDATA "Programs\PeerChat"

Write-Host "Stopping PeerChat..." -ForegroundColor Cyan
Get-Process -Name "PeerChat","peerchat","lanmsg" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Write-Host "Removing shortcuts..."
$sm = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\PeerChat"
if (Test-Path $sm) { Remove-Item -Recurse -Force $sm -ErrorAction SilentlyContinue }
$desk = [Environment]::GetFolderPath("Desktop")
Remove-Item -Force (Join-Path $desk "PeerChat.lnk") -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path $env:PUBLIC "Desktop\PeerChat.lnk") -ErrorAction SilentlyContinue

Write-Host "Removing registry entries..."
Remove-Item -Recurse -Force "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$LegacyAppId" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "HKCU:\Software\Classes\*\shell\ShareInPeerChat" -ErrorAction SilentlyContinue

# NSIS / Tauri installer entries (if present)
Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue |
  Where-Object {
    try {
      $dn = (Get-ItemProperty $_.PSPath -ErrorAction Stop).DisplayName
      $dn -like "PeerChat*"
    } catch { $false }
  } |
  ForEach-Object {
    Write-Host "  Removing uninstall key $($_.PSChildName)"
    Remove-Item -Recurse -Force $_.PSPath -ErrorAction SilentlyContinue
  }

Write-Host "Removing install folder..."
if (Test-Path $InstallRoot) {
  # Leave this script's parent alone; delete install root from a delayed cmd.
  $clean = Join-Path $env:TEMP "PeerChat-force-uninstall.cmd"
  @"
@echo off
timeout /t 1 /nobreak >nul
rmdir /s /q "$InstallRoot" 2>nul
if exist "$InstallRoot" (
  timeout /t 2 /nobreak >nul
  rmdir /s /q "$InstallRoot" 2>nul
)
del /f /q "%~f0" >nul 2>&1
"@ | Set-Content -Path $clean -Encoding ASCII
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$clean`"" -WindowStyle Hidden
  Start-Sleep -Seconds 3
}

# Also remove common NSIS per-user install dir used by Tauri
$nsisDirs = @(
  (Join-Path $env:LOCALAPPDATA "PeerChat"),
  (Join-Path $env:APPDATA "PeerChat")
)
foreach ($d in $nsisDirs) {
  if ((Test-Path $d) -and ($d -ne $InstallRoot)) {
    Write-Host "Removing $d ..."
    Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue
  }
}

Write-Host ""
if (Test-Path $InstallRoot) {
  Write-Host "Folder still locked: $InstallRoot" -ForegroundColor Yellow
  Write-Host "Close any Explorer windows open on that folder, then run this script again."
} else {
  Write-Host "PeerChat uninstall cleanup finished." -ForegroundColor Green
}
Write-Host "Chat data was kept in %APPDATA%\com.peerchat.app (and legacy %APPDATA%\com.lanmsg.app if present)."
Write-Host ""
Read-Host "Press Enter to close"
