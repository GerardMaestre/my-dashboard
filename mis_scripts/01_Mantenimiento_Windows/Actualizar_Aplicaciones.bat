@echo off
chcp 65001 >nul
:: DESC: Actualizador silencioso. Busca y actualiza todo el software de tu PC de golpe usando Winget.
:: ARGS: Ninguno

echo [*] Elevando privilegios para actualizar todo el software...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' goto :HorusElevate
if "%~1"=="--horus-elevated" shift
goto :HorusPayload

:HorusElevate
echo [*] Solicitando permisos de Administrador para gestor de paquetes...
set "LOGF=%temp%\horus_admin_%RANDOM%.log"
type nul > "%LOGF%"
echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
echo UAC.ShellExecute "cmd.exe", "/c """"%~s0"" --horus-elevated %* > ""%LOGF%"" 2>&1 & echo 1 > ""%LOGF%.done"" """, "", "runas", 0 >> "%temp%\getadmin.vbs"
"%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs"
powershell -Command "$log='%LOGF%'; $done='%LOGF%.done'; $fs=$null; while($null -eq $fs -and -not (Test-Path $done)){try{$fs=New-Object System.IO.FileStream $log,'Open','Read','ReadWrite'}catch{Start-Sleep -m 50}}; if($fs){$sr=New-Object System.IO.StreamReader $fs; while(-not (Test-Path $done)){while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; Start-Sleep -m 50}; while(-not $sr.EndOfStream){Write-Host $sr.ReadLine()}; $sr.Close(); $fs.Close()}; Remove-Item $log -ea 0; Remove-Item $done -ea 0"
exit /B
:HorusPayload

echo ===================================================
echo     âš¡ HORUS AUTOPILOT - ACTUALIZADOR INVISIBLE âš¡     
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
