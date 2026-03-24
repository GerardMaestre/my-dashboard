code = r"""
async function ghostUninstallApp(payload, force = false) {
    const uninstallString = String(payload?.uninstallString || '').trim();
    const quietUninstallString = String(payload?.quietUninstallString || '').trim();
    const appName = String(payload?.name || 'Aplicacion');
    const installLocation = String(payload?.installLocation || '').trim();

    if (force) {
        if (!installLocation) return { started: true, exitCode: 0, forced: true };
        const psForce = `
        $ErrorActionPreference = 'SilentlyContinue';
        if ('${escapePsSingleQuoted(installLocation)}' -and (Test-Path '${escapePsSingleQuoted(installLocation)}')) {
            Get-Process | Where-Object { $_.Path -like "${escapePsSingleQuoted(installLocation)}*" } | Stop-Process -Force
            Remove-Item -Path '${escapePsSingleQuoted(installLocation)}' -Recurse -Force
        }
        `;
        await runPowerShell(psForce, 30000);
        return { started: true, exitCode: 0, forced: true };
    }

    if (!uninstallString && !quietUninstallString) throw new Error('No hay comando de desinstalacion disponible');
    const cmd = escapePsSingleQuoted(uninstallString || quietUninstallString);

    const ps = `
    $ErrorActionPreference = 'SilentlyContinue';
    $line = '${cmd}';
    $line = ($line ?? '').Trim();
    if (-not $line) { exit 1 }

    if ($line.StartsWith('"')) {
        $parts = $line.Split('"');
        $file = ($parts[1] ?? '').Trim();
        $args = ($line.Substring([Math]::Min($line.Length, $file.Length + 2))).Trim();
    } else {
        $idx = $line.IndexOf(' ');
        if ($idx -gt 0) {
            $file = $line.Substring(0, $idx).Trim();
            $args = $line.Substring($idx + 1).Trim();
        } else {
            $file = $line;
            $args = '';
        }
    }
    
    $isMsi = ($file -match 'msiexec(\\.exe)?$') -or ($line -match 'msiexec(\\.exe)?');
    if ($isMsi) {
        $args = ($line -replace '/I','/X');
        if ($args -notmatch '/X') { $args = '/X ' + $args }
        $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList $args -Verb RunAs -WindowStyle Normal -PassThru -Wait;
        Write-Output ("EXIT:" + $p.ExitCode)
        exit 0
    }

    try {
        $p2 = Start-Process -FilePath $file -ArgumentList $args -Verb RunAs -WindowStyle Normal -PassThru -Wait -ErrorAction Stop;
        if ($p2) { Write-Output ("EXIT:" + $p2.ExitCode) }
    } catch {
        $p3 = Start-Process -FilePath ('"' + $file + '"') -ArgumentList $args -Verb RunAs -WindowStyle Normal -PassThru -Wait -ErrorAction SilentlyContinue;
        if ($p3) { Write-Output ("EXIT:" + $p3.ExitCode) }
    }
    `;
    
    const { stdout } = await runPowerShell(ps, 300000);
    const exitPart = stdout.includes('EXIT:') ? stdout.split('EXIT:')[1]?.trim() : '0';
    return { started: true, exitCode: Number(exitPart) || 0 };
}

async function ghostFindLeftovers(payload) {
    const appName = String(payload?.name || '').trim();
    const publisher = String(payload?.publisher || '').trim();
    if (!appName) return [];

    const ps = `
    $ErrorActionPreference = 'SilentlyContinue';
    $AppName = '${escapePsSingleQuoted(appName)}';
    $Publisher = '${escapePsSingleQuoted(publisher)}';
    $FoundItems = @()

    $invalidNames = @('Microsoft', 'Microsoft Corporation', 'Windows', 'Intel', 'AMD', 'NVIDIA')

    if ([string]::IsNullOrWhiteSpace($AppName) -eq $false) {
        $appDataPaths = @($env:APPDATA, $env:LOCALAPPDATA, $env:PROGRAMDATA, "$env:USERPROFILE\\Documents")
        foreach ($path in $appDataPaths) {
            $targetAppFolder = Join-Path -Path $path -ChildPath $AppName
            if (Test-Path $targetAppFolder) { $FoundItems += @{Type='Folder'; Path=$targetAppFolder} }
        }

        $regPaths = @("HKCU:\\Software", "HKLM:\\Software", "HKLM:\\SOFTWARE\\WOW6432Node")
        foreach ($reg in $regPaths) {
            $targetAppKey = "$reg\\$AppName"
            if (Test-Path $targetAppKey) { $FoundItems += @{Type='Registry'; Path=$targetAppKey} }
        }
    }

    if ([string]::IsNullOrWhiteSpace($Publisher) -eq $false -and ($invalidNames -notcontains $Publisher)) {
        $appDataPaths = @($env:APPDATA, $env:LOCALAPPDATA, $env:PROGRAMDATA)
        foreach ($path in $appDataPaths) {
            $targetPubFolder = Join-Path -Path $path -ChildPath $Publisher
            if (Test-Path $targetPubFolder) { $FoundItems += @{Type='Folder'; Path=$targetPubFolder} }
        }

        $regPaths = @("HKCU:\\Software", "HKLM:\\Software", "HKLM:\\SOFTWARE\\WOW6432Node")
        foreach ($reg in $regPaths) {
            $targetPubKey = "$reg\\$Publisher"
            if (Test-Path $targetPubKey) { $FoundItems += @{Type='Registry'; Path=$targetPubKey} }
        }
    }

    $FoundItems | ConvertTo-Json -Compress
    `;
    
    const { stdout } = await runPowerShell(ps, 60000);
    if (!stdout.trim() || stdout.trim() === 'null') return [];
    try { 
        let raw = stdout.trim();
        let p = raw.indexOf('[');
        if (p == -1) p = raw.indexOf('{');
        if (p != -1) raw = raw.substring(p);
        let items = JSON.parse(raw); 
        return Array.isArray(items) ? items : (items ? [items] : []); 
    } catch(e) { return []; }
}

async function ghostCleanLeftovers(items) {
    if (!Array.isArray(items) || items.length === 0) return { deleted: 0 };
    let deletedCount = 0;
    for (const item of items) {
        if (!item.Path || item.Path.length < 10) continue; 
        try {
            const pathE = escapePsSingleQuoted(item.Path);
            let ps = '';
            if (item.Type === 'Registry') {
                ps = `Remove-Item -Path '${pathE}' -Recurse -Force -ErrorAction SilentlyContinue`;
            } else {
                ps = `Remove-Item -Path '${pathE}' -Recurse -Force -ErrorAction SilentlyContinue`;
            }
            await runPowerShell(ps, 15000);
            deletedCount++;
        } catch (e) {}
    }
    return { deleted: deletedCount };
}
"""

with open('src/preload.js', 'r', encoding='utf-8') as f:
    text = f.read()

sIdx = text.find('async function ghostUninstallApp(payload, force = false) {')
eIdx = text.find('function getScriptInfo(fileName) {')

if sIdx != -1 and eIdx != -1:
    with open('src/preload.js', 'w', encoding='utf-8') as f:
        f.write(text[:sIdx] + code + '\n  ' + text[eIdx:])
