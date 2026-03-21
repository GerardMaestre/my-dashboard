@echo off
:: DESC: Inyecta las herramientas HORUS en el menú contextual de Windows de forma dinámica.
chcp 65001 >nul
color 0a
echo ===================================================
echo     ⚡ HORUS ENGINE - INYECTOR DE MENÚ CONTEXTUAL ⚡    
echo ===================================================

:: Solicitar permisos de Administrador automáticamente
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo [*] Solicitando permisos de Administrador...
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs" & exit /B
)

:: %~dp0 obtiene la ruta exacta donde está este .bat (muy útil para USBs)
set "RUTA_SCRIPTS=%~dp0"

echo [*] Forjando llaves de registro para la ruta: %RUTA_SCRIPTS%

:: 1. Menú contextual para CARPETAS (Cifrar)
reg add "HKCU\Software\Classes\Directory\shell\HorusCifrar" /v "" /t REG_SZ /d "⚡ Sellar con HORUS AES-256 CTR" /f >nul
reg add "HKCU\Software\Classes\Directory\shell\HorusCifrar\command" /v "" /t REG_SZ /d "python \"%RUTA_SCRIPTS%Cifrador_De_Carpetas.py\" \"%%1\"" /f >nul

:: 2. Menú contextual para ARCHIVOS .horus (Descifrar)
reg add "HKCU\Software\Classes\SystemFileAssociations\.horus\shell\HorusDescifrar" /v "" /t REG_SZ /d "⚡ Abrir Bóveda HORUS (AES-256)" /f >nul
reg add "HKCU\Software\Classes\SystemFileAssociations\.horus\shell\HorusDescifrar\command" /v "" /t REG_SZ /d "python \"%RUTA_SCRIPTS%descifrador.py\" \"%%1\"" /f >nul

echo [OK] INYECCIÓN COMPLETADA. Haz clic derecho en cualquier carpeta para probarlo.
pause
