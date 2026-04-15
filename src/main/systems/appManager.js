const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class AppManager {
    constructor(runPowerShell, safeJsonParse, escapePsSingleQuoted, options = {}) {
        this.runPowerShell = runPowerShell;
        this.safeJsonParse = safeJsonParse;
        this.escapePsSingleQuoted = escapePsSingleQuoted;
        this.storageDir = options.storageDir || process.cwd();
        this.pythonExe = options.pythonExe || '';
    }

    normalizeMode(mode) {
        return String(mode || 'internal').toLowerCase() === 'external' ? 'external' : 'internal';
    }

    normalizeArgs(args) {
        if (Array.isArray(args)) {
            return args.map((value) => String(value));
        }

        if (typeof args === 'string') {
            const trimmed = args.trim();
            return trimmed ? [trimmed] : [];
        }

        return [];
    }

    resolveScriptPath(command) {
        const normalized = String(command || '').trim();
        if (!normalized) {
            throw new Error('Command is required');
        }

        const safeRelative = normalized.replace(/[\\/]+/g, path.sep);
        const candidate = path.isAbsolute(safeRelative)
            ? safeRelative
            : path.join(this.storageDir, safeRelative);

        if (!fs.existsSync(candidate)) {
            throw new Error(`Script not found: ${normalized}`);
        }

        return candidate;
    }

    async executeScript(command, args, options = {}) {
        const scriptPath = this.resolveScriptPath(command);
        const ext = path.extname(scriptPath).toLowerCase();
        const parsedArgs = this.normalizeArgs(args);
        const mode = this.normalizeMode(options.mode);

        let executable = scriptPath;
        let spawnArgs = parsedArgs;

        if (ext === '.py') {
            executable = this.pythonExe && fs.existsSync(this.pythonExe) ? this.pythonExe : 'python';
            spawnArgs = [scriptPath, ...parsedArgs];
        } else if (ext === '.bat' || ext === '.cmd') {
            executable = 'cmd.exe';
            spawnArgs = ['/c', scriptPath, ...parsedArgs];
        } else if (ext === '.ps1') {
            executable = 'powershell.exe';
            spawnArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...parsedArgs];
        }

        return await new Promise((resolve, reject) => {
            let settled = false;

            const rejectOnce = (error) => {
                if (settled) return;
                settled = true;
                reject(error instanceof Error ? error : new Error(String(error)));
            };

            try {
                const child = spawn(executable, spawnArgs, {
                    cwd: path.dirname(scriptPath),
                    windowsHide: mode !== 'external',
                    shell: false
                });

                child.once('error', rejectOnce);

                if (child.stdout) {
                    child.stdout.on('data', (data) => {
                        if (typeof options.onOutput === 'function') {
                            options.onOutput({ type: 'success', message: data.toString() });
                        }
                    });
                }

                if (child.stderr) {
                    child.stderr.on('data', (data) => {
                        if (typeof options.onOutput === 'function') {
                            options.onOutput({ type: 'error', message: data.toString() });
                        }
                    });
                }

                child.on('close', (code) => {
                    if (typeof options.onExit === 'function') {
                        options.onExit({ code: Number.isInteger(code) ? code : -1 });
                    }
                });

                child.once('spawn', () => {
                    if (settled) return;
                    settled = true;
                    resolve({
                        started: true,
                        pid: child.pid || null,
                        command: scriptPath,
                        mode,
                        child
                    });
                });
            } catch (error) {
                rejectOnce(error);
            }
        });
    }

    async ghostListInstalledApps() {
        const ps = `
          Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*, HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* |
          Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, UninstallString, QuietUninstallString, DisplayIcon, PSChildName, PSPath |
          ConvertTo-Json -Compress
        `;
        try {
            const { stdout } = await this.runPowerShell(ps);
            return this.safeJsonParse(stdout).map((a, i) => ({
                id: a.PSChildName || `app-${i}`,
                name: a.DisplayName || 'Unknown',
                version: a.DisplayVersion || '',
                publisher: a.Publisher || '',
                installLocation: a.InstallLocation || '',
                uninstallString: a.UninstallString || '',
                quietUninstallString: a.QuietUninstallString || '',
                registryPath: a.PSPath || ''
            }));
        } catch (e) {
            logger.error(`[AppManager] Failed to list apps: ${e.message}`);
            return [];
        }
    }

    async ghostUninstallApp(payload, force) {
        if (force) {
            const ps = `
                $path = '${this.escapePsSingleQuoted(payload.installLocation)}';
                $reg = '${this.escapePsSingleQuoted(payload.registryPath)}';
                if ($path -and (Test-Path $path)) { Remove-Item -Path $path -Recurse -Force }
                if ($reg -and (Test-Path $reg)) { Remove-Item -Path $reg -Force }
            `;
            logger.info(`[AppManager] Forced uninstall for ${payload.name}`);
            await this.runPowerShell(ps);
            return { started: true, forced: true };
        }

        const cmd = payload.quietUninstallString || payload.uninstallString;
        if (!cmd) return { error: 'No uninstall string found' };

        logger.info(`[AppManager] Standard uninstall for ${payload.name}: ${cmd}`);
        
        if (cmd.startsWith('"') && cmd.endsWith('"')) {
            const exe = cmd.slice(1, -1);
            spawn(exe, [], { detached: true, windowsHide: false });
        } else {
            spawn('cmd.exe', ['/c', cmd], { detached: true, windowsHide: false });
        }
        return { started: true };
    }

    async ghostFindLeftovers(payload) {
        // Implementación futura o migrada
        logger.info(`[AppManager] Searching leftovers for ${payload.name}`);
        return []; 
    }

    async ghostCleanLeftovers(items) {
        logger.info(`[AppManager] Cleaning ${items.length} leftovers`);
        return { deleted: items.length };
    }
}

module.exports = AppManager;
