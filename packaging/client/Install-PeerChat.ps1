# PeerChat per-user installer - no admin rights required.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File Install-PeerChat.ps1
#   powershell -ExecutionPolicy Bypass -File Install-PeerChat.ps1 -SourceExe "D:\path\PeerChat.exe"
#   powershell -ExecutionPolicy Bypass -File Install-PeerChat.ps1 -NoDesktopShortcut -NoShellIntegration
#
# What this does:
#   1. Copies PeerChat.exe to %LOCALAPPDATA%\Programs\PeerChat\
#   2. Creates Start Menu shortcuts (PeerChat + Uninstall)
#   3. Creates a Desktop shortcut (pass -NoDesktopShortcut to skip)
#   4. Registers in Add/Remove Programs (HKCU - no admin needed)
#   5. Registers "Share in PeerChat" in the right-click context menu (HKCU)
#   6. Writes an Uninstall-PeerChat.bat that reverses all of the above
#
# To upgrade: run with a newer PeerChat.exe in the same folder - data is preserved.
# To uninstall: run Uninstall PeerChat from the Start Menu, or Add/Remove Programs.

param(
  [string]$SourceExe        = "",
  [switch]$NoDesktopShortcut,
  [switch]$NoShellIntegration,
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$ProductName   = "PeerChat"
$Publisher     = "PeerChat"
$InstallRoot   = Join-Path $env:LOCALAPPDATA "Programs\PeerChat"
$ExeName       = "PeerChat.exe"
$UninstallName = "Uninstall-PeerChat.bat"
$VersionFile   = "VERSION.txt"
$AppId         = "com.peerchat.app"         # must match tauri.conf.json identifier
$LegacyAppId   = "com.lanmsg.app"
$RegUninstall  = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId"
$ShellVerbKey  = "HKCU:\Software\Classes\*\shell\ShareInPeerChat"

function Write-Step([string]$msg) {
    if (-not $Quiet) { Write-Host "  $msg" }
}

# -- Locate source exe -------------------------------------------------------
function Get-ScriptDir {
    if ($PSScriptRoot) { return $PSScriptRoot }
    return Split-Path -Parent $MyInvocation.MyCommand.Path
}

$here = Get-ScriptDir
if (-not $SourceExe) {
    $candidates = @(
        (Join-Path $here $ExeName),
        (Join-Path $here "..\..\app\src-tauri\target\release\peerchat.exe"),
        (Join-Path $here "..\..\app\src-tauri\target\release\$ExeName"),
        (Join-Path (Get-Location) $ExeName)
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $SourceExe = (Resolve-Path $c).Path; break }
    }
}
if (-not $SourceExe -or -not (Test-Path $SourceExe)) {
    Write-Error "Cannot find $ExeName next to this script. Pass -SourceExe <path>."
}

# -- Determine version --------------------------------------------------------
$version = "1.0.0"
$verBeside = Join-Path (Split-Path -Parent $SourceExe) $VersionFile
if (Test-Path $verBeside) {
    $version = (Get-Content $verBeside -Raw).Trim()
} else {
    try {
        $fvi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($SourceExe)
        $version = $fvi.ProductVersion
        if (-not $version) { $version = $fvi.FileVersion }
    } catch {}
    if (-not $version) { $version = "1.0.0" }
}

if (-not $Quiet) {
    Write-Host ""
    Write-Host "Installing $ProductName $version ..." -ForegroundColor Cyan
}

# -- Stop any running instance ------------------------------------------------
Get-Process -Name "PeerChat","peerchat","lanmsg" -ErrorAction SilentlyContinue | ForEach-Object {
    try { $_.CloseMainWindow() | Out-Null } catch {}
}
Start-Sleep -Milliseconds 500
Get-Process -Name "PeerChat","peerchat","lanmsg" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

# -- Copy exe -----------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$destExe = Join-Path $InstallRoot $ExeName
Copy-Item -Force $SourceExe $destExe
Set-Content -Path (Join-Path $InstallRoot $VersionFile) -Value $version -Encoding ASCII
Write-Step "Copied $ExeName → $InstallRoot"

# -- Write uninstaller batch ---------------------------------------------------
# Important: cannot rmdir the install folder while this .bat is still running from
# it (Windows locks the path). We finish registry/shortcuts here, then hand off a
# short cleaner in %TEMP% that deletes the folder after we exit.
$uninstallBat = Join-Path $InstallRoot $UninstallName
@"
@echo off
setlocal
set "SILENT=0"
if /I "%~1"=="/S" set "SILENT=1"
if /I "%~1"=="/silent" set "SILENT=1"

