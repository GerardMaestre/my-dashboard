const fs = require('fs');
let content = fs.readFileSync('src/preload.js', 'utf8');

// Replace ghostUninstallApp entirely
const ghostUninstallReplace = sync function ghostUninstallApp(payload, force = false) {
    const uninstallString = String(payload?.uninstallString || '').trim();
    const quietUninstallString = String(payload?.quietUninstallString || '').trim();
    const appName = String(payload?.name || 'Aplicacion');
    const installLocation = String(payload?.installLocation || '').trim();

    if (force) {
        // En forzar desinstalacion, saltamos el desinstalador e intentamos matar procesos y borrar InstallLocation
        const psForce = \\\
        \\\Continue = 'SilentlyContinue';
        if ('\\\' -and (Test-Path '\\\')) {
            # Intentar matar procesos que corran desde ahi
            Get-Process | Where-Object { \\\.Path -like "\\\*" } | Stop-Process -Force
            # Borrar capeta principal
            Remove-Item -Path '\\\' -Recurse -Force
        }
        \\\;
        await runPowerShell(psForce, 30000);
        return { started: true, exitCode: 0, forced: true };
    }

    if (!uninstallString && !quietUninstallString) throw new Error('No hay comando de desinstalacion disponible');

    const cmd = escapePsSingleQuoted(uninstallString || quietUninstallString);

    const ps = \\\
    \\\Continue = 'Stop';
    \\\ = '\\\';
    
    \\\ = (\\\ ?? '').Trim();
    if (-not \\\) { exit 1 }

    if (\\\.StartsWith('"')) {
        \\\ = \\\.Split('"');
        \\\ = (\\\[1] ?? '').Trim();
        \\\ = (\\\.Substring([Math]::Min(\\\.Length, \\\.Length + 2))).Trim();
    } else {
        \\\ = \\\.IndexOf(' ');
        if (\\\ -gt 0) {
            \\\ = \\\.Substring(0, \\\).Trim();
            \\\ = \\\.Substring(\\\ + 1).Trim();
        } else {
            \\\ = \\\;
            \\\ = '';
        }
    }
    
    \\\ = (\\\ -match 'msiexec(\\\\.exe)?\\\$\') -or (\\\ -match 'msiexec(\\\\.exe)?');
    if (\\\) {
        \\\ = (\\\ -replace '/I','/X');
        if (\\\ -notmatch '/X') { \\\ = '/X ' + \\\ }
        \\\ = Start-Process -FilePath 'msiexec.exe' -ArgumentList \\\ -Verb RunAs -WindowStyle Normal -PassThru -Wait;
        Write-Output ("EXIT:" + \\\.ExitCode)
        exit 0
    }

    try {
        \\\ = Start-Process -FilePath \\\ -ArgumentList \\\ -Verb RunAs -WindowStyle Normal -PassThru -Wait;
        if (\\\) { Write-Output ("EXIT:" + \\\.ExitCode) }
    } catch {
        \\\ = Start-Process -FilePath ('"' + \\\ + '"') -ArgumentList \\\ -Verb RunAs -WindowStyle Normal -PassThru -Wait -ErrorAction SilentlyContinue;
        if (\\\) { Write-Output ("EXIT:" + \\\.ExitCode) }
    }
    \\\;
    
    const { stdout } = await runPowerShell(ps, 300000);
    const exitPart = stdout.includes('EXIT:') ? stdout.split('EXIT:')[1]?.trim() : '0';
    return { started: true, exitCode: Number(exitPart) || 0 };
}

async function ghostFindLeftovers(payload) {
    const appName = String(payload?.name || '').trim();
    const publisher = String(payload?.publisher || '').trim();
    
    const ps = \\\
    \\\Continue = 'SilentlyContinue';
    \\\ = '\\\';
    \\\ = '\\\';
    \\\ = @()

    \\\ = @('Microsoft', 'Microsoft Corporation', 'Windows', 'Intel', 'AMD', 'NVIDIA')

    if ([string]::IsNullOrWhiteSpace(\\\) -eq \\\False) {
        \\\ = @(\\\C:\Users\gerar\AppData\Roaming, \\\C:\Users\gerar\AppData\Local, \\\C:\ProgramData)
        foreach (\\\ in \\\) {
            \\\ = Join-Path -Path \\\ -ChildPath \\\
            if (Test-Path \\\) { \\\ += @{Type='Folder'; Path=\\\} }
        }

        \\\ = @("HKCU:\\\\Software", "HKLM:\\\\Software", "HKLM:\\\\SOFTWARE\\\\WOW6432Node")
        foreach (\\\ in \\\) {
            \\\ = "\\\\\\\\\\"
            if (Test-Path \\\) { \\\ += @{Type='Registry'; Path=\\\} }
        }
    }

    if ([string]::IsNullOrWhiteSpace(\\\) -eq \\\False -and (\\\ -notcontains \\\)) {
        \\\ = @(\\\C:\Users\gerar\AppData\Roaming, \\\C:\Users\gerar\AppData\Local, \\\C:\ProgramData)
        foreach (\\\ in \\\) {
            \\\ = Join-Path -Path \\\ -ChildPath \\\
            if (Test-Path \\\) { \\\ += @{Type='Folder'; Path=\\\} }
        }

        \\\ = @("HKCU:\\\\Software", "HKLM:\\\\Software", "HKLM:\\\\SOFTWARE\\\\WOW6432Node")
        foreach (\\\ in \\\) {
            \\\ = "\\\\\\\\\\"
            if (Test-Path \\\) { \\\ += @{Type='Registry'; Path=\\\} }
        }
    }

    \\\ | ConvertTo-Json -Compress
    \\\;
    
    const { stdout } = await runPowerShell(ps, 60000);
    return safeJsonParse(stdout, []);
}

async function ghostCleanLeftovers(items) {
    if (!Array.isArray(items) || items.length === 0) return { deleted: 0 };
    
    let deletedCount = 0;
    for (const item of items) {
        try {
            if (item.Type === 'Folder') {
                const ps = \\\Remove-Item -Path '\\\' -Recurse -Force -ErrorAction SilentlyContinue\\\;
                await runPowerShell(ps, 15000);
                deletedCount++;
            } else if (item.Type === 'Registry') {
                // Remove-Item for registry
                const ps = \\\Remove-Item -Path '\\\' -Recurse -Force -ErrorAction SilentlyContinue\\\;
                await runPowerShell(ps, 15000);
                deletedCount++;
            }
        } catch (e) {}
    }
    return { deleted: deletedCount };
};

const startIndex = content.indexOf('async function ghostUninstallApp(payload) {');
let endIndex = content.indexOf('function getScriptInfo(fileName) {');
if (startIndex !== -1 && endIndex !== -1) {
    content = content.substring(0, startIndex) + ghostUninstallReplace + '\n\n  ' + content.substring(endIndex);
    
    // Add new API handlers
    content = content.replace('desinstalarApp: async (payload) => {', 'desinstalarApp: async (payload, force = false) => {');
    content = content.replace('return await ghostUninstallApp(payload);', 'return await ghostUninstallApp(payload, force);\n        },\n        buscarRastrosApp: async (payload) => {\n                return await ghostFindLeftovers(payload);\n        },\n        limpiarRastrosApp: async (items) => {\n                return await ghostCleanLeftovers(items);');
    
    fs.writeFileSync('src/preload.js', content, 'utf8');
    console.log('patched');
} else {
    console.log('not found');
}
