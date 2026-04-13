const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// =========================================================
// ARRANQUE NORMAL DEL DASHBOARD (Doble clic en el icono)
// =========================================================
	
// Prevenir múltiples instancias de la aplicación
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  } else {

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

    return mainWindow;
  };

  let mainWindow = null;
  let diskScanGeneration = 0;

  app.on('ready', () => {
    mainWindow = createWindow();

    ipcMain.handle('disk-scan-reset-state', async () => {
      diskScanGeneration += 1;
      return { ok: true, generation: diskScanGeneration };
    });

    ipcMain.handle('disk-scan-get-state', async () => {
      return { generation: diskScanGeneration };
    });
    
    ipcMain.handle('get-file-icon', async (event, filePath) => {
        try {
            const icon = await app.getFileIcon(filePath, { size: 'normal' });
            return icon.toDataURL();
        } catch (e) {
            return null;
        }
    });

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

  app.on('second-instance', () => {
    // Si alguien intenta abrir otra instancia, enfocar la existente
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });

  } // end of single instance lock
