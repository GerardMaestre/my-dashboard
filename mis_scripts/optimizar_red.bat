:: DESC: Optimiza el DNS, Winsock y adaptador de red para reducir PING en gaming.
:: ARGS: Ninguno

@echo off
echo [⚡ NEXUS] Solicitando permisos de Administrador...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs" & exit /B
)

echo ⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS =====
echo     OPTIMIZADOR DE RED AGRESIVO
echo ⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS =====
echo.

echo [⚡ NEXUS] Renovando direccion IP...
ipconfig /release >nul 2>&1
ipconfig /renew >nul 2>&1

echo [⚡ NEXUS] Limpiando cache DNS...
ipconfig /flushdns >nul

echo [⚡ NEXUS] Reseteando Winsock y capa TCP/IP...
netsh winsock reset >nul
netsh int ip reset >nul
netsh interface ipv4 reset >nul
netsh interface ipv6 reset >nul

echo [⚡ NEXUS] Maximizando autotuning de red y algoritmos TCP...
netsh int tcp set global autotuninglevel=normal >nul
netsh int tcp set global chimney=enabled >nul 2>&1
netsh int tcp set global dca=enabled >nul 2>&1
netsh int tcp set global netdma=enabled >nul 2>&1
netsh int tcp set global ecncapability=enabled >nul 2>&1
netsh int tcp set heuristics disabled >nul 2>&1
netsh int tcp set global rfc1323=disabled >nul 2>&1

echo [⚡ NEXUS] Optimizando resolucion de DNS local...
ipconfig /flushdns >nul
ipconfig /registerdns >nul 2>&1

echo.
echo [V] RED OPTIMIZADA. SE RECOMIENDA REINICIAR.
exit /b 0