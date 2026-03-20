@echo off
chcp 65001 >nul
:: DESC: Desbloquea la carpeta maestra 'Modo Dios' en tu escritorio para acceder a +200 ajustes ocultos de Windows.
:: ARGS: Ninguno

echo ⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS =====
echo        ⚡ NEXUS SYSTEM - GOD MODE CREATOR ⚡       
echo ⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS =====
echo [⚡ NEXUS] Creando acceso maestro al nucleo de configuracion...

set "desktopPath=%USERPROFILE%\Desktop"
set "godModeFolder=%desktopPath%\Modo_Dios.{ED7BA470-8E54-465E-825C-99712043E01C}"

if exist "%godModeFolder%" (
    echo [I] El Modo Dios ya existe en tu escritorio.
) else (
    md "%godModeFolder%"
    echo [✔ NEXUS -> COMPLETADO] Carpeta MODO DIOS creada en el Escritorio.
    echo [I] Abrela para acceder a +200 ajustes ocultos de Windows.
)

echo ⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS ====⚡ ==== NEXUS =====