@echo off
chcp 65001 >nul
:: DESC: Actualizador silencioso. Busca y actualiza todo el software de tu PC de golpe usando Winget.
:: ARGS: Ninguno

echo [*] Elevando privilegios para actualizar todo el software...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs" & exit /B
)

echo ===================================================
echo     ⚡ NEXUS AUTOPILOT - ACTUALIZADOR INVISIBLE ⚡     
echo ===================================================
echo.
echo [*] Buscando y descargando actualizaciones de TODO el sistema...
echo [*] Este proceso es silencioso y puede tardar varios minutos.
echo.

winget upgrade --all --include-unknown --silent --accept-package-agreements --accept-source-agreements

echo.
echo ===================================================
echo [OK] Todas las aplicaciones estan en su ultima version.
echo ===================================================