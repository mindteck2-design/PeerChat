# PeerTalk per-user installer (no admin / no NSIS required).
# Usage:
#   powershell -ExecutionPolicy Bypass -File install_peertalk.ps1
#   powershell -ExecutionPolicy Bypass -File install_peertalk.ps1 -SourceExe "D:\path\PeerTalk.exe"
param(
  [string]$SourceExe = "",
  [switch]$NoDesktopShortcut
)

$ErrorActionPreference = "Stop"
$ProductName = "PeerTalk"
$Publisher = "PeerTalk"
$InstallRoot = Join-Path $env:LOCALAPPDATA "Programs\PeerTalk"
$ExeName = "PeerTalk.exe"
$UninstallName = "Uninstall PeerTalk.bat"
$VersionFile = "VERSION.txt"

function Get-ScriptDir {
  if ($PSScriptRoot) { return $PSScriptRoot }
  return Split-Path -Parent $MyInvocation.MyCommand.Path
}

$here = Get-ScriptDir
if (-not $SourceExe) {
  $candidates = @(
    (Join-Path $here $ExeName),
    (Join-Path $here "..\..\dist\windows\$ExeName"),
    (Join-Path (Get-Location) $ExeName)
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $SourceExe = (Resolve-Path $c).Path; break }
  }
}
if (-not $SourceExe -or -not (Test-Path $SourceExe)) {
  Write-Error "Could not find PeerTalk.exe next to this script. Pass -SourceExe."
}

$version = "0.0.0"
$verBeside = Join-Path (Split-Path -Parent $SourceExe) $VersionFile
if (Test-Path $verBeside) {
  $version = (Get-Content $verBeside -Raw).Trim()
} else {
  try {
    $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($SourceExe).ProductVersion
    if (-not $version) { $version = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($SourceExe).FileVersion }
  } catch {}
  if (-not $version) { $version = "0.2.0" }
}

Write-Host "Installing $ProductName $version ..."
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

# Stop running instance so we can overwrite (update path).
Get-Process -Name "PeerTalk","lanmsg" -ErrorAction SilentlyContinue | ForEach-Object {
  try { $_.CloseMainWindow() | Out-Null } catch {}
}
Start-Sleep -Milliseconds 400
Get-Process -Name "PeerTalk","lanmsg" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$destExe = Join-Path $InstallRoot $ExeName
Copy-Item -Force $SourceExe $destExe
Set-Content -Path (Join-Path $InstallRoot $VersionFile) -Value $version -Encoding ASCII

# Uninstaller
$uninstallBat = Join-Path $InstallRoot $UninstallName
@"
@echo off
echo Uninstalling PeerTalk...
taskkill /IM PeerTalk.exe /F >nul 2>&1
taskkill /IM lanmsg.exe /F >nul 2>&1
set "SM=%APPDATA%\Microsoft\Windows\Start Menu\Programs\PeerTalk"
if exist "%SM%" rmdir /s /q "%SM%"
del /f /q "%USERPROFILE%\Desktop\PeerTalk.lnk" >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PeerTalk" /f >nul 2>&1
cd /d "%LOCALAPPDATA%\Programs"
rmdir /s /q "PeerTalk"
echo Done.
pause
"@ | Set-Content -Path $uninstallBat -Encoding ASCII

# Shortcuts
$wsh = New-Object -ComObject WScript.Shell
$startDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\PeerTalk"
New-Item -ItemType Directory -Force -Path $startDir | Out-Null
$startLnk = Join-Path $startDir "PeerTalk.lnk"
$sc = $wsh.CreateShortcut($startLnk)
$sc.TargetPath = $destExe
$sc.WorkingDirectory = $InstallRoot
$sc.Description = "PeerTalk $version"
$sc.Save()

$unLnk = Join-Path $startDir "Uninstall PeerTalk.lnk"
$usc = $wsh.CreateShortcut($unLnk)
$usc.TargetPath = $uninstallBat
$usc.WorkingDirectory = $InstallRoot
$usc.Description = "Uninstall PeerTalk"
$usc.Save()

if (-not $NoDesktopShortcut) {
  $desk = [Environment]::GetFolderPath("Desktop")
  $deskLnk = Join-Path $desk "PeerTalk.lnk"
  $dsc = $wsh.CreateShortcut($deskLnk)
  $dsc.TargetPath = $destExe
  $dsc.WorkingDirectory = $InstallRoot
  $dsc.Description = "PeerTalk $version"
  $dsc.Save()
}

# Add/Remove Programs (current user)
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PeerTalk"
New-Item -Path $uninstallKey -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "DisplayName" -Value "$ProductName $version" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "DisplayVersion" -Value $version -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "Publisher" -Value $Publisher -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "InstallLocation" -Value $InstallRoot -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "DisplayIcon" -Value $destExe -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "UninstallString" -Value "`"$uninstallBat`"" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "NoModify" -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $uninstallKey -Name "NoRepair" -Value 1 -PropertyType DWord -Force | Out-Null

Write-Host ""
Write-Host "Installed: $destExe"
Write-Host "Version:   $version"
Write-Host "Start Menu + Desktop shortcuts created."
Write-Host "Later updates: run this installer again with a newer PeerTalk.exe (same folder)."
Write-Host ""
$launch = Read-Host "Launch PeerTalk now? [Y/n]"
if ($launch -eq "" -or $launch -match '^[Yy]') {
  Start-Process $destExe
}
