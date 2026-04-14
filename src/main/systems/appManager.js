const { spawn } = require('child_process');
const logger = require('../utils/logger');

class AppManager {
    constructor(runPowerShell, safeJsonParse, escapePsSingleQuoted) {
        this.runPowerShell = runPowerShell;
        this.safeJsonParse = safeJsonParse;
        this.escapePsSingleQuoted = escapePsSingleQuoted;
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
