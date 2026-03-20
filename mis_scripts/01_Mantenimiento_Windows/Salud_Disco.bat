@echo off
chcp 65001 >nul
:: DESC: Lee los sensores S.M.A.R.T. de tus discos (HDD/SSD) para alertarte si están a punto de romperse físicamente.
:: ARGS: Ninguno

echo [*] Solicitando permisos de Administrador...
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs" & del "%temp%\getadmin.vbs" & exit /B
)

echo ===================================================
echo       ⚡ NEXUS SYSTEM - ORÁCULO DE HARDWARE ⚡      
echo ===================================================
echo [*] Interrogando a los chips S.M.A.R.T. de los discos...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$disks = Get-PhysicalDisk; foreach ($disk in $disks) { Write-Host '========================================='; Write-Host ('DISCO: ' + $disk.FriendlyName) -ForegroundColor Cyan; Write-Host ('TIPO: ' + $disk.MediaType); Write-Host ('TAMAÑO: ' + [math]::Round($disk.Size / 1GB, 2) + ' GB'); if ($disk.HealthStatus -eq 'Healthy') { Write-Host 'ESTADO DE SALUD: SALUDABLE (Sin riesgo inminente)' -ForegroundColor Green } elseif ($disk.HealthStatus -eq 'Warning') { Write-Host 'ESTADO DE SALUD: ADVERTENCIA (Sectores dañados, haz backup)' -ForegroundColor Yellow } else { Write-Host 'ESTADO DE SALUD: PELIGRO CRÍTICO (Fallo inminente)' -ForegroundColor Red }; Write-Host 'ESTADO OPERATIVO: ' $disk.OperationalStatus; }"

echo.
echo ===================================================
echo [OK] Diagnostico profundo finalizado.
echo ===================================================