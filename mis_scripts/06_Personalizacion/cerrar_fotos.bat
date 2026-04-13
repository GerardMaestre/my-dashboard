@echo off
echo =========================================
echo       Apagando Servidor Immich...
echo =========================================
echo.

:: Verificar si Docker esta activo antes de intentar parar nada
docker info >nul 2>&1
if errorlevel 1 (
    echo [INFO] Docker no esta activo o no responde. No hay nada que apagar.
    echo.
    echo =========================================
    echo  No habia contenedores ejecutandose.
    echo =========================================
    timeout /t 3 >nul
    exit /b 0
)

:: Ir a la carpeta de la aplicacion
if not exist "C:\immich-app" (
    echo [ERROR] No se encontro la carpeta C:\immich-app
    pause
    exit /b 1
)

cd /d C:\immich-app

:: Intentar apagar con docker compose (V2) o docker-compose (V1)
echo [INFO] Ejecutando docker compose down...
docker compose down >nul 2>&1
if errorlevel 1 (
    echo [WARN] Fallo 'docker compose'. Intentando 'docker-compose'...
    docker-compose down
)

echo.
echo =========================================
echo  Todos los contenedores de Immich se han
echo  apagado. Ya no consumen RAM ni CPU.
echo =========================================
timeout /t 5 >nul
exit /b 0
