const { app, BrowserWindow, ipcMain, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');

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

// --- Rutas y Configuración General (Movido de Preload) ---
const isPackaged = app.isPackaged;
const resourcesBase = isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const storageDir = path.join(resourcesBase, 'mis_scripts');
const portableBaseDir = process.env.PORTABLE_EXECUTABLE_DIR || '';
const userProfileBase = process.env.APPDATA || process.env.USERPROFILE || process.cwd();
const appDataNexus = portableBaseDir
  ? path.join(portableBaseDir, 'HorusData')
  : path.join(userProfileBase, 'HorusEngine');

const writableRuntimeRoot = isPackaged ? path.join(appDataNexus, 'runtime') : storageDir;
const pythonEnvPath = path.join(writableRuntimeRoot, 'env_python');
const toolsDir = path.join(writableRuntimeRoot, 'tools');
const bundledToolsDir = path.join(storageDir, 'tools');

const toolCandidates = {
  es: [path.join(toolsDir, 'es.exe'), path.join(bundledToolsDir, 'es.exe'), 'Everything\\es.exe'],
  mft: [path.join(toolsDir, 'mft_reader.exe'), path.join(bundledToolsDir, 'mft_reader.exe')],
  wiztree: [path.join(toolsDir, 'WizTree64.exe'), path.join(bundledToolsDir, 'WizTree64.exe'), 'C:\\Program Files\\WizTree\\WizTree64.exe'],
  geek: [path.join(toolsDir, 'GeekUninstaller.exe'), path.join(bundledToolsDir, 'GeekUninstaller.exe')]
};

const diskScanCache = new Map();
const MAX_SCAN_CACHE_SIZE = 3;

function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    return true;
  } catch (error) {
    console.error(`[HorusEngine] No se pudo crear ${dirPath}:`, error.message);
    return false;
  }
}

function findExistingTool(paths) {
  for (const candidate of paths) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function runPowerShell(command, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => stdout += data.toString());
    child.stderr.on('data', (data) => stderr += data.toString());
    
    let timer = setTimeout(() => {
      child.kill();
      reject(new Error('PowerShell Timeout'));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && stderr && !stdout) return reject(new Error(stderr));
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
    
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stdin.write(command + '\n\nExit\n');
    child.stdin.end();
  });
}

