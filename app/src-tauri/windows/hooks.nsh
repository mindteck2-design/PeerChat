; Tauri NSIS installer hooks — see bundle.windows.nsis.installerHooks
; Firewall: allow LAN discovery (UDP 41234) + peer TLS (TCP 9876-9899).
; currentUser installs may lack admin; first app launch then prompts UAC.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Configuring Windows Firewall for PeerChat LAN chat..."
  ExecWait 'netsh advfirewall firewall delete rule name="PeerChat LAN"'
  ExecWait 'netsh advfirewall firewall delete rule name="PeerChat Ports"'
  ExecWait 'netsh advfirewall firewall add rule name="PeerChat LAN" dir=in action=allow program="$INSTDIR\PeerChat.exe" protocol=TCP profile=any enable=yes'
  ExecWait 'netsh advfirewall firewall add rule name="PeerChat LAN" dir=in action=allow program="$INSTDIR\PeerChat.exe" protocol=UDP profile=any enable=yes'
  ExecWait 'netsh advfirewall firewall add rule name="PeerChat Ports" dir=in action=allow protocol=TCP localport=9876-9899 profile=any enable=yes'
  ExecWait 'netsh advfirewall firewall add rule name="PeerChat Ports" dir=in action=allow protocol=UDP localport=41234 profile=any enable=yes'

  ; Right-click "Share in PeerChat" (HKCU — no admin).
  WriteRegStr HKCU "Software\Classes\*\shell\ShareInPeerChat" "" "Share in PeerChat"
  WriteRegStr HKCU "Software\Classes\*\shell\ShareInPeerChat" "Icon" "$INSTDIR\PeerChat.exe,0"
  WriteRegStr HKCU "Software\Classes\*\shell\ShareInPeerChat" "MUIVerb" "Share in PeerChat"
  WriteRegStr HKCU "Software\Classes\*\shell\ShareInPeerChat\command" "" '"$INSTDIR\PeerChat.exe" --share "%1"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ExecWait 'netsh advfirewall firewall delete rule name="PeerChat LAN"'
  ExecWait 'netsh advfirewall firewall delete rule name="PeerChat Ports"'
  DeleteRegKey HKCU "Software\Classes\*\shell\ShareInPeerChat"
!macroend
