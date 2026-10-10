# Optional: NSIS via browser (only for classic setup wizard)

You do **not** need this for a permanent install. Use `Install-PeerTalk.bat` instead.

NSIS does **not** fix the Windows **“Unknown publisher”** warning. That needs a paid code-signing certificate.

## If you still want a `.exe` setup wizard

1. On a PC/browser that can reach GitHub, download:

   - https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip  
   - https://github.com/tauri-apps/binary-releases/releases/download/nsis-plugins-v0/NSIS-ApplicationID.zip  
   - https://github.com/tauri-apps/nsis-tauri-utils/releases (file `nsis_tauri_utils.dll`)

2. Extract so you have:

   `%LOCALAPPDATA%\tauri\NSIS\`  
   (contents of the `nsis-3.11` folder renamed/moved here — must include `makensis.exe`)

   `%LOCALAPPDATA%\tauri\NSIS\Plugins\x86-unicode\ApplicationID.dll`

   `%LOCALAPPDATA%\tauri\NSIS\Plugins\x86-unicode\additional\nsis_tauri_utils.dll`

3. Then on the build PC:

   ```bat
   cd app
   npm run tauri:build -- --bundles nsis
   ```

4. Installer appears under `app\src-tauri\target\release\bundle\nsis\`.
