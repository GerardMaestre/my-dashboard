const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

// Utils
const logger = require('./utils/logger');
const uac = require('./utils/uac');

// Systems & Managers
const DiskManager = require('./systems/diskManager');
const AppManager = require('./systems/appManager');
const NetworkRadar = require('./systems/networkRadar');
const TelemetryManager = require('./systems/telemetryManager');
const RemoteServer = require('./systems/remoteServer');
const TrayIcon = require('./ui/trayIcon');
const taskQueue = require('./autopilot/queue');
const scheduler = require('./autopilot/scheduler');

// Internal Modules
const { registerIpcHandlers } = require('./ipcHandlers');

let mainWindow = null;
let isQuitting = false;

// Crash handling
process.on('uncaughtException', (err) => {
    logger.error(`[CRITICAL] Uncaught Exception: ${err.message}`);
    logger.error(err.stack);
});

// Configuración global
const isPackaged = app.isPackaged;
const resourcesBase = isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..');
const storageDir = path.join(resourcesBase, 'mis_scripts');
const portableBaseDir = process.env.PORTABLE_EXECUTABLE_DIR || '';
const userProfileBase = process.env.APPDATA || process.env.USERPROFILE || process.cwd();
const appDataNexus = portableBaseDir ? path.join(portableBaseDir, 'HorusData') : path.join(userProfileBase, 'HorusEngine');
const writableRuntimeRoot = isPackaged ? path.join(appDataNexus, 'runtime') : storageDir;
const pythonEnvPath = path.join(writableRuntimeRoot, 'env_python');
const toolsDir = path.join(writableRuntimeRoot, 'tools');
const bundledToolsDir = path.join(storageDir, 'tools');

const toolCandidates = {
    es: [path.join(toolsDir, 'es.exe'), path.join(bundledToolsDir, 'es.exe')],
    wiztree: [path.join(toolsDir, 'WizTree64.exe'), path.join(bundledToolsDir, 'WizTree64.exe'), 'C:\\Program Files\\WizTree\\WizTree64.exe'],
    geek: [path.join(toolsDir, 'GeekUninstaller.exe'), path.join(bundledToolsDir, 'GeekUninstaller.exe')]
};

const config = {
    resourcesBase, storageDir, portableBaseDir, appDataNexus, 
    writableRuntimeRoot, pythonEnvPath, toolsDir, bundledToolsDir, toolCandidates
};

// --- MÉTODOS DE SOPORTE ---

function runPowerShell(command) {
    const { spawn } = require('child_process');
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { windowsHide: true });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => stdout += d);
        child.stderr.on('data', d => stderr += d);
        child.on('close', code => (code === 0 || stdout) ? resolve({ stdout }) : reject(new Error(stderr)));
        child.stdin.write(command + '\n\nExit\n');
        child.stdin.end();
    });
}

