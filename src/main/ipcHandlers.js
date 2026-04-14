const { ipcMain, BrowserWindow, app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');

const activeProcesses = new Map(); // Para rastrear PIDs y estados

function registerIpcHandlers(managers) {
    const { diskManager, appManager, networkRadar, trayIcon, uac, config, taskQueue, scheduler } = managers;

    ipcMain.handle('get-runtime-paths', async () => ({
        isPackaged: app.isPackaged,
        resourcesBase: config.resourcesBase,
        storageDir: config.storageDir,
        writableRuntimeRoot: config.writableRuntimeRoot,
        pythonEnvPath: config.pythonEnvPath,
        toolsDir: config.toolsDir,
        bundledToolsDir: config.bundledToolsDir,
        appDataNexus: config.appDataNexus,
        portableBaseDir: config.portableBaseDir,
        env: {
            USERPROFILE: process.env.USERPROFILE || '',
            APPDATA: process.env.APPDATA || '',
            LOCALAPPDATA: process.env.LOCALAPPDATA || '',
            PROGRAMFILES: process.env.ProgramFiles || 'C:\\Program Files',
            WINDIR: process.env.WinDir || 'C:\\Windows'
        }
    }));

    ipcMain.handle('list-scripts', async () => {
        if (!fs.existsSync(config.storageDir)) return [];
        const getFiles = async (dir, base = '') => {
            const dirents = fs.readdirSync(dir, { withFileTypes: true });
            const files = await Promise.all(dirents.map((dirent) => {
                const res = path.resolve(dir, dirent.name);
                const rel = path.posix.join(base, dirent.name);
                return dirent.isDirectory() ? getFiles(res, rel) : rel;
            }));
            return Array.prototype.concat(...files).filter(f => f.match(/\.(py|bat|cmd|sh|exe)$/i));
        };
        return await getFiles(config.storageDir);
    });

    ipcMain.handle('read-script-meta', async (_event, fileName) => {
        const filePath = path.join(config.storageDir, fileName.replace(/\//g, path.sep));
        if (!fs.existsSync(filePath)) return [];
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            return content.substring(0, 1000).split(/\r?\n/);
        } catch (e) { return []; }
    });

    ipcMain.handle('edit-script', async (_event, fileName) => {
        const filePath = path.join(config.storageDir, fileName.replace(/\//g, path.sep));
        spawn('notepad.exe', [filePath]);
    });

    ipcMain.handle('run-script', async (event, { fileName, args, mode }) => {
        const filePath = path.join(config.storageDir, fileName.replace(/\//g, path.sep));
        const ext = path.extname(fileName).toLowerCase();
        let executable = filePath;
        let scriptArgs = Array.isArray(args) ? args : [args];

        if (ext === '.py') {
            executable = path.join(config.pythonEnvPath, 'python.exe');
            scriptArgs = [filePath, ...scriptArgs];
        } else if (ext === '.bat' || ext === '.cmd') {
            executable = 'cmd.exe';
            scriptArgs = ['/c', filePath, ...scriptArgs];
        }

        const spawnOptions = { 
            shell: true, 
            cwd: path.dirname(filePath), 
            windowsHide: mode === 'internal' 
        };
        
        try {
            const child = spawn(executable, scriptArgs, spawnOptions);
            activeProcesses.set(fileName, child);

            child.stdout.on('data', d => event.sender.send('process-output', { fileName, type: 'success', message: d.toString() }));
            child.stderr.on('data', d => event.sender.send('process-output', { fileName, type: 'error', message: d.toString() }));
            child.on('close', code => {
                activeProcesses.delete(fileName);
                event.sender.send('process-exit', { fileName, code });
            });
            
            return { pid: child.pid };
        } catch (e) {
            logger.error(`Error al ejecutar script ${fileName}: ${e.message}`);
            return { pid: null, error: e.message };
        }
    });

    ipcMain.handle('is-running', async (_event, fileName) => activeProcesses.has(fileName));

    ipcMain.handle('stop-script', async (_event, fileName) => {
        const child = activeProcesses.get(fileName);
        if (child) {
            child.kill();
            activeProcesses.delete(fileName);
            return { stopped: true };
        }
        return { stopped: false };
    });

    ipcMain.handle('get-file-icon', async (_event, filePath) => {
        try {
            const icon = await app.getFileIcon(filePath, { size: 'normal' });
            return icon ? icon.toDataURL() : null;
        } catch (e) { return null; }
    });

    ipcMain.handle('get-file-icons-batch', async (_event, filePaths) => {
        const results = {};
        for (const fp of filePaths) {
            try {
                const icon = await app.getFileIcon(fp, { size: 'normal' });
                results[fp] = icon ? icon.toDataURL() : null;
            } catch (e) { results[fp] = null; }
        }
        return results;
    });

    ipcMain.handle('get-ghost-engine-status', async () => ({
        everythingAvailable: !!diskManager.findExistingTool(config.toolCandidates.es),
        wiztreeAvailable: !!diskManager.findExistingTool(config.toolCandidates.wiztree),
        geekAvailable: !!diskManager.findExistingTool(config.toolCandidates.geek)
    }));

    ipcMain.handle('ghost-search-files', async (_event, query, limit) => {
        return await diskManager.ghostSearchFiles(query, limit);
    });

    ipcMain.handle('ghost-list-apps', async () => {
        return await appManager.ghostListInstalledApps();
    });

    ipcMain.handle('ghost-scan-disk', async (event, rootPath, options) => {
        return await diskManager.ghostScanDisk(event.sender, rootPath, options);
    });

    ipcMain.handle('ghost-uninstall-app', async (_event, payload, force) => {
        return await appManager.ghostUninstallApp(payload, force);
    });

    ipcMain.handle('ghost-find-leftovers', async (_event, payload) => {
        return await appManager.ghostFindLeftovers(payload);
    });

    ipcMain.handle('ghost-clean-leftovers', async (_event, items) => {
        return await appManager.ghostCleanLeftovers(items);
    });

    ipcMain.handle('scan-global-files-chunked', async (event) => {
        return await diskManager.scanGlobalFilesChunked(event.sender);
    });

    ipcMain.handle('clear-disk-scan-cache', async (_event, rootPath) => {
        diskManager.resetCache();
        return { ok: true };
    });

    ipcMain.handle('ip-intel-lookup', async (_event, ip) => {
        return await networkRadar.ipIntelLookup(ip);
    });

    ipcMain.handle('ensure-environment', async (event) => {
        const pythonExe = path.join(config.pythonEnvPath, 'python.exe');
        const wiztreeExe = path.join(config.toolsDir, 'WizTree64.exe');

        if (!fs.existsSync(pythonExe)) {
            event.sender.send('setup-progress', { status: 'Instalando Python...', percent: 10 });
            // Lógica abreviada de descarga PS (reutilizada de main.js original)
            const psZap = `$ProgressPreference = 'SilentlyContinue'; New-Item -ItemType Directory -Path "${config.pythonEnvPath}" -Force; $zip = Join-Path "${config.pythonEnvPath}" "python.zip"; Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.11.8/python-3.11.8-embed-amd64.zip" -OutFile $zip; Expand-Archive -Path $zip -DestinationPath "${config.pythonEnvPath}" -Force; Remove-Item $zip;`;
            try { await managers.appManager.runPowerShell(psZap); } catch (e) { logger.error('Fail Python spawn'); }
            event.sender.send('setup-progress', { status: 'Python Listo', percent: 50 });
        }

        if (!fs.existsSync(wiztreeExe)) {
            event.sender.send('setup-progress', { status: 'Instalando WizTree...', percent: 60 });
            const psWiz = `$ProgressPreference = 'SilentlyContinue'; New-Item -ItemType Directory -Path "${config.toolsDir}" -Force; $zip = Join-Path "${config.toolsDir}" "wiztree.zip"; Invoke-WebRequest -Uri "https://diskanalyzer.com/files/wiztree_4_21_portable.zip" -OutFile $zip; Expand-Archive -Path $zip -DestinationPath "${config.toolsDir}" -Force; Remove-Item $zip;`;
            try { await managers.appManager.runPowerShell(psWiz); } catch (e) { logger.error('Fail WizTree spawn'); }
            event.sender.send('setup-progress', { status: 'Entorno Listo', percent: 100 });
        }
        return { ok: true };
    });

    ipcMain.on('window-control', (event, action) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return;
        if (action === 'close') win.hide();
        if (action === 'minimize') win.minimize();
        if (action === 'maximize') {
            if (win.isMaximized()) win.unmaximize();
            else win.maximize();
        }
    });

    logger.info('[IPC] Handlers fully registered and synchronized.');
}

module.exports = { registerIpcHandlers };
