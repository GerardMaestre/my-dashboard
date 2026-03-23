@echo off
setlocal enabledelayedexpansion

REM DESC: Desinstalador Global Nativo (Lista software y permite purgar)
REM ARGS: 

title Desinstalador Root - Horus Engine

echo ========================================================
echo        HORUS PRO - DESINSTALADOR VISUAL ROOT
echo ========================================================
echo.
echo Preparando permisos para gestionar desinstaladores...
net session >nul 2>&1
if "%errorLevel%" neq "0" (
    echo [!] Se requieren permisos de administrador.
    echo [!] Se abrira el aviso UAC. Acepta para continuar.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%~f0' -Verb RunAs" 2>nul
    if "%errorLevel%" neq "0" (
        echo [X] No se pudo elevar permisos.
        timeout /t 4 >nul
    )
    exit /B
)

where powershell >nul 2>&1
if "%errorLevel%" neq "0" (
    echo [X] PowerShell no esta disponible en este sistema.
    timeout /t 5 >nul
    exit /B 1
)

echo [OK] Permisos confirmados.
echo.
echo Escaneando el registro de Windows en busca de programas instalados...
echo Dependiendo de tu sistema esto puede tardar entre 5 y 20 segundos.
echo.
echo [TIP] Se abrira una ventana visual para elegir el programa.
echo [TIP] Doble clic o Aceptar para ejecutar su desinstalador.
echo.

:: Usamos PowerShell en linea para generar un GridView nativo, sin necesitar modulos extra
:: La grilla permitira al usuario seleccionar el programa y ejecutara su desinstalador.

set PS_CMD= ^
$ProgressPreference = 'SilentlyContinue'; ^
Write-Host 'Cargando catalogo de software...' -ForegroundColor Cyan; ^
$keys = @('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'); ^
$apps = Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and $_.UninstallString } | Select-Object DisplayName, DisplayVersion, Publisher, UninstallString | Sort-Object DisplayName -Unique; ^
if ($null -eq $apps -or $apps.Count -eq 0) { Write-Host '[X] No se encontraron programas o hubo un error en el registro.' -ForegroundColor Red; exit 1; }; ^
Write-Host ('Programas detectados: ' + $apps.Count) -ForegroundColor Green; ^
$selected = $apps ^| Out-GridView -Title 'Selecciona un programa y haz CLICK en Aceptar para desinstalar' -PassThru; ^
if ($selected) { ^
    Write-Host ('Ejecutando desinstalador para: ' + $selected.DisplayName) -ForegroundColor Yellow; ^
    $unist = $selected.UninstallString; ^
    if ($unist -match 'msiexec') { Start-Process cmd -ArgumentList '/c', $unist -Wait; } ^
    else { ^
        $unist = $unist -replace '\"',''; ^
        Start-Process $unist -Wait -ErrorAction SilentlyContinue; ^
    }; ^
    Write-Host '[OK] Flujo de desinstalacion finalizado.' -ForegroundColor Green; ^
} else { Write-Host '[*] Operacion cancelada por el usuario.' -ForegroundColor DarkYellow; }

powershell -NoProfile -ExecutionPolicy Bypass -Command "%PS_CMD%"
if "%errorLevel%" neq "0" (
    echo [X] El flujo visual de desinstalacion no finalizo correctamente.
    timeout /t 5 >nul
    exit /B 1
)

echo.
echo [OK] Proceso de gestion terminado.
timeout /t 5 >nul
exit /b