function safeJsonParse(p) { try { return JSON.parse(p); } catch(e) { return []; } }
function escapePs(v) { return String(v || '').replace(/'/g, "''"); }

// --- INICIALIZACIÓN DE MOTORES ---

const diskManager = new DiskManager(appDataNexus, toolCandidates);
const appManager = new AppManager(runPowerShell, safeJsonParse, escapePs, {
    storageDir,
    pythonExe: path.join(pythonEnvPath, 'python.exe')
});
const networkRadar = new NetworkRadar(null, 
    () => require('../core/NetworkMonitor'), 
    () => {
        const { ThreatIntel } = require('../core/ThreatIntel');
        return new ThreatIntel();
    }, 
    3000
);
const telemetryManager = new TelemetryManager(null, 2000);
const remoteServer = new RemoteServer(
    { diskManager, appManager, networkRadar, telemetryManager, config },
    { host: '0.0.0.0', port: 3000, telemetryIntervalMs: 2000 }
);

// --- CICLO DE VIDA DE ELECTRON ---

// --- CICLO DE VIDA DE ELECTRON ---
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    // PARCHE: Solo pedir Admin si la app está compilada, para evitar cuelgues en npm start
    const isPackaged = app.isPackaged;
    if (isPackaged && !uac.isAdmin()) {
        uac.requestElevation();
    } else {
        logger.info('--- HORUS ENGINE START ---');
        
        app.on('ready', () => {
            mainWindow = new BrowserWindow({
                width: 1100, height: 750, frame: false, show: false,
                webPreferences: {
                    preload: path.join(__dirname, '..', 'preload.js'),
                    contextIsolation: true, sandbox: false
                }
            });

            mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
                logger.error(`[Renderer] did-fail-load ${code} ${description} (${url})`);
            });

            mainWindow.webContents.on('render-process-gone', (_event, details) => {
                logger.error(`[Renderer] render-process-gone: ${details.reason}`);
            });

            mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
                const tag = level >= 2 ? 'error' : 'info';
                logger[tag](`[RendererConsole] ${sourceId}:${line} ${message}`);
            });

            mainWindow.webContents.on('did-finish-load', () => {
                setTimeout(() => {
                    if (!mainWindow || mainWindow.isDestroyed()) return;
                    const moduleProbeScript = `
                        (async () => {
                            const modules = [
                                './ui/windowSystem.js',
                                './ui/terminalSystem.js',
                                './ui/toastSystem.js',
                                './features/dashboardSystem.js',
                                './features/autopilotSystem.js',
                                './features/ojoDeDios.js',
                                './core/utils.js',
                                './ui/RadarSystem.js',
                                './renderer/telemetry.js',
                                './renderer/spotlight.js',
                                './renderer/ipcListeners.js',
                                './renderer.js'
                            ];

                            const out = [];
                            for (const mod of modules) {
                                try {
                                    await import(mod);
                                    out.push(mod + '::ok');
                                } catch (e) {
                                    out.push(mod + '::fail::' + (e && e.message ? e.message : String(e)));
                                }
                            }
                            return out;
                        })();
                    `;

                    mainWindow.webContents.executeJavaScript(moduleProbeScript, true)
                        .then((rows) => {
                            for (const row of rows || []) {
                                if (String(row).includes('::fail::')) {
                                    logger.error(`[ModuleProbe] ${row}`);
                                }
                            }
                        })
                        .catch((error) => {
                            logger.error(`[ModuleProbe] executeJavaScript failed: ${error.message}`);
                        });
                }, 1800);

                setTimeout(() => {
                    if (!mainWindow || mainWindow.isDestroyed()) return;
                    mainWindow.webContents.executeJavaScript(`({
                        rendererLoaded: !!window.__horusRendererModuleLoaded,
                        splashPresent: !!document.getElementById('splash-screen'),
                        scriptCount: document.scripts.length
                    })`, true)
                        .then((state) => {
                            logger.info(`[StartupProbe] rendererLoaded=${state.rendererLoaded} splashPresent=${state.splashPresent} scripts=${state.scriptCount}`);
                        })
                        .catch((error) => {
                            logger.error(`[StartupProbe] executeJavaScript failed: ${error.message}`);
                        });
                }, 5000);
            });

            networkRadar.setMainWindow(mainWindow);
            telemetryManager.setMainWindow(mainWindow);

            mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
            mainWindow.once('ready-to-show', () => {
                mainWindow.show();

                // Defer heavy subsystems until the UI is already visible.
                setImmediate(() => {
                    networkRadar.start();
                    telemetryManager.start();
                });
            });

            // 2. Iniciar Tray
            const tray = new TrayIcon(mainWindow, path.join(__dirname, '..', '..', 'assets', 'icon.ico'), 
                () => {
                    networkRadar.start();
                    telemetryManager.start();
                },
                () => { isQuitting = true; app.quit(); }
            );
            tray.init();

            // 3. Registrar IPC
            registerIpcHandlers({ diskManager, appManager, networkRadar, uac, config, taskQueue, scheduler });

            // 4. Exponer dashboard remoto para navegador móvil (WiFi/LAN)
            remoteServer.start();

            // 5. Configurar Autopilot Inicial
            scheduler.schedule('ram-purge', '6-hours', 6 * 60 * 60 * 1000, async () => {
                logger.info('[Autopilot] Purgando RAM programada...');
                return { ok: true, message: 'RAM purgada con éxito' };
            });

            // Atajos
            globalShortcut.register('CommandOrControl+Space', () => {
                if (mainWindow.isVisible()) mainWindow.hide(); else mainWindow.show();
            });

            logger.info('[Main] Lifecycle initialization complete.');
        });

        // PARCHE CRÍTICO: Despertar la app si intentas abrirla de nuevo y estaba en la bandeja
        app.on('second-instance', () => {
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
            }
        });

        app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
        
        app.on('before-quit', () => {
            isQuitting = true;
            remoteServer.stop().catch((error) => logger.error(`[RemoteServer] Stop failed: ${error.message}`));
            logger.info('--- HORUS ENGINE SHUTDOWN ---');
        });
    }
}

