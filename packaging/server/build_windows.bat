@echo off
setlocal
cd /d "%~dp0..\..\server"
if not exist dist mkdir dist
go mod tidy
go build -ldflags="-s -w" -o dist\lanmsg-server.exe .\cmd\lanmsg-server
if errorlevel 1 exit /b 1
copy /Y config.example.json dist\config.example.json >nul
echo Built server\dist\lanmsg-server.exe
echo.
echo Optional Windows service (NSSM):
echo   nssm install LanMsgServer "%%CD%%\dist\lanmsg-server.exe"
echo   nssm set LanMsgServer AppDirectory "%%CD%%\dist"
echo   nssm set LanMsgServer AppParameters "-config config.json"
echo   nssm start LanMsgServer
endlocal
