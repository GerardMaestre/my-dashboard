const { app, BrowserWindow, ipcMain } = require('electron');
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
      execSync(`reg add "HKCU\\Software\\Classes\\SystemFileAssociations\\.nexus\\shell\\NexusDescifrar" /v "" /t REG_SZ /d "⚡ Abrir Bóveda Nexus" /f`);
      execSync(`reg add "HKCU\\Software\\Classes\\SystemFileAssociations\\.nexus\\shell\\NexusDescifrar\\command" /v "" /t REG_SZ /d "\\"${exePath}\\" --abrir \\"%1\\"" /f`);
    } else if (squirrelEvent === '--squirrel-uninstall') {
       // Limpia el registro si se desinstala la aplicación
       execSync(`reg delete "HKCU\\Software\\Classes\\Directory\\shell\\NexusCifrar" /f`);
       execSync(`reg delete "HKCU\\Software\\Classes\\.nexus" /f`);
      execSync(`reg delete "HKCU\\Software\\Classes\\Nexus.Vault" /f`);
      execSync(`reg delete "HKCU\\Software\\Classes\\SystemFileAssociations\\.nexus" /f`);
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

function regKeyExists(keyPath) {
  try {
    execSync(`reg query "${keyPath}"`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ensureContextMenuEntries() {
  if (process.platform !== 'win32') return;
  const exePath = process.execPath;
  const appPath = app.getAppPath();
  const isPackaged = app.isPackaged;
  const sellarCmd = isPackaged
    ? `"${exePath}" --sellar "%1"`
    : `"${exePath}" "${appPath}" --sellar "%1"`;
  const abrirCmd = isPackaged
    ? `"${exePath}" --abrir "%1"`
    : `"${exePath}" "${appPath}" --abrir "%1"`;
  const dirKey = 'HKCU\\Software\\Classes\\Directory\\shell\\NexusCifrar';
  const dirCmdKey = 'HKCU\\Software\\Classes\\Directory\\shell\\NexusCifrar\\command';
  const extKey = 'HKCU\\Software\\Classes\\.nexus';
  const progIdKey = 'HKCU\\Software\\Classes\\Nexus.Vault';
  const progCmdKey = 'HKCU\\Software\\Classes\\Nexus.Vault\\shell\\NexusDescifrar\\command';
  const assocKey = 'HKCU\\Software\\Classes\\SystemFileAssociations\\.nexus';
  const assocCmdKey = 'HKCU\\Software\\Classes\\SystemFileAssociations\\.nexus\\shell\\NexusDescifrar\\command';

  const escapeRegValue = (value) => value.replace(/"/g, '\\"');

  try {
    execSync(`reg delete "${dirKey}" /f >nul 2>&1`);
    execSync(`reg delete "${extKey}" /f >nul 2>&1`);
    execSync(`reg delete "${progIdKey}" /f >nul 2>&1`);
    execSync(`reg delete "${assocKey}" /f >nul 2>&1`);
  } catch (e) {}

  try {
    execSync(`reg add "${dirKey}" /v "" /t REG_SZ /d "Sellar con Nexus AES-128" /f`);
    execSync(`reg add "${dirCmdKey}" /v "" /t REG_SZ /d "${escapeRegValue(sellarCmd)}" /f`);

    execSync(`reg add "${extKey}" /v "" /t REG_SZ /d "Nexus.Vault" /f`);
    execSync(`reg add "${progIdKey}" /v "" /t REG_SZ /d "Nexus Vault" /f`);
    execSync(`reg add "${progIdKey}\\shell\\NexusDescifrar" /v "" /t REG_SZ /d "Abrir Boveda Nexus" /f`);
    execSync(`reg add "${progCmdKey}" /v "" /t REG_SZ /d "${escapeRegValue(abrirCmd)}" /f`);

    execSync(`reg add "${assocKey}\\shell\\NexusDescifrar" /v "" /t REG_SZ /d "Abrir Boveda Nexus" /f`);
    execSync(`reg add "${assocCmdKey}" /v "" /t REG_SZ /d "${escapeRegValue(abrirCmd)}" /f`);
  } catch (error) {
    console.error('Error creando entradas de menu contextual:', error);
  }
}

function ejecutarScriptOculto(scriptName, targetPath) {
  const misScriptsPath = app.isPackaged
    ? path.join(process.resourcesPath, 'mis_scripts')
    : path.join(__dirname, '..', '..', 'mis_scripts');

  const scriptPath = path.join(misScriptsPath, scriptName);
  const portableTarget = path.join(misScriptsPath, 'env_python', 'python.exe');
  
  // Usar portátil si existe, sino intentar con el del sistema.
  const pyExe = require('fs').existsSync(portableTarget) ? portableTarget : 'python';

  const pythonProcess = spawn(pyExe, [scriptPath, targetPath], {
    detached: true,     
    stdio: 'ignore'     
  });

  pythonProcess.unref(); 
  app.quit(); 
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
      frame: false,
      show: false, // Ocultar inicialmente
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false
      },
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });
  };

  app.on('ready', () => {
    createWindow();
    ensureContextMenuEntries();
    
    ipcMain.on('window-control', (event, action) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      if (action === 'close') win.close();
      if (action === 'minimize') win.minimize();
      if (action === 'maximize') {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
      }
    });
  });

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