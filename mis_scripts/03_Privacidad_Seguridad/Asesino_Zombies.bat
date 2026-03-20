:: DESC: Mata todos los procesos inutiles de la RAM (Spotify, Adobe, OneDrive, Edge...)
:: ARGS: Ninguno

@echo off
chcp 65001 >nul
echo [*] Solicitando permisos de Administrador...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs" & exit /B
)

echo ====================================
echo      ⚡ INICIANDO GOD MODE RAM ⚡     
echo ====================================
echo.
echo [*] Asesinando procesos zombis...

taskkill /F /IM "OneDrive.exe" /T 2>nul
taskkill /F /IM "AdobeIPCBroker.exe" /T 2>nul
taskkill /F /IM "CCXProcess.exe" /T 2>nul
taskkill /F /IM "Spotify.exe" /T 2>nul
taskkill /F /IM "Discord.exe" /T 2>nul
taskkill /F /IM "chrome.exe" /T 2>nul
taskkill /F /IM "msedge.exe" /T 2>nul
taskkill /F /IM "YourPhone.exe" /T 2>nul
taskkill /F /IM "Widgets.exe" /T 2>nul
taskkill /F /IM "Skype.exe" /T 2>nul
taskkill /F /IM "Cortana.exe" /T 2>nul
taskkill /F /IM "SearchUI.exe" /T 2>nul
taskkill /F /IM "EpicGamesLauncher.exe" /T 2>nul
taskkill /F /IM "Steam.exe" /T 2>nul
taskkill /F /IM "Razer Synapse 3.exe" /T 2>nul
taskkill /F /IM "Razer Central.exe" /T 2>nul

echo.
echo [V] MEMORIA RAM PURGADA Y LISTA PARA GAMING
exit /b 0