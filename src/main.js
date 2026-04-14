const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { NetworkMonitor, detectDangerousListeningPorts } = require('./core/NetworkMonitor');
const { ThreatIntel } = require('./core/ThreatIntel');

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
      width: 1100, // Slightly wider for new telemetry HUD
      height: 750,
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
  let si = require('systeminformation');
  let telemetryInterval = null;
  let networkMonitor = null;
  const threatIntel = new ThreatIntel();

  app.on('ready', () => {
    mainWindow = createWindow();

    // Monitor de red en tiempo real para alimentar el radar visual del frontend.
    networkMonitor = new NetworkMonitor({
      intervalMs: 3000,
      broadcastConnections: (connections, dangerousLocalPorts = null, listeningPorts = null) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('network-update', connections);
        const exposurePayload = Array.isArray(dangerousLocalPorts)
          ? dangerousLocalPorts
          : detectDangerousListeningPorts(connections);
        mainWindow.webContents.send('network-exposure-update', exposurePayload);
        mainWindow.webContents.send('network-listeners-update', Array.isArray(listeningPorts) ? listeningPorts : []);
      }
    });
    networkMonitor.registerIpc(ipcMain);
    networkMonitor.start();

    const { globalShortcut } = require('electron');
    // Spotlight Global Shortcut
    globalShortcut.register('CommandOrControl+Space', () => {
      if (mainWindow) {
        if (!mainWindow.isVisible()) mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.webContents.send('toggle-spotlight');
      }
    });

    // Iniciar Telemetría
    telemetryInterval = setInterval(async () => {
      if (!mainWindow) return;
      try {
        const cpu = await si.currentLoad();
        const mem = await si.mem();
        const netStats = await si.networkStats();
        
        // Sumar tráfico de interfaces activas
        let tx = 0; let rx = 0;
        netStats.forEach(n => { tx += isNaN(n.tx_sec) ? 0 : n.tx_sec; rx += isNaN(n.rx_sec) ? 0 : n.rx_sec; });

        mainWindow.webContents.send('telemetry-update', {
          cpuLoad: cpu.currentLoad,
          memUse: mem.active,
          memTotal: mem.total,
          netTx: tx,
          netRx: rx
        });
      } catch (err) {
        console.error('[Telemetry Error]', err.message);
      }
    }, 2000);

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

    ipcMain.removeHandler('ip-intel-lookup');
    ipcMain.handle('ip-intel-lookup', async (_event, ip) => {
      return await threatIntel.lookup(ip);
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
    if (telemetryInterval) clearInterval(telemetryInterval);
    if (networkMonitor) networkMonitor.stop();
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