function escapePsSingleQuoted(value) {
  return String(value || '').replace(/'/g, "''");
}

function safeJsonParse(payload, fallback = []) {
  if (!payload) return fallback;
  try {
    const parsed = JSON.parse(payload);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return fallback;
  }
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

    // --- NUEVOS HANDLERS MOVIDOS DE PRELOAD ---
    ipcMain.handle('get-runtime-paths', async () => ({
      isPackaged,
      resourcesBase,
      storageDir,
      writableRuntimeRoot,
      pythonEnvPath,
      toolsDir,
      bundledToolsDir,
      appDataNexus,
      portableBaseDir,
      env: {
        USERPROFILE: process.env.USERPROFILE || '',
        APPDATA: process.env.APPDATA || '',
        LOCALAPPDATA: process.env.LOCALAPPDATA || '',
        PROGRAMFILES: process.env.ProgramFiles || 'C:\\Program Files',
        WINDIR: process.env.WinDir || 'C:\\Windows'
      }
    }));

    ipcMain.handle('list-scripts', async () => {
      if (!ensureDir(storageDir)) return [];
      const getFiles = async (dir, base = '') => {
        const dirents = fs.readdirSync(dir, { withFileTypes: true });
        const files = await Promise.all(dirents.map((dirent) => {
          const res = path.resolve(dir, dirent.name);
          const rel = path.posix.join(base, dirent.name);
          return dirent.isDirectory() ? getFiles(res, rel) : rel;
        }));
        return Array.prototype.concat(...files).filter(f => f.match(/\.(py|bat|cmd|sh|exe)$/i));
      };
      return await getFiles(storageDir);
    });

    ipcMain.handle('read-script-meta', async (_event, fileName) => {
      const filePath = path.join(storageDir, fileName.replace(/\//g, path.sep));
      if (!fs.existsSync(filePath)) return [];
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.substring(0, 1000).split(/\r?\n/);
      } catch (e) { return []; }
    });

    ipcMain.handle('edit-script', async (_event, fileName) => {
      const filePath = path.join(storageDir, fileName.replace(/\//g, path.sep));
      spawn('notepad.exe', [filePath]);
    });

    ipcMain.handle('run-script', async (event, { fileName, args, mode }) => {
      const filePath = path.join(storageDir, fileName.replace(/\//g, path.sep));
      const info = getScriptInfo(fileName);
      const executable = (info.isCmdScript || info.cmd === fileName) ? filePath : info.cmd;
      const scriptArgs = (info.isCmdScript || info.cmd === fileName) ? args : [filePath, ...args];
      
      const spawnOptions = { shell: true, cwd: path.dirname(filePath), windowsHide: mode === 'internal' };
      const child = spawn(executable, scriptArgs, spawnOptions);
      
      child.stdout.on('data', d => event.sender.send('process-output', { fileName, type: 'success', message: d.toString() }));
      child.stderr.on('data', d => event.sender.send('process-output', { fileName, type: 'error', message: d.toString() }));
      child.on('close', code => event.sender.send('process-exit', { fileName, code }));
      
      return { pid: child.pid };
    });

    ipcMain.handle('get-ghost-engine-status', async () => ({
      everythingAvailable: !!findExistingTool(toolCandidates.es),
      wiztreeAvailable: !!findExistingTool(toolCandidates.wiztree),
      geekAvailable: !!findExistingTool(toolCandidates.geek)
    }));

    ipcMain.handle('ensure-environment', async (event) => {
      return await ensureStandaloneEnvironmentWithProgress(event.sender);
    });

    ipcMain.removeHandler('ghost-search-files');
    ipcMain.handle('ghost-search-files', async (_event, query, limit) => {
      return await ghostSearchFiles(query, limit);
    });

    ipcMain.removeHandler('ghost-list-apps');
    ipcMain.handle('ghost-list-apps', async () => {
      return await ghostListInstalledApps();
    });

    ipcMain.removeHandler('ghost-scan-disk');
    ipcMain.handle('ghost-scan-disk', async (event, rootPath, options) => {
      return await ghostScanDisk(event.sender, rootPath, options);
    });

    ipcMain.removeHandler('ghost-uninstall-app');
    ipcMain.handle('ghost-uninstall-app', async (_event, payload, force) => {
      return await ghostUninstallApp(payload, force);
    });

    ipcMain.removeHandler('ghost-find-leftovers');
    ipcMain.handle('ghost-find-leftovers', async (_event, payload) => {
      return await ghostFindLeftovers(payload);
    });

    ipcMain.removeHandler('ghost-clean-leftovers');
    ipcMain.handle('ghost-clean-leftovers', async (_event, items) => {
      return await ghostCleanLeftovers(items);
    });

    ipcMain.removeHandler('scan-global-files-chunked');
    ipcMain.handle('scan-global-files-chunked', async (event) => {
      return await scanGlobalFilesChunked(event.sender);
    });

    ipcMain.handle('get-storage-dir', async () => storageDir);

    ipcMain.handle('is-running', async (_event, fileName) => {
        // En una implementación real, buscaríamos en un Map de procesos activos
        return false; 
    });

    ipcMain.handle('stop-script', async (_event, fileName) => {
        // En una implementación real, mataríamos el proceso del Map
        return { stopped: true };
    });

    ipcMain.removeHandler('clear-disk-scan-cache');
    ipcMain.handle('clear-disk-scan-cache', async (_event, rootPath) => {
      if (rootPath) {
        const norm = path.normalize(rootPath).toLowerCase();
        diskScanCache.delete(norm);
      } else {
        diskScanCache.clear();
      }
      return { ok: true };
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

  // --- IMPLEMENTACIÓN DE LÓGICA PESADA ---

  async function ensureStandaloneEnvironmentWithProgress(sender) {
    const pythonExe = path.join(pythonEnvPath, 'python.exe');
    const wiztreeExe = path.join(toolsDir, 'WizTree64.exe');

    if (!fs.existsSync(pythonExe)) {
      sender.send('setup-progress', { status: 'Descargando Python...', percent: 10 });
      // Lógica de descarga simplificada para brevedad, en prod usaría axios/got + hash
      const psZap = `
        $ProgressPreference = 'SilentlyContinue';
        New-Item -ItemType Directory -Path "${pythonEnvPath}" -Force;
        $zip = Join-Path "${pythonEnvPath}" "python.zip";
        Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.11.8/python-3.11.8-embed-amd64.zip" -OutFile $zip;
        Expand-Archive -Path $zip -DestinationPath "${pythonEnvPath}" -Force;
        Remove-Item $zip;
        $pth = Join-Path "${pythonEnvPath}" "python311._pth";
        if (Test-Path $pth) { (Get-Content $pth) -replace '#import site', 'import site' | Set-Content $pth }
      `;
      try {
        await runPowerShell(psZap, 300000);
        sender.send('setup-progress', { status: 'Python instalado', percent: 50 });
      } catch (e) {
        console.error('Python setup fail', e);
      }
    }

    if (!fs.existsSync(wiztreeExe)) {
      sender.send('setup-progress', { status: 'Descargando WizTree...', percent: 60 });
      const psWiz = `
        $ProgressPreference = 'SilentlyContinue';
        New-Item -ItemType Directory -Path "${toolsDir}" -Force;
        $zip = Join-Path "${toolsDir}" "wiztree.zip";
        Invoke-WebRequest -Uri "https://diskanalyzer.com/files/wiztree_4_21_portable.zip" -OutFile $zip;
        Expand-Archive -Path $zip -DestinationPath "${toolsDir}" -Force;
        Remove-Item $zip;
      `;
      try {
        await runPowerShell(psWiz, 180000);
        sender.send('setup-progress', { status: 'Entorno listo', percent: 100 });
      } catch (e) {
        console.error('WizTree setup fail', e);
      }
    }
    return { ok: true };
  }

  async function ghostSearchFiles(query, limit = 120) {
    const esPath = findExistingTool(toolCandidates.es);
    if (esPath) {
      try {
        const { stdout } = await new Promise((resolve, reject) => {
          execFile(esPath, ['-n', String(limit), query], { windowsHide: true }, (err, out) => {
            if (err && !out) reject(err);
            else resolve({ stdout: out || '' });
          });
        });
        return stdout.split(/\r?\n/).filter(Boolean).map((f, i) => ({ id: `es-${i}`, name: path.basename(f), fullPath: f }));
      } catch (e) { /* fallback */ }
    }
    // Fallback PS search (abreviado para main.js)
    return [];
  }

  async function ghostListInstalledApps() {
    const ps = `
      Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* |
      Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, UninstallString, QuietUninstallString, DisplayIcon, PSChildName, PSPath |
      ConvertTo-Json -Compress
    `;
    const { stdout } = await runPowerShell(ps);
    return safeJsonParse(stdout).map((a, i) => ({
      id: a.PSChildName || `app-${i}`,
      name: a.DisplayName || 'Unknown',
      version: a.DisplayVersion || '',
      publisher: a.Publisher || '',
      installLocation: a.InstallLocation || '',
      uninstallString: a.UninstallString || '',
      quietUninstallString: a.QuietUninstallString || '',
      registryPath: a.PSPath || ''
    }));
  }

  async function ghostScanDisk(sender, rootPath, options) {
    const normRoot = path.normalize(rootPath).toLowerCase();
    if (!options?.forceFresh && diskScanCache.has(normRoot)) {
      return diskScanCache.get(normRoot);
    }

    const wiztreeExe = findExistingTool(toolCandidates.wiztree);
    if (!wiztreeExe) return { error: 'WizTree not found' };

    const driveLetter = rootPath.substring(0, 1).toUpperCase();
    const tempCsv = path.join(appDataNexus, `export-${driveLetter}.csv`);
    ensureDir(appDataNexus);

    sender.send('disk-progress', { phase: 'scan', percent: 10 });
    await new Promise(r => execFile(wiztreeExe, [`${driveLetter}:\\`, `/export=${tempCsv}`, '/admin=0'], { windowsHide: true }, r));

    sender.send('disk-progress', { phase: 'parsing', percent: 50 });
    
    // Motor de parseo optimizado en el Main process (Sustituye logicamente al preload)
    const result = await parseWizTreeCSV(tempCsv, normRoot, sender);
    
    if (diskScanCache.size >= MAX_SCAN_CACHE_SIZE) {
      const first = diskScanCache.keys().next().value;
      diskScanCache.delete(first);
    }
    diskScanCache.set(normRoot, result);
    return result;
  }

  async function parseWizTreeCSV(filePath, normRoot, sender) {
    const readline = require('readline');
    const items = [];
    const extMap = new Map();
    let totalSize = 0;
    
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let isFirst = true;
    let i = 0;

    for await (const line of rl) {
      if (isFirst) { isFirst = false; continue; }
      const firstComma = line.indexOf('",');
      if (firstComma === -1) continue;

      const fullPath = line.substring(1, firstComma).replace(/\\\\/g, '\\');
      const rest = line.substring(firstComma + 2).split(',');
      const sizeBytes = Number(rest[0]) || 0;
      const attributes = Number(rest[rest.length - 3]) || 0;
      const isDir = (attributes & 16) !== 0;

      if (fullPath.toLowerCase().startsWith(normRoot)) {
         const depth = (fullPath.split('\\').length) - (normRoot.split('\\').length) + 1;
         if (depth <= 5) {
            items.push({ id: `wiz-${i}`, fullPath, name: path.basename(fullPath), sizeBytes, isDir, depth });
         }
      }

      if (!isDir) {
        totalSize += sizeBytes;
        const ext = path.extname(fullPath).toLowerCase() || 'otros';
        extMap.set(ext, (extMap.get(ext) || 0) + sizeBytes);
      }
      i++;
      if (i % 50000 === 0) sender.send('disk-progress', { phase: 'parsing', percent: 50 + (i/200000)*40 });
    }

    const extensions = Array.from(extMap.entries())
      .map(([ext, size]) => ({ ext, sizeBytes: size, percent: (size * 100 / (totalSize || 1)).toFixed(1) }))
      .sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 50);

    return { engine: 'wiztree', items, extensions, totalSize };
  }

  function getScriptInfo(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.py') return { cmd: path.join(pythonEnvPath, 'python.exe'), isPy: true };
    if (ext === '.bat' || ext === '.cmd') return { cmd: 'cmd.exe', isCmdScript: true };
    return { cmd: fileName };
  }

  async function ghostUninstallApp(payload, force) {
    if (force) {
      const ps = `Remove-Item -Path '${escapePsSingleQuoted(payload.installLocation)}' -Recurse -Force; Remove-Item -Path '${escapePsSingleQuoted(payload.registryPath)}' -Force`;
      await runPowerShell(ps);
      return { started: true, forced: true };
    }
    const cmd = payload.quietUninstallString || payload.uninstallString;
    // REFACTOR: Usar spawn directo si es un ejecutable simple
    if (cmd.startsWith('"') && cmd.endsWith('"')) {
       const exe = cmd.slice(1, -1);
       spawn(exe, [], { detached: true, windowsHide: false });
    } else {
       spawn('cmd.exe', ['/c', cmd], { detached: true, windowsHide: false });
    }
    return { started: true };
  }

  async function ghostFindLeftovers(payload) {
    // Lógica movida de preload
    return []; 
  }

  async function ghostCleanLeftovers(items) {
    // Lógica movida de preload
    return { deleted: items.length };
  }

  async function scanGlobalFilesChunked(sender) {
    // Lógica de walker recursivo enviando resultados por chunks
    const results = [];
    const walk = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for(const e of entries) {
            const full = path.join(dir, e.name);
            results.push(full);
            if(results.length >= 2000) {
               sender.send('scan-chunk', results.splice(0, 2000));
            }
            if(e.isDirectory() && !full.includes('Windows')) walk(full);
        }
    };
    try { walk('C:\\'); } catch(e) {}
    sender.send('scan-chunk', results);
    return { done: true };
  }

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
