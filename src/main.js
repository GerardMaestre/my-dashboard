const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');

const TELEMETRY_INTERVAL_MS = 2000;
const NETWORK_INTERVAL_MS = 3000;
const MAX_ICON_CACHE_ENTRIES = 1800;
const MAX_ICON_BATCH_REQUEST = 240;
const MAX_CONNECTIONS_PAYLOAD = 3200;

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedMapSet(map, key, value, maxEntries) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);

  if (map.size <= maxEntries) return;
  const oldestKey = map.keys().next().value;
  if (oldestKey !== undefined) {
    map.delete(oldestKey);
  }
}

function normalizePathCacheKey(filePath) {
  const raw = String(filePath || '').trim();
  if (!raw) return '';
  return path.normalize(raw).toLowerCase();
}

function fnv1aHash(items, toKey, limit = 5000) {
  let hash = 2166136261;
  const max = Math.min(items.length, limit);

  for (let idx = 0; idx < max; idx += 1) {
    const key = toKey(items[idx]);
    for (let charIndex = 0; charIndex < key.length; charIndex += 1) {
      hash ^= key.charCodeAt(charIndex);
      hash = Math.imul(hash, 16777619);
    }
  }

  return `${items.length}:${hash >>> 0}`;
}

async function mapWithConcurrency(items, worker, concurrency = 16) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const effectiveConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
  let pointer = 0;

  const runWorker = async () => {
    while (pointer < items.length) {
      const index = pointer;
      pointer += 1;
      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: effectiveConcurrency }, runWorker));
  return results;
}

// =========================================================
// ARRANQUE NORMAL DEL DASHBOARD (Doble clic en el icono)
// =========================================================

