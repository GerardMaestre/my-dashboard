@echo off
:: DESC: Instalador desatendido. Instala todo el software base de tu PC en segundo plano (Chrome, Steam, Discord, etc.).
:: ARGS: Ninguno (Pide permisos de Administrador automáticamente)

:: ⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ========
:: NEXUS AUTOPILOT - INSTALADOR MAESTRO DE SOFTWARE
:: ⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ========
color 0b
echo [⚡ NEXUS] Solicitando permisos de Administrador...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs" & exit /B
)

echo ⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS =====
echo     INICIANDO INSTALACION DESATENDIDA DE APPS      
echo ⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS =====
echo.

:: Lista de aplicaciones (puedes añadir o quitar las que quieras separadas por espacio)
set "APPS=EpicGames.EpicGamesLauncher Google.Chrome Valve.Steam Guru3D.Afterburner Discord.Discord Spotify.Spotify GeekUninstaller.GeekUninstaller Microsoft.PCManager.Beta RARLab.WinRAR Ryochan7.DS4Windows Nexova.UpdateHub KeeWeb.KeeWeb"

:: Bucle de instalación optimizado
for %%A in (%APPS%) do (
    echo [NEXUS] Instalando %%A en segundo plano...
    winget install --id=%%A -e --silent --accept-package-agreements --accept-source-agreements >nul 2>&1
    if %errorlevel% equ 0 (
        echo         - Exito.
    ) else (
        echo         - Fallo o ya estaba instalado.
    )
)

echo.
echo ⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS =====
echo [✔ NEXUS -> COMPLETADO] El despliegue de software ha finalizado.
echo ⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS =====
pause