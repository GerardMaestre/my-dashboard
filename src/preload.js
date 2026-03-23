const { contextBridge, ipcRenderer, shell } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const isPackaged = __dirname.includes('app.asar');
const storageDir = isPackaged
	? path.join(process.resourcesPath, 'mis_scripts')
	: path.join(__dirname, '..', 'mis_scripts');

const activeProcesses = new Map();
const outputListeners = new Set();
const exitListeners = new Set();
const forceExternalScripts = new Set(['07_Herramientas_Pro/Desinstalador_Root.bat']);

const appDataNexus = path.join(process.env.APPDATA || process.env.USERPROFILE, 'HorusEngine');
const pythonEnvPath = isPackaged 
	? path.join(appDataNexus, 'env_python') 
	: path.join(storageDir, 'env_python');
const pythonExePath = path.join(pythonEnvPath, 'python.exe');

const toolCandidates = {
	es: [
		path.join(storageDir, 'tools', 'es.exe'),
		path.join(process.cwd(), 'tools', 'es.exe'),
		'Everything\\es.exe'
	],
	wiztree: [
		path.join(storageDir, 'tools', 'WizTree64.exe'),
		path.join(process.cwd(), 'tools', 'WizTree64.exe')
	],
	geek: [
		path.join(storageDir, 'tools', 'GeekUninstaller.exe'),
		path.join(process.cwd(), 'tools', 'GeekUninstaller.exe')
	]
};

// Autoinstalador silencioso de Python Portable
function ensureStandaloneEnvironment() {
    const pipPath = path.join(pythonEnvPath, 'Scripts', 'pip.exe');
    const pyZipPath = path.join(pythonEnvPath, 'python311.zip');
    
    // Si ya existe python, su núcleo comprimido Y pip, estamos listos.
    if (fs.existsSync(pythonExePath) && fs.existsSync(pyZipPath) && fs.existsSync(pipPath)) return;
    
    try {
        if (fs.existsSync(pythonEnvPath)) {
            // Borrado forzado si el entorno existe pero está roto (sin pip)
            try { fs.rmSync(pythonEnvPath, { recursive: true, force: true }); } catch (e) {}
        }
        
        fs.mkdirSync(pythonEnvPath, { recursive: true });
        const zipPath = path.join(pythonEnvPath, 'python.zip');
        const getPipBase = path.join(pythonEnvPath, 'get-pip.py');
        
        // Pide a powershell descargar Python en modo sigiloso, activar site-packages e instalar pip
        const psCommand = `
        $ProgressPreference = 'SilentlyContinue';
        Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.11.8/python-3.11.8-embed-amd64.zip" -OutFile "${zipPath}";
        Expand-Archive -Path "${zipPath}" -DestinationPath "${pythonEnvPath}" -Force;
        Remove-Item "${zipPath}";
        $PthFile = Join-Path "${pythonEnvPath}" "python311._pth";
        (Get-Content $PthFile) -replace '#import site', 'import site' | Set-Content $PthFile;
        Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile "${getPipBase}";
        & "${pythonExePath}" "${getPipBase}" --no-warn-script-location;
        Remove-Item "${getPipBase}";
        `;

        execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand], { windowsHide: true }, (err) => {
            if (!err && fs.existsSync(pipPath)) {
                setTimeout(() => emitOutput({ fileName: 'Sistema', type: 'system', message: 'Entorno Python y Pip instalados correctamente' }), 2000);
            } else {
                try { fs.rmSync(pythonEnvPath, { recursive: true, force: true }); } catch (e) {}
                setTimeout(() => emitOutput({ fileName: 'Sistema', type: 'error', message: 'Fallo al instalar entorno Python (verifique su conexión)' }), 2000);
            }
        });
    } catch(e) {
		// Si falla el instalador, al menos deja evidencia en consola para debug
		console.error('[HorusEngine] Error instalando entorno Python:', e);
    }
}

