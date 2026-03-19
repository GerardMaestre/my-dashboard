const { app, BrowserWindow } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');

// =========================================================
// 1. AUTO-INSTALADOR Y MENÚ CONTEXTUAL INVISIBLE
// =========================================================
// Esto se ejecuta en 2º plano cuando alguien abre tu Setup.exe por primera vez
const squirrelEvent = process.argv[1];
if (squirrelEvent && squirrelEvent.startsWith('--squirrel')) {
  const exePath = process.execPath; // La ruta donde se ha instalado
  try {
    if (squirrelEvent === '--squirrel-install' || squirrelEvent === '--squirrel-updated') {
       // Inyecta en el menú contextual del usuario actual (¡No pide permisos de Administrador!)
       execSync(`reg add "HKCU\\Software\\Classes\\Directory\\shell\\NexusCifrar" /v "" /t REG_SZ /d "⚡ Sellar con Nexus AES-128" /f`);
       execSync(`reg add "HKCU\\Software\\Classes\\Directory\\shell\\NexusCifrar\\command" /v "" /t REG_SZ /d "\\"${exePath}\\" --sellar \\"%1\\"" /f`);
       
       execSync(`reg add "HKCU\\Software\\Classes\\.nexus" /v "" /t REG_SZ /d "Nexus.Vault" /f`);
       execSync(`reg add "HKCU\\Software\\Classes\\Nexus.Vault\\shell\\NexusDescifrar" /v "" /t REG_SZ /d "⚡ Abrir Bóveda Nexus" /f`);
       execSync(`reg add "HKCU\\Software\\Classes\\Nexus.Vault\\shell\\NexusDescifrar\\command" /v "" /t REG_SZ /d "\\"${exePath}\\" --abrir \\"%1\\"" /f`);
    } else if (squirrelEvent === '--squirrel-uninstall') {
       // Limpia el registro si se desinstala la aplicación
       execSync(`reg delete "HKCU\\Software\\Classes\\Directory\\shell\\NexusCifrar" /f`);
       execSync(`reg delete "HKCU\\Software\\Classes\\.nexus" /f`);
       execSync(`reg delete "HKCU\\Software\\Classes\\Nexus.Vault" /f`);
    }
  } catch (e) {
    console.error("Error en el registro silencioso:", e);
  }
}

// Esto crea el acceso directo del escritorio y evita que se abran ventanas dobles al instalar
if (require('electron-squirrel-startup')) {
  app.quit();
}

// =========================================================
// 2. ENRUTADOR DE ÓRDENES (Clic derecho de Windows)
// =========================================================
const args = process.argv;
const sellarIndex = args.indexOf('--sellar');
const abrirIndex = args.indexOf('--abrir');

function ejecutarScriptOculto(scriptName, targetPath) {
  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'mis_scripts', scriptName)
    : path.join(app.getAppPath(), 'mis_scripts', scriptName);

  const pythonProcess = spawn('python', [scriptPath, targetPath], {
    detached: true,     
    stdio: 'ignore'     
  });

  pythonProcess.unref(); 
  app.quit(); // Se cierra tras lanzar Python para que no te moleste la ventana principal
}

// Si la orden viene de hacer clic derecho...
if (sellarIndex !== -1 && args.length > sellarIndex + 1) {
  ejecutarScriptOculto('Cifrador_De_Carpetas.py', args[sellarIndex + 1]);
} else if (abrirIndex !== -1 && args.length > abrirIndex + 1) {
  ejecutarScriptOculto('descifrador.py', args[abrirIndex + 1]);
} else {
  // =========================================================
  // 3. ARRANQUE NORMAL DEL DASHBOARD (Doble clic en el icono)
  // =========================================================
  const createWindow = () => {
    const mainWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      webPreferences: {
        preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
        nodeIntegration: false,
        contextIsolation: true
      },
    });

    mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  };

  app.on('ready', createWindow);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}