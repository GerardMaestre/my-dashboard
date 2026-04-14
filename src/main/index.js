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
const appManager = new AppManager(runPowerShell, safeJsonParse, escapePs);
const networkRadar = new NetworkRadar(null, 
    () => require('../core/NetworkMonitor'), 
    () => {
        const ThreatIntel = require('../core/ThreatIntel');
        return new ThreatIntel();
    }, 
    3000
);
const telemetryManager = new TelemetryManager(null, 2000);

// --- CICLO DE VIDA DE ELECTRON ---

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    if (!uac.isAdmin()) {
        uac.requestElevation();
    } else {
        logger.info('--- HORUS ENGINE START (ADMIN MODE) ---');
        
        app.on('ready', () => {
            mainWindow = new BrowserWindow({
                width: 1100, height: 750, frame: false, show: false,
                webPreferences: {
                    preload: path.join(__dirname, '..', 'preload.js'),
                    contextIsolation: true, sandbox: false
                }
            });

            mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
            mainWindow.once('ready-to-show', () => mainWindow.show());

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

            // 4. Iniciar Motores
            networkRadar.setMainWindow(mainWindow);
            networkRadar.start();
            
            telemetryManager.setMainWindow(mainWindow);
            telemetryManager.start();

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

        app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
        
        app.on('before-quit', () => {
            isQuitting = true;
            logger.info('--- HORUS ENGINE SHUTDOWN ---');
        });
    }
}
