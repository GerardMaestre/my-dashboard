@echo off
chcp 65001 >nul
:: DESC: Lanza la navaja suiza de Chris Titus. Perfecta para instalar programas base y optimizar Windows a fondo.
:: ARGS: Ninguno

echo [*] Elevando privilegios para desinstalar telemetría profunda...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs" & exit /B
)

echo ===================================================
echo     ⚡ NEXUS SYSTEM - CHRIS TITUS WIN-UTILS ⚡    
echo ===================================================
echo [*] Descargando y ejecutando motor de optimización...

powershell.exe -NoProfile -Command "iwr -useb https://christitus.com/win | iex"