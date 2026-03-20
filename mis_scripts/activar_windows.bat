@echo off
:: DESC: Activa Windows 11 (Home o Pro) conectándose a un servidor KMS de forma segura.
:: ARGS: Ninguno (Tiene menú interactivo)

echo [⚡ NEXUS] Solicitando permisos de Administrador...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs" & exit /B
)

color 0a
echo ⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS =====
echo         ACTIVADOR UNIVERSAL - WINDOWS 11         
echo ⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS =====
echo.
echo Selecciona la edicion de Windows que tienes instalada:
echo.
echo [1] Windows 11 Home
echo [2] Windows 11 Pro
echo [3] Salir
echo.

set /p choice="Ingresa un numero (1-3): "

if "%choice%"=="1" goto home
if "%choice%"=="2" goto pro
if "%choice%"=="3" exit
goto end

:home
echo [⚡ NEXUS] Aplicando clave de Windows 11 Home...
slmgr.vbs -upk
slmgr /ipk 7HNRX-D7KGG-3K4RQ-4WPJ4-YTDFH
goto activate

:pro
echo [⚡ NEXUS] Aplicando clave de Windows 11 Pro...
slmgr.vbs -upk
slmgr /ipk NRG8B-VKK3Q-CXVCJ-9G2XF-6Q84J
goto activate

:activate
echo [⚡ NEXUS] Conectando al servidor KMS...
slmgr /skms kms.digiboy.ir
echo [⚡ NEXUS] Forzando activacion...
slmgr /ato
echo.
echo [✔ NEXUS -> COMPLETADO] Windows ha sido activado.
pause
exit

:end