// Ejecutamos silenciosamente al arrancar
ensureStandaloneEnvironment();

function ensureStorageDir() {
	if (!fs.existsSync(storageDir)) {
		fs.mkdirSync(storageDir, { recursive: true });
	}
}

function splitArgs(input) {
	const args = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let match = null;
	while ((match = re.exec(input)) !== null) {
		args.push(match[1] ?? match[2] ?? match[3]);
	}
	return args;
}

function normalizeRelativePath(fileName) {
	return String(fileName || '').replace(/\\/g, '/');
}

function toOsRelativePath(fileName) {
	return normalizeRelativePath(fileName).replace(/\//g, path.sep);
}

function shouldForceExternal(fileName) {
	return forceExternalScripts.has(normalizeRelativePath(fileName));
}

function createSanitizedEnv(baseEnv = process.env) {
	const envBlock = Object.assign({}, baseEnv);
	delete envBlock.PYTHONHOME;
	delete envBlock.PYTHONPATH;
	return envBlock;
}

function quoteCmdArg(arg) {
	const escaped = String(arg).replace(/"/g, '\\"');
	return `"${escaped}"`;
}

function findExistingTool(paths) {
	for (const candidate of paths) {
		if (fs.existsSync(candidate)) return candidate;
	}
	return null;
}

function runPowerShell(command, timeout = 60000) {
	return new Promise((resolve, reject) => {
		execFile(
			'powershell.exe',
			['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
			{ windowsHide: true, timeout, maxBuffer: 1024 * 1024 * 10 },
			(err, stdout, stderr) => {
				if (err) {
					if (err.killed) {
						reject(new Error(`Tiempo de espera agotado tras ${Math.round(timeout / 1000)}s`));
						return;
					}
					reject(new Error(stderr || err.message));
					return;
				}
				resolve({ stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
			}
		);
	});
}

function safeJsonParse(payload, fallback = []) {
	if (!payload) return fallback;
	try {
		const parsed = JSON.parse(payload);
		if (Array.isArray(parsed)) return parsed;
		if (parsed && typeof parsed === 'object') return [parsed];
		return fallback;
	} catch {
		return fallback;
	}
}

function escapePsSingleQuoted(value) {
	return String(value || '').replace(/'/g, "''");
}

async function ghostSearchFiles(query, limit = 120) {
	const normalizedQuery = String(query || '').trim();
	if (!normalizedQuery || normalizedQuery.length < 2) return [];
	const normalizedLimit = Math.max(100, Math.min(Number(limit) || 120, 12000));
	const qLower = normalizedQuery.toLowerCase();
	const isExeQuery = qLower === '.exe' || qLower === 'exe' || qLower.endsWith('.exe');
	const rawTerm = normalizedQuery.replace(/\.exe/gi, '').trim();
	const effectiveTerm = rawTerm || normalizedQuery;
	const esSearchQuery = isExeQuery ? (rawTerm ? `ext:exe ${rawTerm}` : 'ext:exe') : normalizedQuery;

	const esPath = findExistingTool(toolCandidates.es);
	if (esPath) {
		try {
			const { stdout } = await new Promise((resolve, reject) => {
				execFile(esPath, ['-n', String(normalizedLimit), esSearchQuery], { windowsHide: true, maxBuffer: 1024 * 1024 * 16 }, (err, out, errOut) => {
					if (err) {
						reject(new Error(errOut || err.message));
						return;
					}
					resolve({ stdout: out || '' });
				});
			});
			return stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean)
				.slice(0, normalizedLimit)
				.map((fullPath, idx) => ({ id: `es-${idx}`, name: path.basename(fullPath), fullPath }));
		} catch {
			// Continue with fallback.
		}
	}

	const q = escapePsSingleQuoted(effectiveTerm);
	const maxLocal = Math.max(200, Math.min(normalizedLimit, 12000));
	const exePattern = isExeQuery ? '*.exe' : '*';
	const matchCondition = isExeQuery && !rawTerm
		? '$true'
		: '($_.Name -like "*$term*" -or $_.FullName -like "*$term*")';
	const ps = `
	$ErrorActionPreference = 'SilentlyContinue';
	$term = '${q}';
	$max = ${maxLocal};
	$pattern = '${exePattern}';
	$roots = @();
	if (Test-Path "$env:SystemDrive\\Users") { $roots += "$env:SystemDrive\\Users" }
	if (Test-Path "$env:SystemDrive\\Program Files") { $roots += "$env:SystemDrive\\Program Files" }
	if (Test-Path "$env:SystemDrive\\Program Files (x86)") { $roots += "$env:SystemDrive\\Program Files (x86)" }
	if (Test-Path "$env:SystemDrive\\") { $roots += "$env:SystemDrive\\" }
	$files = @();
	foreach ($root in $roots) {
	  $files += Get-ChildItem -Path $root -File -Recurse -Filter $pattern -ErrorAction SilentlyContinue |
	    Where-Object { ${matchCondition} } |
	    Select-Object -First $max -Property FullName, Name;
	  if ($files.Count -ge $max) { break }
	}
	$files | Select-Object -First $max | ConvertTo-Json -Compress
	`;

	const { stdout } = await runPowerShell(ps, 180000);
	const items = safeJsonParse(stdout, []);
	return items.map((item, idx) => ({
		id: `native-${idx}`,
		name: item.Name || path.basename(item.FullName || ''),
		fullPath: item.FullName || ''
	})).filter((x) => x.fullPath);
}

async function ghostScanDisk(rootPath = 'C:\\') {
	const base = String(rootPath || 'C:\\');
	const wiztreePath = findExistingTool(toolCandidates.wiztree);
	if (wiztreePath) {
		try {
			const tempCsv = path.join(appDataNexus, 'wiztree-export.csv');
			fs.mkdirSync(appDataNexus, { recursive: true });
			await new Promise((resolve, reject) => {
				execFile(
					wiztreePath,
					[base, `/export=${tempCsv}`, '/admin=0'],
					{ windowsHide: true, timeout: 120000 },
					(err) => err ? reject(err) : resolve()
				);
			});
			if (fs.existsSync(tempCsv)) {
				const csvRaw = fs.readFileSync(tempCsv, 'utf8');
				const lines = csvRaw.split(/\r?\n/).filter(Boolean).slice(1, 150);
				const rows = lines.map((line, idx) => {
					const cols = line.split(',');
					const fullPath = (cols[0] || '').replace(/^"|"$/g, '');
					const sizeBytes = Number((cols[2] || '0').replace(/[^\d]/g, '')) || 0;
					return { id: `wiz-${idx}`, fullPath, sizeBytes };
				}).filter((x) => x.fullPath && x.sizeBytes > 0).sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 25);
				const total = rows.reduce((acc, cur) => acc + cur.sizeBytes, 0) || 1;
				return {
					engine: 'wiztree',
					items: rows.map((item) => ({
						...item,
						name: path.basename(item.fullPath),
						percent: Math.max(1, Math.round((item.sizeBytes * 100) / total))
					}))
				};
			}
		} catch {
			// Continue with fallback.
		}
	}

	const root = escapePsSingleQuoted(base);
	const ps = `
	$ErrorActionPreference = 'SilentlyContinue';
	$root='${root}';
	$entries = Get-ChildItem -Path $root -Force -ErrorAction SilentlyContinue;
	$rows = @();
	foreach($e in $entries){
	  if($e.PSIsContainer){
	    $size = (Get-ChildItem -Path $e.FullName -File -Recurse -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum;
	    if(-not $size){ $size = 0 }
	    if($size -gt 0){
	      $rows += [PSCustomObject]@{ FullPath=$e.FullName; Name=$e.Name; SizeBytes=[int64]$size; Kind='dir' }
	    }
	  } else {
	    $size = [int64]$e.Length;
	    if($size -gt 0){
	      $rows += [PSCustomObject]@{ FullPath=$e.FullName; Name=$e.Name; SizeBytes=$size; Kind='file' }
	    }
	  }
	}
	$rows | Sort-Object SizeBytes -Descending | Select-Object -First 120 | ConvertTo-Json -Compress
	`;

	const { stdout } = await runPowerShell(ps, 180000);
	const rows = safeJsonParse(stdout, []);
	const total = rows.reduce((acc, cur) => acc + Number(cur.SizeBytes || 0), 0) || 1;
	return {
		engine: 'native',
		items: rows.map((item, idx) => {
			const sizeBytes = Number(item.SizeBytes || 0);
			return {
				id: `native-${idx}`,
				fullPath: item.FullPath,
				name: item.Name || path.basename(item.FullPath || ''),
				sizeBytes,
				percent: Math.max(1, Math.round((sizeBytes * 100) / total))
			};
		})
	};
}

async function ghostListInstalledApps() {
	const ps = `
	$ErrorActionPreference = 'SilentlyContinue';
	$keys = @(
	  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
	  'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
	  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
	);
	$apps = Get-ItemProperty $keys -ErrorAction SilentlyContinue |
	  Where-Object { $_.DisplayName -and $_.UninstallString } |
	  Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, UninstallString, QuietUninstallString, DisplayIcon, PSChildName |
	  Sort-Object DisplayName -Unique;
	$apps | ConvertTo-Json -Compress
	`;
	const { stdout } = await runPowerShell(ps, 60000);
	const apps = safeJsonParse(stdout, []);
	return apps.map((item, idx) => ({
		id: item.PSChildName || `app-${idx}`,
		name: item.DisplayName || 'Sin nombre',
		version: item.DisplayVersion || '-',
		publisher: item.Publisher || 'Desconocido',
		installLocation: item.InstallLocation || '',
		uninstallString: item.UninstallString || '',
		quietUninstallString: item.QuietUninstallString || '',
		displayIcon: item.DisplayIcon || ''
	}));
}

async function ghostUninstallApp(payload) {
	const uninstallString = String(payload?.uninstallString || '').trim();
	const quietUninstallString = String(payload?.quietUninstallString || '').trim();
	const appName = String(payload?.name || 'Aplicacion');
	const installLocation = String(payload?.installLocation || '').trim();
	const appKey = String(payload?.id || '').trim();
	if (!uninstallString && !quietUninstallString) throw new Error('No hay comando de desinstalacion disponible');

	const cmd = escapePsSingleQuoted(quietUninstallString || uninstallString);
	const name = escapePsSingleQuoted(appName);
	const installPath = escapePsSingleQuoted(installLocation);
	const key = escapePsSingleQuoted(appKey);
	const ps = `
	$ErrorActionPreference = 'Stop';
	$raw = '${cmd}';
	$appName = '${name}';
	$installLocation = '${installPath}';
	$appKey = '${key}';

	function Normalize-UninstallCommand([string]$line) {
	  $line = ($line ?? '').Trim();
	  if (-not $line) { return @{ File=''; Args=''; IsMsi=$false } }
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
	  return @{ File=$file; Args=$args; IsMsi=$isMsi }
	}

	function Invoke-AutoUninstall([string]$line) {
	  $parsed = Normalize-UninstallCommand $line;
	  $code = -1;
	  if ($parsed.IsMsi) {
	    $all = ($line -replace '/I','/X');
	    if ($all -notmatch '/X') { $all = '/X ' + $all }
	    if ($all -notmatch '/qn') { $all += ' /qn' }
	    if ($all -notmatch '/norestart') { $all += ' /norestart' }
	    $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList $all -Verb RunAs -WindowStyle Hidden -PassThru -Wait;
	    return $p.ExitCode
	  }

	  if (-not $parsed.File) { throw 'Comando de desinstalacion invalido' }
	  $argBase = $parsed.Args;
	  $silentCandidates = @(' /S',' /silent',' /verysilent',' /qn',' /quiet',' /SILENT /NORESTART');
	  foreach ($s in $silentCandidates) {
	    try {
	      $p = Start-Process -FilePath $parsed.File -ArgumentList ($argBase + $s) -Verb RunAs -WindowStyle Hidden -PassThru -Wait -ErrorAction Stop;
	      $code = $p.ExitCode;
	      if ($code -in @(0, 1605, 3010)) { return $code }
	    } catch {
	      continue
	    }
	  }

	  $p2 = Start-Process -FilePath $parsed.File -ArgumentList $argBase -Verb RunAs -WindowStyle Hidden -PassThru -Wait;
	  return $p2.ExitCode
	}

	function Remove-AppRegistryEntries([string]$subKey) {
	  if (-not $subKey) { return 0 }
	  if ($subKey -notmatch '^[a-zA-Z0-9_\-\{\}\.]{2,128}$') { return 0 }
	  $count = 0
	  $paths = @(
	    "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$subKey",
	    "HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$subKey",
	    "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$subKey"
	  )
	  foreach ($p in $paths) {
	    if (Test-Path $p) {
	      try { Remove-Item -Path $p -Recurse -Force -ErrorAction Stop; $count++ } catch {}
	    }
	  }
	  return $count
	}

	function Remove-AppArtifacts([string]$name,[string]$installDir) {
	  $deleted = 0
	  if ($installDir -and (Test-Path $installDir)) {
	    $normalized = $installDir.ToLower()
	    $safeRoots = @('c:\\program files\\','c:\\program files (x86)\\','c:\\users\\','c:\\programdata\\')
	    $isUnderSafeRoot = $false
	    foreach($r in $safeRoots){ if($normalized.StartsWith($r)){ $isUnderSafeRoot = $true; break } }
	    $blocked = @('c:\\','c:\\windows','c:\\windows\\system32','c:\\program files','c:\\program files (x86)')
	    $isBlocked = $blocked -contains $normalized.TrimEnd('\\')
	    if ($isUnderSafeRoot -and -not $isBlocked -and $installDir.Length -gt 14) {
	      try { Remove-Item -Path $installDir -Recurse -Force -ErrorAction Stop; $deleted++ } catch {}
	    }
	  }
	  $lnkRoots = @("$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs","$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs","$env:PUBLIC\\Desktop")
	  foreach ($root in $lnkRoots) {
	    if (Test-Path $root) {
	      try {
	        Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue |
	          Where-Object { $_.Name -like "*$name*" -and $_.Extension -in @('.lnk','.url') } |
	          ForEach-Object { try { Remove-Item $_.FullName -Force -ErrorAction Stop; $deleted++ } catch {} }
	      } catch {}
	    }
	  }
	  return $deleted
	}

	$exitCode = Invoke-AutoUninstall $raw
	$removedReg = Remove-AppRegistryEntries $appKey
	$removedArtifacts = Remove-AppArtifacts $appName $installLocation
	Write-Output ('DONE:${name}|EXIT:' + $exitCode + '|REG:' + $removedReg + '|FILES:' + $removedArtifacts)
	`;
	const { stdout } = await runPowerShell(ps, 240000);
	if (!stdout.includes('DONE:')) {
		throw new Error('No se pudo confirmar la desinstalacion automatica');
	}
	const exitPart = stdout.split('|EXIT:')[1]?.split('|')[0] || '1';
	const regPart = stdout.split('|REG:')[1]?.split('|')[0] || '0';
	const filePart = stdout.split('|FILES:')[1]?.split('|')[0] || '0';
	const exitCode = Number(exitPart);
	return {
		started: true,
		appName,
		exitCode,
		cleanupPerformed: (Number(regPart) + Number(filePart)) > 0,
		removedRegistryEntries: Number(regPart),
		removedArtifacts: Number(filePart)
	};
}

function getScriptInfo(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.py') {
        // Usa el portátil si ya se bajó, si no (la primera vez), usa el temporal del PATH o falla sigilosamente
        return { cmd: fs.existsSync(pythonExePath) ? pythonExePath : 'python' };
    }
    if (ext === '.bat' || ext === '.cmd') return { cmd: 'cmd.exe', isCmdScript: true };
    if (ext === '.sh') return { cmd: 'bash' };
    return { cmd: fileName };
}

function emitOutput(payload) {
	for (const listener of outputListeners) {
		listener(payload);
	}
}

function emitExit(payload) {
	for (const listener of exitListeners) {
		listener(payload);
	}
}

function runInternal(fileName, args) {
	const filePath = path.join(storageDir, toOsRelativePath(fileName));
	const info = getScriptInfo(fileName);
	let child = null;

	if (!fs.existsSync(filePath)) {
		emitOutput({ fileName, type: 'error', message: `[SYS] No se encontró el script: ${filePath}` });
		return null;
	}

	// Clonar entorno y purgar variables Python globales que envenenan el entorno portable
	const envBlock = createSanitizedEnv(process.env);

	const spawnOptions = { 
		windowsHide: true, 
		detached: false, 
		shell: false, 
		creationFlags: 0x08000000, 
		env: envBlock 
	};
	if (info.isCmdScript) {
		child = spawn(info.cmd, ['/c', filePath, ...args], spawnOptions);
	} else if (info.cmd === fileName) {
		child = spawn(filePath, args, spawnOptions);
	} else {
		child = spawn(info.cmd, [filePath, ...args], spawnOptions);
	}

	activeProcesses.set(fileName, child);

	child.stdout.on('data', (data) => {
		emitOutput({ fileName, type: 'success', message: data.toString() });
	});

	child.stderr.on('data', (data) => {
		emitOutput({ fileName, type: 'error', message: data.toString() });
	});

	child.on('error', (error) => {
		emitOutput({ fileName, type: 'error', message: String(error) });
	});

	child.on('close', (code) => {
		activeProcesses.delete(fileName);
		if (code !== 0 && code !== null) {
			emitOutput({ fileName, type: 'error', message: `[SYS] Proceso finalizado con código ${code}. Si pedía permisos, el UAC pudo ser denegado.` });
		}
		emitExit({ fileName, code });
	});

	return child.pid;
}

function runExternal(fileName, args) {
	const filePath = path.join(storageDir, toOsRelativePath(fileName));
	const info = getScriptInfo(fileName);
	let child = null;

	emitOutput({ fileName: 'Sistema', type: 'system', message: `[VISUAL] Abriendo ejecución externa para ${fileName}` });
	if (shouldForceExternal(fileName)) {
		emitOutput({ fileName: 'Sistema', type: 'system', message: '[VISUAL] Esta herramienta puede solicitar permisos UAC y abrir su interfaz nativa.' });
	}

	const envBlock = createSanitizedEnv(process.env);

	const spawnOptions = { 
		windowsHide: false,
		detached: false,
		shell: false,
		creationFlags: 0,
		env: envBlock
	};

	if (info.isCmdScript) {
		child = spawn(info.cmd, ['/c', filePath, ...args], spawnOptions);
	} else if (info.cmd === fileName) {
		child = spawn(filePath, args, spawnOptions);
	} else {
		child = spawn(info.cmd, [filePath, ...args], spawnOptions);
	}

	activeProcesses.set(fileName, child);

	child.stdout.on('data', (data) => {
		emitOutput({ fileName, type: 'success', message: data.toString() });
	});

	child.stderr.on('data', (data) => {
		emitOutput({ fileName, type: 'error', message: data.toString() });
	});

	child.on('error', (error) => {
		emitOutput({ fileName, type: 'error', message: String(error) });
	});

	child.on('close', (code) => {
		activeProcesses.delete(fileName);
		if (code !== 0 && code !== null) {
			emitOutput({ fileName, type: 'error', message: `[SYS] Proceso finalizado con código ${code}. Si pedía permisos, el UAC pudo ser denegado.` });
		}
		emitExit({ fileName, code });
	});

	return child.pid;
}

function killProcessTree(fileName) {
	const child = activeProcesses.get(fileName);
	if (!child) return false;

	if (process.platform === 'win32') {
		execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], (err) => {
			if (err) child.kill('SIGKILL');
		});
	} else {
		child.kill('SIGKILL');
	}
	activeProcesses.delete(fileName);
	return true;
}

const api = {
	getStorageDir: async () => {
		ensureStorageDir();
		return storageDir;
	},
	listScripts: async () => {
		ensureStorageDir();
		try {
			const getFiles = async (dir, base = '') => {
				const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
				const files = await Promise.all(dirents.map((dirent) => {
					const res = path.resolve(dir, dirent.name);
					// Usamos posix.join para que siempre use '/' en la ruta relativa y funcione en regex luego
					const rel = path.posix.join(base, dirent.name);
					return dirent.isDirectory() ? getFiles(res, rel) : rel;
				}));
				// Solo mostrar archivos ejecutables en el Dashboard, esconder los de configuración o datos
				return Array.prototype.concat(...files).filter(f => f.match(/\.(py|bat|cmd|sh|exe)$/i));
			};
			return await getFiles(storageDir);
		} catch(e) { return []; }
	},
	readScriptMeta: async (fileName) => {
		// Si no es un script de texto, abortar lectura para no cargar a memoria completos
		if (!fileName.match(/\.(py|bat|cmd|sh|txt)$/i)) {
			return ["DESC: Archivo ejecutable o binario", "ARGS: Ninguno"];
		}
		const filePath = path.join(storageDir, toOsRelativePath(fileName));
		try {
			const content = await fs.promises.readFile(filePath, 'utf8');
			return content.substring(0, 1000).split(/\r?\n/);
		} catch(e) { return []; }
	},
	openPath: (fileName) => shell.openPath(path.join(storageDir, toOsRelativePath(fileName))),
	editScript: (fileName) => {
		if (fileName.includes('Inyector_Macros')) {
			const configPath = path.join(appDataNexus, 'macros_config.json');
			if (!fs.existsSync(configPath)) {
				try {
					const default_macros = {
						"/correo": "test@gmail.com",
						"/HORUS": "⚡ HORUS ENGINE ACTIVADO ⚡",
						"/atencion": "Hola, gracias por contactar. En un momento te atiendo.",
						"/gg": "Good Game Well Played! :)"
					};
					fs.mkdirSync(appDataNexus, { recursive: true });
					fs.writeFileSync(configPath, JSON.stringify(default_macros, null, 4), 'utf8');
				} catch (e) {
					console.error("Error creating default macros config:", e);
				}
			}
			spawn('notepad.exe', [configPath]);
			return;
		}
		// Forzar bloc de notas para Editar en lugar de Ejecutar (peligro default association)
		const filePath = path.join(storageDir, toOsRelativePath(fileName));
		spawn('notepad.exe', [filePath]);
	},
	openGlobalPath: (fullPath) => shell.openPath(fullPath),
	showGlobalItemInFolder: (fullPath) => shell.showItemInFolder(fullPath),
	scanGlobalFiles: (callback, progressCallback) => {
		// Modo Asincrono no bloqueante absoluto con proteccion de carrera.
		const results = [];
		const maxResults = 200000;
		const excludePatterns = ['\\Windows', '\\ProgramData', '\\node_modules', '\\.git', '\\AppData\\Local\\Microsoft'];
		let completed = false;
		let lastProgressSent = 0;
		let limitReached = false;

		const finish = () => {
			if (completed) return;
			completed = true;
			callback(results);
		};

		const maybeReportProgress = () => {
			if (!progressCallback) return;
			const now = Date.now();
			if (now - lastProgressSent < 500) return;
			lastProgressSent = now;
			progressCallback(results.length);
		};
		
		// Encontrar discos disponibles
		execFile('wmic', ['logicaldisk', 'get', 'name'], (err, stdout) => {
			let drives = ['C:'];
			if (!err) {
				const matches = stdout.match(/[A-Z]:/g);
				if (matches) drives = matches;
			}
			
			let activeWorkers = 0;
			
			async function walk(dir) {
				if (completed || limitReached) return;
				activeWorkers++;
				try {
					// Yield event loop completely to prevent UI freeze
					await new Promise(r => setTimeout(r, 0));
					
					const entries = await fs.promises.readdir(dir, { withFileTypes: true });
					for (const entry of entries) {
						if (completed || limitReached) break;
						if (entry.name.startsWith('$')) continue;
						
						const resPath = path.join(dir, entry.name);
						
						if (entry.isDirectory()) {
							// Ignorar carpetas del nucleo para no morir escaneando sistema
							if (excludePatterns.some(p => resPath.includes(p))) continue;
							if (results.length >= maxResults) {
								limitReached = true;
								break;
							}
							results.push(`DIR|${resPath}`);
							maybeReportProgress();
							walk(resPath); // disparamos el worker asíncrono sin await
						} else {
							if (results.length >= maxResults) {
								limitReached = true;
								break;
							}
							results.push(`FILE|${resPath}`);
							maybeReportProgress();
						}
					}
				} catch (e) {
					// Ignorar accesos denegados
				} finally {
					activeWorkers--;
					if (activeWorkers === 0) {
						finish();
					}
				}
			}
			
			// Iniciar crawler para cada disco
			for (const drive of drives) {
				const startDir = `${drive}\\`;
				walk(startDir);
			}

			// Respaldo por si ningun worker pudo arrancar.
			setTimeout(() => {
				if (activeWorkers === 0) finish();
			}, 25);
		});
	},
	runScript: ({ fileName, args = '', mode = 'internal' }) => {
		const parsedArgs = splitArgs(args);
		const forcedExternal = shouldForceExternal(fileName);
		const modeUsed = forcedExternal ? 'external' : mode;
		if (forcedExternal && mode !== 'external') {
			emitOutput({ fileName: 'Sistema', type: 'system', message: `[POLICY] ${fileName} se ejecuta en modo visual externo por seguridad/UX.` });
		}

		if (modeUsed === 'external') {
			const pid = runExternal(fileName, parsedArgs);
			return { pid, modeUsed, forcedExternal };
		}
		const pid = runInternal(fileName, parsedArgs);
		return { pid, modeUsed: 'internal', forcedExternal: false };
	},
	isRunning: (fileName) => activeProcesses.has(fileName),
	stopScript: (fileName) => killProcessTree(fileName),
	onProcessOutput: (callback) => {
		outputListeners.add(callback);
		return () => outputListeners.delete(callback);
	},
	onProcessExit: (callback) => {
		exitListeners.add(callback);
		return () => exitListeners.delete(callback);
	},
	windowControl: (action) => ipcRenderer.send('window-control', action),
	getGhostEngineStatus: async () => ({
		everythingAvailable: !!findExistingTool(toolCandidates.es),
		wiztreeAvailable: !!findExistingTool(toolCandidates.wiztree),
		geekAvailable: !!findExistingTool(toolCandidates.geek)
	}),
	buscarArchivo: async (query, limit = 120) => {
		const items = await ghostSearchFiles(query, limit);
		return items;
	},
	escanearDisco: async (rootPath = 'C:\\') => {
		return await ghostScanDisk(rootPath);
	},
	listarAppsInstaladas: async () => {
		return await ghostListInstalledApps();
	},
	desinstalarApp: async (payload) => {
		return await ghostUninstallApp(payload);
	}
};

try {
	contextBridge.exposeInMainWorld('api', api);
} catch (err) {
	console.error('[HorusEngine] No se pudo exponer api mediante contextBridge:', err);
}
