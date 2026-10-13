# One-shot: copy PeerChat.ico beside the installed exe and repoint Desktop/Start shortcuts.
# Safe to re-run. Does not rebuild the app.
param(
  [string]$IconSource = ""
)

$ErrorActionPreference = "Stop"

function Resolve-IconSource {
  param([string]$Hint)
  $candidates = @()
  if ($Hint) { $candidates += $Hint }
  if ($PSScriptRoot) {
    $candidates += (Join-Path $PSScriptRoot "PeerChat.ico")
    $candidates += (Join-Path $PSScriptRoot "..\..\app\src-tauri\icons\peerchat-nsis.ico")
    $candidates += (Join-Path $PSScriptRoot "..\..\app\src-tauri\icons\icon.ico")
    $candidates += (Join-Path $PSScriptRoot "..\..\dist\windows\PeerChat-Setup-0.4.2\PeerChat.ico")
  }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { return (Resolve-Path $c).Path }
  }
  throw "Could not find PeerChat.ico. Pass -IconSource <path>."
}

$icoSrc = Resolve-IconSource -Hint $IconSource
$w = New-Object -ComObject WScript.Shell

$roots = @(
  (Join-Path $env:LOCALAPPDATA "Programs\PeerChat"),
  (Join-Path $env:LOCALAPPDATA "PeerChat")
)

$updated = 0
foreach ($root in $roots) {
  if (-not (Test-Path $root)) { continue }

  $sidecar = Join-Path $root "PeerChat.ico"
  Copy-Item -Force $icoSrc $sidecar
  $iconLoc = "$sidecar,0"
  Write-Host "Sidecar: $sidecar"

  $exe =
    @("PeerChat.exe", "peerchat.exe", "lanmsg.exe") |
    ForEach-Object { Join-Path $root $_ } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1

  $links = @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "PeerChat.lnk"),
    (Join-Path $env:PUBLIC "Desktop\PeerChat.lnk"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\PeerChat\PeerChat.lnk"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\PeerChat\Uninstall PeerChat.lnk")
  )

  foreach ($lnk in $links) {
    if (-not (Test-Path $lnk)) { continue }
    $s = $w.CreateShortcut($lnk)
    if ($exe -and $lnk -notlike "*Uninstall*" -and (-not $s.TargetPath -or -not (Test-Path $s.TargetPath))) {
      $s.TargetPath = $exe
      $s.WorkingDirectory = $root
    }
    $s.IconLocation = $iconLoc
    $s.Save()
    (Get-Item $lnk).LastWriteTime = Get-Date
    Write-Host "Updated $lnk"
    Write-Host "  Icon=$($s.IconLocation)"
    $updated++
  }

  foreach ($appId in @("com.peerchat.app", "com.lanmsg.app")) {
    $reg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appId"
    if (Test-Path $reg) {
      Set-ItemProperty -Path $reg -Name DisplayIcon -Value $iconLoc -ErrorAction SilentlyContinue
    }
  }
  $verb = "HKCU:\Software\Classes\*\shell\ShareInPeerChat"
  if (Test-Path $verb) {
    Set-ItemProperty -Path $verb -Name Icon -Value $iconLoc -ErrorAction SilentlyContinue
  }
}

if ($updated -eq 0) {
  Write-Host "No PeerChat shortcuts found to update." -ForegroundColor Yellow
} else {
  Write-Host ""
  Write-Host "Updated $updated shortcut(s) to the new PeerChat icon." -ForegroundColor Green
  Write-Host "If Explorer still shows the old icon, click the desktop and press F5."
}
