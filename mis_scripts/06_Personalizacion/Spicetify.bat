@echo off
chcp 65001 >nul
:: DESC: Inyecta el motor Spicetify en el cliente oficial de Spotify para desbloquear temas visuales, extensiones y letras.
:: ARGS: Ninguno

echo ===================================================
echo     ⚡ HORUS ENGINE - SPICETIFY THEME INJECTOR ⚡    
echo ===================================================
echo.

:: Spicetify no debe ejecutarse como Administrador, o romperá permisos en la carpeta local del usuario
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' EQU '0' (
    echo [X] ERROR: Spicetify NO debe ser ejecutado como Administrador.
    echo [I] Por favor, ejecuta este script de forma normal.
    pause
    exit /B
)

echo [*] Cerrando Spotify de forma forzada para evitar errores...
taskkill /F /IM Spotify.exe >nul 2>&1

echo [*] Descargando el nucleo de Spicetify CLI...
powershell.exe -Command "iwr -useb https://raw.githubusercontent.com/spicetify/spicetify-cli/master/install.ps1 | iex"

echo [*] Descargando la tienda de complementos (Marketplace)...
powershell.exe -Command "iwr -useb https://raw.githubusercontent.com/spicetify/spicetify-marketplace/main/resources/install.ps1 | iex"

echo [*] Aplicando el plugin de Letras (Lyrics-Plus)...
powershell.exe -Command "spicetify config custom_apps lyrics-plus"

echo [*] Horneando e inyectando tema en Spotify...
powershell.exe -Command "spicetify backup apply"

echo.
echo ===================================================
echo [OK] Spicetify instalado. Abre Spotify para ver la magia.
echo ===================================================
pause
