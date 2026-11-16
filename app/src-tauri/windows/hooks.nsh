; Tauri NSIS installer hooks — see bundle.windows.nsis.installerHooks
; Firewall rules are NOT applied here (ExecWait netsh flashes consoles and often
; fails under currentUser installs). Use Install-PeerChat.ps1 at setup time or
; Settings → Network → Allow LAN through Firewall after install.

!macro NSIS_HOOK_POSTINSTALL
  ; Right-click "Share in PeerChat" (HKCU — no admin).
  WriteRegStr HKCU "Software\Classes\*\shell\ShareInPeerChat" "" "Share in PeerChat"
  WriteRegStr HKCU "Software\Classes\*\shell\ShareInPeerChat" "Icon" "$INSTDIR\PeerChat.exe,0"
  WriteRegStr HKCU "Software\Classes\*\shell\ShareInPeerChat" "MUIVerb" "Share in PeerChat"
  WriteRegStr HKCU "Software\Classes\*\shell\ShareInPeerChat\command" "" '"$INSTDIR\PeerChat.exe" --share "%1"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\*\shell\ShareInPeerChat"
!macroend
