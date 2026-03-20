@echo off
chcp 65001 >nul
:: DESC: Lanza la potente herramienta de Raphi para erradicar todo el bloatware basura preinstalado en tu PC.
:: ARGS: Ninguno

echo [⚡ NEXUS] Elevando privilegios para purgar bloatware del sistema...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs" & exit /B
)

echo ⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS =====
echo     ⚡ NEXUS SYSTEM - WIN DEBLOATER (RAPHI) ⚡    
echo ⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS =====
echo [⚡ NEXUS] Descargando el motor de desinstalación de Bloatware...

powershell.exe -NoProfile -Command "& ([scriptblock]::Create((irm 'https://debloat.raphi.re/')))"