// Prevenir múltiples instancias de la aplicación
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  const createWindow = () => {
    const createdWindow = new BrowserWindow({
      width: 1100,
      height: 750,
      frame: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false
      }
    });

    createdWindow.loadFile(path.join(__dirname, 'index.html'));
    createdWindow.once('ready-to-show', () => {
      createdWindow.show();
    });

    return createdWindow;
  };

  let mainWindow = null;
  let diskScanGeneration = 0;

  let systemInformationModule = null;
  let networkMonitorModule = null;
  let threatIntelModule = null;
  let threatIntel = null;

  let telemetryInterval = null;
  let telemetryTickInFlight = false;
  let networkMonitor = null;

  let lastTelemetrySignature = '';
  let lastNetworkSignature = '';
  let lastExposureSignature = '';
  let lastListenersSignature = '';

  const iconCache = new Map();
  const iconInFlight = new Map();

  const getSystemInformation = () => {
    if (!systemInformationModule) {
      systemInformationModule = require('systeminformation');
    }
    return systemInformationModule;
  };

  const getThreatIntel = () => {
    if (!threatIntel) {
      if (!threatIntelModule) {
        threatIntelModule = require('./core/ThreatIntel');
      }
      threatIntel = new threatIntelModule.ThreatIntel();
    }
    return threatIntel;
  };

  const getNetworkMonitorModule = () => {
    if (!networkMonitorModule) {
      networkMonitorModule = require('./core/NetworkMonitor');
    }
    return networkMonitorModule;
  };

  const canRunMonitoring = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    return mainWindow.isVisible() && !mainWindow.isMinimized();
  };

  const sendToRenderer = (channel, payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  };

  const compactConnections = (connections) => {
    const source = Array.isArray(connections) ? connections : [];
    return source.slice(0, MAX_CONNECTIONS_PAYLOAD).map((entry) => ({
      id: String(entry.id || ''),
      protocol: String(entry.protocol || ''),
      localIp: String(entry.localIp || ''),
      localPort: String(entry.localPort || ''),
      remoteIp: String(entry.remoteIp || ''),
      remotePort: String(entry.remotePort || ''),
      state: String(entry.state || ''),
      pid: toFiniteNumber(entry.pid, 0) || null
    }));
  };

  const compactExposure = (dangerousLocalPorts) => {
    const source = Array.isArray(dangerousLocalPorts) ? dangerousLocalPorts : [];
    return source.map((entry) => ({
      id: String(entry.id || ''),
      protocol: String(entry.protocol || ''),
      localIp: String(entry.localIp || ''),
      localPort: toFiniteNumber(entry.localPort, 0),
      service: String(entry.service || ''),
      listeners: Array.isArray(entry.listeners) ? entry.listeners.slice(0, 8).map((item) => String(item || '')) : [],
      boundToAllInterfaces: !!entry.boundToAllInterfaces,
      externallyExposed: !!entry.externallyExposed
    }));
  };

  const compactListeners = (listeningPorts) => {
    const source = Array.isArray(listeningPorts) ? listeningPorts : [];
    return source.map((entry) => ({
      id: String(entry.id || ''),
      protocol: String(entry.protocol || ''),
      localIp: String(entry.localIp || ''),
      localPort: toFiniteNumber(entry.localPort, 0),
      service: String(entry.service || ''),
      boundToAllInterfaces: !!entry.boundToAllInterfaces,
      loopbackOnly: !!entry.loopbackOnly,
      externallyExposed: !!entry.externallyExposed
    }));
  };

  const createTelemetrySignature = (payload) => {
    const cpu = Math.round(toFiniteNumber(payload.cpuLoad, 0) * 10);
    const memRatio = toFiniteNumber(payload.memTotal, 0) > 0
      ? Math.round((toFiniteNumber(payload.memUse, 0) / toFiniteNumber(payload.memTotal, 1)) * 1000)
      : 0;
    const netTx = Math.round(toFiniteNumber(payload.netTx, 0));
    const netRx = Math.round(toFiniteNumber(payload.netRx, 0));
    return `${cpu}|${memRatio}|${netTx}|${netRx}`;
  };

  const runTelemetryTick = async () => {
    if (!canRunMonitoring() || telemetryTickInFlight) return;

    telemetryTickInFlight = true;
    try {
      const si = getSystemInformation();
      const [cpu, mem, netStats] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.networkStats('*')
      ]);

      let tx = 0;
      let rx = 0;
      const stats = Array.isArray(netStats) ? netStats : [];
      for (const item of stats) {
        tx += toFiniteNumber(item.tx_sec, 0);
        rx += toFiniteNumber(item.rx_sec, 0);
      }

      const payload = {
        cpuLoad: toFiniteNumber(cpu?.currentLoad, 0),
        memUse: toFiniteNumber(mem?.active, 0),
        memTotal: toFiniteNumber(mem?.total, 0),
        netTx: tx,
        netRx: rx
      };

      const signature = createTelemetrySignature(payload);
      if (signature !== lastTelemetrySignature) {
        lastTelemetrySignature = signature;
        sendToRenderer('telemetry-update', payload);
      }
    } catch (error) {
      console.error('[Telemetry Error]', error.message || error);
    } finally {
      telemetryTickInFlight = false;
    }
  };

  const startTelemetry = () => {
    if (telemetryInterval) return;
    runTelemetryTick();
    telemetryInterval = setInterval(runTelemetryTick, TELEMETRY_INTERVAL_MS);
  };

  const stopTelemetry = () => {
    if (!telemetryInterval) return;
    clearInterval(telemetryInterval);
    telemetryInterval = null;
  };

  const broadcastNetworkSnapshots = (connections, dangerousLocalPorts = [], listeningPorts = []) => {
    if (!canRunMonitoring()) return;

    const compactedConnections = compactConnections(connections);
    const compactedExposure = compactExposure(dangerousLocalPorts);
    const compactedListeners = compactListeners(listeningPorts);

    const networkSignature = fnv1aHash(
      compactedConnections,
      (entry) => `${entry.id}|${entry.state}|${entry.pid || ''}`
    );
    if (networkSignature !== lastNetworkSignature) {
      lastNetworkSignature = networkSignature;
      sendToRenderer('network-update', compactedConnections);
    }

    const exposureSignature = fnv1aHash(
      compactedExposure,
      (entry) => `${entry.id}|${entry.localPort}|${entry.boundToAllInterfaces ? 1 : 0}|${entry.listeners.join(',')}`
    );
    if (exposureSignature !== lastExposureSignature) {
      lastExposureSignature = exposureSignature;
      sendToRenderer('network-exposure-update', compactedExposure);
    }

    const listenersSignature = fnv1aHash(
      compactedListeners,
      (entry) => `${entry.id}|${entry.localPort}|${entry.boundToAllInterfaces ? 1 : 0}|${entry.loopbackOnly ? 1 : 0}`
    );
    if (listenersSignature !== lastListenersSignature) {
      lastListenersSignature = listenersSignature;
      sendToRenderer('network-listeners-update', compactedListeners);
    }
  };

  const startNetworkMonitor = () => {
    if (!networkMonitor) {
      const { NetworkMonitor } = getNetworkMonitorModule();
      networkMonitor = new NetworkMonitor({
        intervalMs: NETWORK_INTERVAL_MS,
        broadcastConnections: broadcastNetworkSnapshots
      });
      networkMonitor.registerIpc(ipcMain);
    }

    networkMonitor.start();
  };

  const stopNetworkMonitor = () => {
    if (!networkMonitor) return;
    networkMonitor.stop();
  };

  const syncMonitoringState = () => {
    if (canRunMonitoring()) {
      startTelemetry();
      startNetworkMonitor();
      return;
    }

    stopTelemetry();
    stopNetworkMonitor();
  };

  const resolveFileIcon = async (filePath) => {
    const rawPath = String(filePath || '').trim();
    const cacheKey = normalizePathCacheKey(rawPath);
    if (!cacheKey) return null;

    if (iconCache.has(cacheKey)) {
      return iconCache.get(cacheKey);
    }

    const pending = iconInFlight.get(cacheKey);
    if (pending) return pending;

    const task = app.getFileIcon(rawPath, { size: 'normal' })
      .then((icon) => (icon ? icon.toDataURL() : null))
      .catch(() => null)
      .then((dataUrl) => {
        boundedMapSet(iconCache, cacheKey, dataUrl, MAX_ICON_CACHE_ENTRIES);
        return dataUrl;
      })
      .finally(() => {
        iconInFlight.delete(cacheKey);
      });

    iconInFlight.set(cacheKey, task);
    return task;
  };

  const resolveFileIconsBatch = async (filePaths) => {
    const source = Array.isArray(filePaths) ? filePaths : [];
    const uniquePaths = [];
    const seen = new Set();

    for (const value of source) {
      const raw = String(value || '').trim();
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      uniquePaths.push(raw);
      if (uniquePaths.length >= MAX_ICON_BATCH_REQUEST) break;
    }

    const pairs = await mapWithConcurrency(uniquePaths, async (iconPath) => {
      const dataUrl = await resolveFileIcon(iconPath);
      return [iconPath, dataUrl];
    }, 18);

    const payload = {};
    for (const pair of pairs) {
      payload[pair[0]] = pair[1];
    }

    return payload;
  };

  const wireWindowLifecycle = (win) => {
    const scheduleMonitorSync = () => {
      setImmediate(syncMonitoringState);
    };

    win.on('show', scheduleMonitorSync);
    win.on('hide', scheduleMonitorSync);
    win.on('minimize', scheduleMonitorSync);
    win.on('restore', scheduleMonitorSync);
    win.on('focus', scheduleMonitorSync);

    win.on('closed', () => {
      if (mainWindow === win) {
        mainWindow = null;
      }
      stopTelemetry();
      stopNetworkMonitor();
    });
  };

  const registerIpcHandlers = () => {
    ipcMain.removeHandler('disk-scan-reset-state');
    ipcMain.handle('disk-scan-reset-state', async () => {
      diskScanGeneration += 1;
      return { ok: true, generation: diskScanGeneration };
    });

    ipcMain.removeHandler('disk-scan-get-state');
    ipcMain.handle('disk-scan-get-state', async () => {
      return { generation: diskScanGeneration };
    });

    ipcMain.removeHandler('get-file-icon');
    ipcMain.handle('get-file-icon', async (_event, filePath) => {
      return await resolveFileIcon(filePath);
    });

    ipcMain.removeHandler('get-file-icons-batch');
    ipcMain.handle('get-file-icons-batch', async (_event, filePaths) => {
      return await resolveFileIconsBatch(filePaths);
    });

    ipcMain.removeHandler('ip-intel-lookup');
    ipcMain.handle('ip-intel-lookup', async (_event, ip) => {
      const intel = getThreatIntel();
      return await intel.lookup(ip);
    });

    ipcMain.removeAllListeners('window-control');
    ipcMain.on('window-control', (event, action) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;

      if (action === 'close') win.close();
      if (action === 'minimize') win.minimize();
      if (action === 'maximize') {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
      }

      setImmediate(syncMonitoringState);
    });
  };

  app.on('ready', () => {
    mainWindow = createWindow();
    wireWindowLifecycle(mainWindow);
    registerIpcHandlers();

    const registered = globalShortcut.register('CommandOrControl+Space', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      syncMonitoringState();
      sendToRenderer('toggle-spotlight');
    });

    if (!registered) {
      console.warn('[HorusEngine] No se pudo registrar el atajo global CommandOrControl+Space');
    }

    syncMonitoringState();
  });

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    syncMonitoringState();
  });

  app.on('window-all-closed', () => {
    stopTelemetry();
    stopNetworkMonitor();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      wireWindowLifecycle(mainWindow);
      syncMonitoringState();
      return;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      syncMonitoringState();
    }
  });

  app.on('will-quit', () => {
    stopTelemetry();
    stopNetworkMonitor();
    globalShortcut.unregisterAll();
  });
} // end of single instance lock
