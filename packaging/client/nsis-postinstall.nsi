; NSIS post-install script — called by Tauri's generated NSIS installer after
; the main files are copied.  Registers the "Share in PeerChat" right-click
; verb for all file types (HKCU — no admin required).
;
; Tauri 2 picks this up via tauri.conf.json bundle.windows.nsis.postinstallScript.

Section "ShellIntegration" ShellIntegration_ID
  ; $INSTDIR is set by the Tauri NSIS template to the install directory.
  WriteRegStr HKCU "Software\Classes\*\shell\ShareInPeerChat"          "" "Share in PeerChat"
  WriteRegStr HKCU "Software\Classes\*\shell\ShareInPeerChat"          "Icon"    "$INSTDIR\PeerChat.exe,0"
  WriteRegStr HKCU "Software\Classes\*\shell\ShareInPeerChat"          "MUIVerb" "Share in PeerChat"
  WriteRegStr HKCU "Software\Classes\*\shell\ShareInPeerChat\command"  "" '"$INSTDIR\PeerChat.exe" --share "%1"'
SectionEnd

; Called during uninstall — remove the shell verb.
Section "un.ShellIntegration"
  DeleteRegKey HKCU "Software\Classes\*\shell\ShareInPeerChat"
SectionEnd