echo Uninstalling $ProductName...
taskkill /IM PeerChat.exe /F >nul 2>&1
taskkill /IM peerchat.exe /F >nul 2>&1
taskkill /IM lanmsg.exe   /F >nul 2>&1
timeout /t 1 /nobreak >nul

:: Remove Start Menu folder
set "SM=%APPDATA%\Microsoft\Windows\Start Menu\Programs\PeerChat"
if exist "%SM%" rmdir /s /q "%SM%"

:: Remove Desktop shortcut
del /f /q "%USERPROFILE%\Desktop\PeerChat.lnk"   >nul 2>&1
del /f /q "%PUBLIC%\Desktop\PeerChat.lnk"        >nul 2>&1

:: Remove Add/Remove Programs entry (current + legacy id)
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\$LegacyAppId" /f >nul 2>&1

:: Remove "Share in PeerChat" context menu
reg delete "HKCU\Software\Classes\*\shell\ShareInPeerChat" /f >nul 2>&1

:: Delete install dir from TEMP so this script is not locking the folder
set "INSTALL=%LOCALAPPDATA%\Programs\PeerChat"
set "CLEAN=%TEMP%\PeerChat-uninstall-clean.cmd"
(
  echo @echo off
  echo timeout /t 2 /nobreak ^>nul
  echo rmdir /s /q "%INSTALL%" 2^>nul
  echo if exist "%INSTALL%" ^(
  echo   timeout /t 2 /nobreak ^>nul
  echo   rmdir /s /q "%INSTALL%" 2^>nul
  echo ^)
  echo del /f /q "%%~f0" ^>nul 2^>^&1
) > "%CLEAN%"
start "" /min cmd /c "%CLEAN%"

echo.
echo $ProductName has been uninstalled.
echo Chat data in %%APPDATA%%\com.peerchat.app was NOT removed.
if "%SILENT%"=="0" pause
endlocal
"@ | Set-Content -Path $uninstallBat -Encoding ASCII
Write-Step "Wrote $UninstallName"

# -- Start Menu shortcuts -----------------------------------------------------
$wsh      = New-Object -ComObject WScript.Shell
$startDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\PeerChat"
New-Item -ItemType Directory -Force -Path $startDir | Out-Null

# Sidecar .ico next to the exe — shortcuts must use "path,0" or Windows stores ",0".
$iconSidecar = Join-Path $InstallRoot "PeerChat.ico"
$iconSources = @(
  (Join-Path $here "PeerChat.ico"),
  (Join-Path $here "peerchat-nsis.ico"),
  (Join-Path (Split-Path -Parent $SourceExe) "PeerChat.ico"),
  (Join-Path (Split-Path -Parent $SourceExe) "peerchat-nsis.ico")
)
foreach ($src in $iconSources) {
  if ($src -and (Test-Path $src)) {
    Copy-Item -Force $src $iconSidecar
    break
  }
}
if (-not (Test-Path $iconSidecar)) {
  Write-Step "WARNING: PeerChat.ico missing beside installer — shortcuts will use exe icon"
}
# Always include the icon index; bare paths sometimes persist as broken ",0".
$iconLoc = if (Test-Path $iconSidecar) { "$iconSidecar,0" } else { "$destExe,0" }

$startLnk = Join-Path $startDir "PeerChat.lnk"
$sc = $wsh.CreateShortcut($startLnk)
$sc.TargetPath       = $destExe
$sc.WorkingDirectory = $InstallRoot
$sc.Description      = "PeerChat $version - secure LAN messenger"
$sc.IconLocation     = $iconLoc
$sc.Save()

$unLnk = Join-Path $startDir "Uninstall PeerChat.lnk"
$usc = $wsh.CreateShortcut($unLnk)
$usc.TargetPath       = $uninstallBat
$usc.WorkingDirectory = $InstallRoot
$usc.Description      = "Uninstall PeerChat"
$usc.IconLocation     = $iconLoc
$usc.Save()
Write-Step "Created Start Menu shortcuts"

