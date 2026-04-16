@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
:: DESC: Instala o actualiza Spicetify CLI + Marketplace y aplica configuracion base en Spotify.
:: ARGS: --verbose
:: RISK: high
:: PERM: user
:: MODE: internal

title HORUS ENGINE - SPICETIFY
color 0A
cls

set "VERBOSE=0"
if /I "%~1"=="--verbose" set "VERBOSE=1"

set "USE_BYPASS_ADMIN=0"
set "SPICETIFY_FLAGS="

set "LOG_DIR=%TEMP%\horus_spicetify"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
set "LOG_FILE=%LOG_DIR%\spicetify_%RANDOM%%RANDOM%.log"

call :Banner
echo [WARN] Este script ejecuta instaladores remotos de PowerShell.
echo [INFO] Si algo falla, revisa el log:
echo        %LOG_FILE%
echo.

call :CheckCommand "powershell.exe" "PowerShell"
if errorlevel 1 goto :Fail

call :CheckAdminMode
if errorlevel 1 goto :Fail

call :CheckSpotify
if errorlevel 1 goto :Fail

echo.
echo [1/4] Cerrando Spotify...
taskkill /F /IM Spotify.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo.
echo [2/4] Instalando o actualizando Spicetify CLI...
call :InstallCli
if errorlevel 1 goto :Fail

call :ResolveSpicetifyExe
if errorlevel 1 goto :Fail

echo.
echo [3/4] Instalando Marketplace...
call :InstallMarketplace
if errorlevel 1 goto :Fail

echo.
echo [4/4] Aplicando configuracion de Spicetify...
call :RunSpicetify "config inject_css 1 replace_colors 1 overwrite_assets 1"
if errorlevel 1 goto :Fail

call :RunSpicetify "backup apply"
if errorlevel 1 (
	echo [WARN] backup apply fallo. Reintentando con apply...
	call :RunSpicetify "apply"
	if errorlevel 1 goto :Fail
)

echo.
echo ===========================================================
echo [OK] Spicetify instalado y aplicado correctamente.
echo [OK] Abre Spotify para confirmar temas y extensiones.
echo ===========================================================
echo.
exit /b 0

:Banner
echo ===========================================================
echo               HORUS ENGINE - SPICETIFY SETUP
echo ===========================================================
echo.
exit /b 0

:CheckCommand
where %~1 >nul 2>&1
if errorlevel 1 (
	echo [ERROR] No se encontro %~2 en el sistema.
	exit /b 1
)
exit /b 0

:CheckAdminMode
call :IsAdmin
if errorlevel 1 exit /b 0

echo [WARN] Detectado modo Administrador.
echo [WARN] Spicetify recomienda ejecutar como usuario normal.
echo [WARN] Activando automaticamente --bypass-admin para evitar bloqueo.
set "USE_BYPASS_ADMIN=1"
set "SPICETIFY_FLAGS=--bypass-admin"
echo [WARN] Continuando en modo automatico sin prompts.
exit /b 0

:IsAdmin
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent()); if ($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }" >nul 2>&1
if errorlevel 1 exit /b 1
exit /b 0

:CheckSpotify
if exist "%APPDATA%\Spotify\Spotify.exe" exit /b 0
if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\Spotify.exe" exit /b 0
echo [WARN] Spotify no parece instalado en rutas comunes.
echo [WARN] La instalacion puede completarse, pero no podra aplicarse correctamente.
echo [WARN] Continuando automaticamente.
exit /b 0

:ResolveSpicetifyExe
set "SPICETIFY_EXE=%LOCALAPPDATA%\spicetify\spicetify.exe"
if exist "%SPICETIFY_EXE%" exit /b 0

for /f "delims=" %%I in ('where spicetify.exe 2^>nul') do (
	set "SPICETIFY_EXE=%%I"
	goto :ResolveDone
)

echo [ERROR] No se encontro spicetify.exe despues de instalar.
exit /b 1

:ResolveDone
exit /b 0

:InstallCli
where winget >nul 2>&1
if errorlevel 1 (
	echo [WARN] winget no esta disponible. Verificando si Spicetify ya existe...
	call :ResolveSpicetifyExe
	if errorlevel 1 (
		echo [ERROR] No hay winget y tampoco se encontro spicetify.exe.
		exit /b 1
	)
	exit /b 0
)

echo [INFO] Intentando instalacion no interactiva con winget...
if "%VERBOSE%"=="1" (
	winget install --id Spicetify.Spicetify -e --silent --force --accept-source-agreements --accept-package-agreements
) else (
	winget install --id Spicetify.Spicetify -e --silent --force --accept-source-agreements --accept-package-agreements >> "%LOG_FILE%" 2>&1
)

if errorlevel 1 (
	echo [WARN] winget install fallo. Intentando winget upgrade...
	if "%VERBOSE%"=="1" (
		winget upgrade --id Spicetify.Spicetify -e --silent --accept-source-agreements --accept-package-agreements
	) else (
		winget upgrade --id Spicetify.Spicetify -e --silent --accept-source-agreements --accept-package-agreements >> "%LOG_FILE%" 2>&1
	)
	if errorlevel 1 (
		echo [WARN] winget no pudo instalar/actualizar. Verificando binario existente...
		call :ResolveSpicetifyExe
		if errorlevel 1 exit /b 1
	)
)

exit /b 0

:InstallMarketplace
"%SPICETIFY_EXE%" %SPICETIFY_FLAGS% config current_theme marketplace >nul 2>&1
if "%USE_BYPASS_ADMIN%"=="1" (
	call :RunStep "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $script=(Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/spicetify/marketplace/main/resources/install.ps1').Content; & ([ScriptBlock]::Create($script)) -BypassAdmin"
) else (
	call :RunStep "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $script=(Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/spicetify/marketplace/main/resources/install.ps1').Content; & ([ScriptBlock]::Create($script))"
)
if errorlevel 1 exit /b 1
exit /b 0

:RunStep
if "%VERBOSE%"=="1" (
	powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "%~1"
) else (
	powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "%~1" >> "%LOG_FILE%" 2>&1
)
if errorlevel 1 exit /b 1
exit /b 0

:RunSpicetify
if "%VERBOSE%"=="1" (
	"%SPICETIFY_EXE%" %SPICETIFY_FLAGS% %~1
) else (
	"%SPICETIFY_EXE%" %SPICETIFY_FLAGS% %~1 >> "%LOG_FILE%" 2>&1
)
if errorlevel 1 exit /b 1
exit /b 0

:FallbackWinget
where winget >nul 2>&1
if errorlevel 1 (
	echo [ERROR] winget no esta disponible para fallback.
	exit /b 1
)

if "%VERBOSE%"=="1" (
	winget install --id Spicetify.Spicetify -e --silent --accept-source-agreements --accept-package-agreements
) else (
	winget install --id Spicetify.Spicetify -e --silent --accept-source-agreements --accept-package-agreements >> "%LOG_FILE%" 2>&1
)
if errorlevel 1 exit /b 1
exit /b 0

:Fail
echo.
echo ===========================================================
echo [ERROR] No se pudo completar la instalacion de Spicetify.
echo [ERROR] Revisa el log para ver el motivo exacto:
echo         %LOG_FILE%
echo ===========================================================
echo.
exit /b 1
