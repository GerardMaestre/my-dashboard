@echo off
chcp 65001 >nul
:: DESC: Activa Windows 11 (Home o Pro) conectándose a un servidor KMS de forma segura.
:: ARGS: 1 W11 Home | 2 W11 Pro | 3 Salir

echo [*] Solicitando permisos de Administrador...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "%~1 %~2", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs" & exit /B
)

color 0a

:: Interpretar Parámetros Silenciosos (Desde Dashboard)
if "%~1"=="1" goto home
if /I "%~1"=="home" goto home
if "%~1"=="2" goto pro
if /I "%~1"=="pro" goto pro
if "%~1"=="3" exit

echo ===================================================
echo         ACTIVADOR UNIVERSAL - WINDOWS 11         
echo ===================================================
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
echo [X] Opcion no valida. Intenta de nuevo.
goto end

:home
echo [*] Aplicando clave de Windows 11 Home...
slmgr.vbs -upk
slmgr /ipk 7HNRX-D7KGG-3K4RQ-4WPJ4-YTDFH
goto activate

:pro
echo [*] Aplicando clave de Windows 11 Pro...
slmgr.vbs -upk
slmgr /ipk NRG8B-VKK3Q-CXVCJ-9G2XF-6Q84J
goto activate

:activate
echo [*] Conectando al servidor KMS...
slmgr /skms kms.digiboy.ir
echo [*] Forzando activacion...
slmgr /ato
echo.
echo [OK] Windows ha sido activado.
pause
exit

:end
echo [X] Opcion no valida.
pause