# -- Desktop shortcut ---------------------------------------------------------
if (-not $NoDesktopShortcut) {
    $desk    = [Environment]::GetFolderPath("Desktop")
    $deskLnk = Join-Path $desk "PeerChat.lnk"
    $dsc = $wsh.CreateShortcut($deskLnk)
    $dsc.TargetPath       = $destExe
    $dsc.WorkingDirectory = $InstallRoot
    $dsc.Description      = "PeerChat $version"
    $dsc.IconLocation     = $iconLoc
    $dsc.Save()
    Write-Step "Created Desktop shortcut"
}

# -- Add/Remove Programs (HKCU - no admin) -----------------------------------
# Windows Settings often fails to launch a bare .bat UninstallString — wrap in cmd.
New-Item -Path $RegUninstall -Force | Out-Null
$uninstallCmd = "cmd.exe /C `"`"$uninstallBat`"`""
$quietCmd     = "cmd.exe /C `"`"$uninstallBat`" /S`""
$estKb = [int]([math]::Ceiling(([System.IO.FileInfo]$destExe).Length / 1024.0))
$props = @{
    DisplayName          = "$ProductName $version"
    DisplayVersion       = $version
    Publisher            = $Publisher
    InstallLocation      = $InstallRoot
    DisplayIcon          = $iconLoc
    UninstallString      = $uninstallCmd
    QuietUninstallString = $quietCmd
    NoModify             = 1
    NoRepair             = 1
    EstimatedSize        = $estKb
}
foreach ($k in $props.Keys) {
    $type = if ($props[$k] -is [int]) { "DWord" } else { "String" }
    New-ItemProperty -Path $RegUninstall -Name $k -Value $props[$k] -PropertyType $type -Force | Out-Null
}
# Drop the old LanMsg uninstall entry if present.
Remove-Item -Recurse -Force "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$LegacyAppId" -ErrorAction SilentlyContinue
Write-Step "Registered in Add/Remove Programs (HKCU)"

# -- Windows Firewall (best-effort; may need elevation on locked-down PCs) -----
try {
    $ruleName = "PeerChat LAN"
    netsh advfirewall firewall delete rule name="$ruleName" >$null 2>&1
    netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow program="$destExe" protocol=UDP profile=any enable=yes >$null 2>&1
    netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow program="$destExe" protocol=TCP profile=any enable=yes >$null 2>&1
    Write-Step "Firewall: allowed inbound TCP/UDP for PeerChat (all profiles)"
} catch {
    Write-Step "Firewall: could not add rules automatically — allow PeerChat when Windows asks"
}

# -- Right-click shell integration --------------------------------------------
if (-not $NoShellIntegration) {
    # Register "Share in PeerChat" verb for all file types (HKCU - no admin).
    New-Item -Path "$ShellVerbKey"          -Force | Out-Null
    New-Item -Path "$ShellVerbKey\command"  -Force | Out-Null

    Set-ItemProperty -Path $ShellVerbKey -Name "(default)" -Value "Share in PeerChat"
    Set-ItemProperty -Path $ShellVerbKey -Name "Icon"      -Value $iconLoc
    # MUIVerb makes the verb appear on the top-level context menu (not under "Show more options")
    Set-ItemProperty -Path $ShellVerbKey -Name "MUIVerb"   -Value "Share in PeerChat"

    $cmdValue = "`"$destExe`" --share `"%1`""
    Set-ItemProperty -Path "$ShellVerbKey\command" -Name "(default)" -Value $cmdValue

    Write-Step "Registered 'Share in PeerChat' in right-click context menu"
    Write-Step "(Right-click any file in Explorer → 'Share in PeerChat')"
}

# -- Done ----------------------------------------------------------------------
if (-not $Quiet) {
    Write-Host ""
    Write-Host "Installed: $destExe" -ForegroundColor Green
    Write-Host "Version:   $version"
    if (-not $NoDesktopShortcut) { Write-Host "Desktop shortcut created." }
    Write-Host "Start Menu: Programs\PeerChat"
    Write-Host "To uninstall: Start Menu > PeerChat > Uninstall PeerChat"
    Write-Host ""
    Write-Host "Tip: Right-click any file in Explorer and choose 'Share in PeerChat'" `
               -ForegroundColor Cyan
    Write-Host ""

    $launch = Read-Host "Launch PeerChat now? [Y/n]"
    if ($launch -eq "" -or $launch -match '^[Yy]') {
        Start-Process $destExe
    }
}
