const { contextBridge, ipcRenderer, shell } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const isPackaged = __dirname.includes('app.asar');

const resourcesBase = isPackaged 
	? process.resourcesPath 
	: path.join(__dirname, '..');

const storageDir = path.join(resourcesBase, 'mis_scripts');
const pythonEnvPath = path.join(storageDir, 'env_python');
const toolsDir = path.join(storageDir, 'tools');
const pythonExePath = path.join(pythonEnvPath, 'python.exe');

const activeProcesses = new Map();
const outputListeners = new Set();
const exitListeners = new Set();
const forceExternalScripts = new Set(['07_Herramientas_Pro/Desinstalador_Root.bat', '06_Personalizacion/Spicetify.bat']);

const diskScanCache = new Map();
const inFlightScans = new Map();

const portableBaseDir = process.env.PORTABLE_EXECUTABLE_DIR || '';
const appDataNexus = portableBaseDir
	? path.join(portableBaseDir, 'HorusData')
	: path.join(process.env.APPDATA || process.env.USERPROFILE, 'HorusEngine');

const toolCandidates = {
	es: [
		path.join(toolsDir, 'es.exe'),
		'Everything\\es.exe'
	],
	mft: [
		path.join(toolsDir, 'mft_reader.exe'),
		path.join(resourcesBase, 'native_modules', 'mft_reader', 'target', 'release', 'mft_reader.exe')
	],
	wiztree: [
		path.join(toolsDir, 'WizTree64.exe'),
		'C:\\Program Files\\WizTree\\WizTree64.exe'
	],
	geek: [
		path.join(toolsDir, 'GeekUninstaller.exe')
	]
};

// Autoinstalador silencioso de Python Portable y herramientas
function ensureStandaloneEnvironment() {
    const pipPath = path.join(pythonEnvPath, 'Scripts', 'pip.exe');
    const pyZipPath = path.join(pythonEnvPath, 'python311.zip');
    
    // Instalar entorno Python
    if (!fs.existsSync(pythonExePath) || !fs.existsSync(pyZipPath) || !fs.existsSync(pipPath)) {
        try {
            if (fs.existsSync(pythonEnvPath)) {
                try { fs.rmSync(pythonEnvPath, { recursive: true, force: true }); } catch (e) { console.error('[HorusEngine] Error limpiando pythonEnvPath:', e.message); }
            }
            fs.mkdirSync(pythonEnvPath, { recursive: true });
            const zipPath = path.join(pythonEnvPath, 'python.zip');
            const getPipBase = path.join(pythonEnvPath, 'get-pip.py');
            
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
                    setTimeout(() => emitOutput({ fileName: 'Sistema', type: 'system', message: 'Entorno Python instalado correctamente' }), 2000);
                } else if (err) {
                    console.error('[HorusEngine] Error instalando Python portable:', err.message);
                }
            });
        } catch(e) { console.error('[HorusEngine] Error critico en setup Python:', e.message); }
    }

    // Instalar WizTree Integrado
    const wiztreeExePath = path.join(toolsDir, 'WizTree64.exe');
    
    if (!fs.existsSync(wiztreeExePath)) {
        try {
            if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });
            const wizZip = path.join(toolsDir, 'wiztree.zip');
            const psCommand = `
            $ProgressPreference = 'SilentlyContinue';
            Invoke-WebRequest -Uri "https://diskanalyzer.com/files/wiztree_4_21_portable.zip" -OutFile "${wizZip}";
            Expand-Archive -Path "${wizZip}" -DestinationPath "${toolsDir}" -Force;
            Remove-Item "${wizZip}";
            `;
            execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand], { windowsHide: true }, (err) => {
               if (!err && fs.existsSync(wiztreeExePath)) {
                   setTimeout(() => emitOutput({ fileName: 'Sistema', type: 'system', message: 'Motor WizTree instalado y activo' }), 2500);
               } else if (err) {
                   console.error('[HorusEngine] Error instalando WizTree:', err.message);
               }
            });
        } catch(e) { console.error('[HorusEngine] Error critico en setup WizTree:', e.message); }
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
			if (code !== 0 && stderr) return reject(new Error(stderr));
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

function safeJsonObject(payload, fallback = null) {
	if (!payload) return fallback;
	try {
		const parsed = JSON.parse(payload);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
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

const scanProgressListeners = new Map();
async function ghostScanDisk(rootPath = 'C:\\', onProgress = null) {

	const base = String(rootPath || 'C:\\');
	const normBase = (base.endsWith('\\') ? base : base + '\\').toLowerCase();
	if (!scanProgressListeners.has(normBase)) scanProgressListeners.set(normBase, new Set());
	if (onProgress) scanProgressListeners.get(normBase).add(onProgress);
	let lastProgressPercent = 0;
	let lastProgressPhase = '';
	const emitProgress = (data) => {
		const listeners = scanProgressListeners.get(normBase);
		if (listeners) for (const cb of listeners) try { cb(data); } catch(e) {}
	};
	const emitOverallProgress = (phase, percent, extra = null) => {
		const normalized = Math.max(0, Math.min(100, Number(percent) || 0));
		const monotonic = Math.max(lastProgressPercent, normalized);
		if (monotonic === lastProgressPercent && phase === lastProgressPhase) return;
		lastProgressPercent = monotonic;
		lastProgressPhase = phase;
		emitProgress({ phase, percent: monotonic, ...(extra || {}) });
	};
	const detachProgressListener = () => {
		if (!onProgress) return;
		const listeners = scanProgressListeners.get(normBase);
		if (!listeners) return;
		listeners.delete(onProgress);
		if (listeners.size === 0) scanProgressListeners.delete(normBase);
	};

	emitOverallProgress('init', 2);

	try {
		if (diskScanCache.has(normBase)) {
			const cached = diskScanCache.get(normBase);
			if (Date.now() - cached.timestamp < 10 * 60 * 1000) {
				emitOverallProgress('cached', 100);
				return cached.data;
			}
		}

		if (inFlightScans.has(normBase)) {
			return await inFlightScans.get(normBase);
		}

		const scanPromise = (async () => {
		const mftPath = findExistingTool(toolCandidates.mft);
	if (mftPath) {
		try {
			emitOverallProgress('mft', 12);
			const { stdout } = await new Promise((resolve, reject) => {
				execFile(
					mftPath,
					['scan', '--root', base, '--format', 'json'],
					{ windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 * 64 },
					(err, out, errOut) => {
						if (err) {
							reject(new Error((errOut || err.message || '').trim() || 'mft scan failed'));
							return;
						}
						resolve({ stdout: out || '' });
					}
				);
			});

			const parsed = safeJsonObject(stdout, null);
			if (parsed && Array.isArray(parsed.items)) {
				emitOverallProgress('finalize', 99);
				return {
					engine: 'mft',
					items: parsed.items,
					extensions: Array.isArray(parsed.extensions) ? parsed.extensions : []
				};
			}
		} catch {
			// Continue with fallback.
		}
	}

	const wiztreePath = findExistingTool(toolCandidates.wiztree);
	if (wiztreePath) {
		try {
			emitOverallProgress('scan', 8);
			const driveMatch = base.match(/^([A-Za-z]):\\/);
			const driveLetter = driveMatch ? driveMatch[1].toUpperCase() : 'C';
			const tempCsv = path.join(appDataNexus, `wiztree-export-${driveLetter}.csv`);
			fs.mkdirSync(appDataNexus, { recursive: true });
			
			let needsScan = true;
			try {
				const stats = fs.statSync(tempCsv);
				// Si el CSV tiene menos de 2 horas (7200000 ms), lo reutilizamos
				if (Date.now() - stats.mtimeMs < 7200000) {
					needsScan = false;
				}
			} catch (e) {}

			if (needsScan) {
				await new Promise((resolve) => {
					// Exportamos SIEMPRE la raiz del disco para poder cachear y reusar el CSV
					execFile(
						wiztreePath,
						[`${driveLetter}:\\`, `/export=${tempCsv}`, '/admin=0'],
						{ windowsHide: true, timeout: 120000 },
						() => resolve()
					);
				});
				emitOverallProgress('scan', 22);
			} else {
				emitOverallProgress('scan', 18);
			}

			// Fallback: si tempCsv no se generó (ej. WizTree sin licencia CMD o versión antigua),
			// intentamos usar el archivo legacy 'wiztree-export.csv' que ya sepamos que funciona.
			let effectiveCsv = tempCsv;
			if (!fs.existsSync(effectiveCsv)) {
				const legacyCsv = path.join(appDataNexus, 'wiztree-export.csv');
				if (fs.existsSync(legacyCsv)) {
					effectiveCsv = legacyCsv;
				}
			}

			if (fs.existsSync(effectiveCsv)) {
				const itemsParse = [];
				const extMap = new Map();
				let totalFilesBytes = 0;
				// normBase is already evaluated above

				await new Promise((resolveParse, rejectParse) => {
					const readline = require('readline');
					const stat = fs.statSync(effectiveCsv);
					const totalSize = Math.max(1, stat.size);
					let bytesRead = 0;
					let lastPercent = -1;
					const fileStream = fs.createReadStream(effectiveCsv, { encoding: 'utf8', highWaterMark: 64 * 1024 });
					fileStream.on('data', chunk => {
						bytesRead += Buffer.byteLength(chunk, 'utf8');
						const ratio = Math.max(0, Math.min(1, bytesRead / totalSize));
						const percent = 22 + (ratio * 70); // 22..92 durante parseo real de CSV
						if (percent > lastPercent) {
							lastPercent = percent;
							emitOverallProgress('parsing', percent);
						}
					});
					const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
					
					let isFirstLine = true;
					let i = 0;

					rl.on('line', (line) => {
						if (isFirstLine) { isFirstLine = false; return; }
						
						const firstComma = line.indexOf('",');
						if (firstComma === -1) return;

						let fullPath = line.substring(1, firstComma).replace(/\\\\/g, '\\');
						const fullPathLower = fullPath.toLowerCase();

						const rest = line.substring(firstComma + 2);
						const cols = rest.split(',');
						const sizeBytes = Number(cols[0]) || 0;
						const attributes = Number(cols[cols.length - 3]) || 0;
						const isDir = (attributes & 16) !== 0;

						if (fullPath && sizeBytes > 0) {
							if (fullPathLower.startsWith(normBase) && fullPath.length > normBase.length) {
								const subPath = fullPath.substring(normBase.length);
								
								let cleanSub = subPath;
								if (cleanSub.endsWith('\\')) cleanSub = cleanSub.slice(0, -1);
								
								let depth = 1;
								for (let k = 0; k < cleanSub.length; k++) {
									if (cleanSub[k] === '\\') depth++;
								}
								
								// Solo guardamos hasta profundidad 5. Hijos de depth>1 deben tener > 500KB para no congelar IPC
								if (depth === 1 || (depth <= 5 && sizeBytes > 500 * 1024)) {
									itemsParse.push({ id: `wiz-${i}`, fullPath, fullPathLower, sizeBytes, isDir, depth });
								}
							}
							
							if (!isDir) {
								totalFilesBytes += sizeBytes;
								const idxDot = fullPath.lastIndexOf('.');
								const idxSlash = fullPath.lastIndexOf('\\');
								if (idxDot > idxSlash) {
									const ext = fullPath.substring(idxDot).toLowerCase();
									extMap.set(ext, (extMap.get(ext) || 0) + sizeBytes);
								} else {
									extMap.set('otros', (extMap.get('otros') || 0) + sizeBytes);
								}
							}
						}
						i++;
					});

					rl.on('close', resolveParse);
					rl.on('error', rejectParse);
				});

				// === CONSTRUIR ARBOL DE TREEMAP ===
				const directChildren = itemsParse.filter(i => i.depth === 1).sort((a,b) => b.sizeBytes - a.sizeBytes).slice(0, 100);
				
				// Normalizamos carpetas directas
				const dpSet = new Set(directChildren.map(i => i.fullPath.toLowerCase().replace(/\\$/, '') + '\\'));
				const dpArr = Array.from(dpSet); // OPTIMIZACION GRAVE: Guardar el array fuera del loop
				
				const validNested = itemsParse.filter(i => i.depth > 1 && dpArr.some(dp => i.fullPathLower.startsWith(dp)));
				const allNodes = [...directChildren, ...validNested];
				
				const nodeMap = new Map();
				allNodes.forEach(node => {
					node.children = [];
					nodeMap.set(node.fullPath.toLowerCase().replace(/\\$/, ''), node);
				});
				
				let topItems = [];
				allNodes.forEach(node => {
					if (node.depth === 1) {
						topItems.push(node);
					} else {
						let parentPath = node.fullPath.toLowerCase().replace(/\\$/, '');
						while (parentPath.includes('\\') && parentPath.length > normBase.length) {
							parentPath = parentPath.substring(0, parentPath.lastIndexOf('\\'));
							if (nodeMap.has(parentPath)) {
								nodeMap.get(parentPath).children.push(node);
								break;
							}
						}
					}
				});

				const processNode = (node, parentSize) => {
					let rawName = node.fullPath.replace(/\\$/, '');
					node.name = rawName.substring(rawName.lastIndexOf('\\') + 1);
					node.percent = Number(Math.max(0.1, (node.sizeBytes * 100) / (parentSize || 1)).toFixed(1));
					if (node.children && node.children.length > 0) {
						node.children.sort((a, b) => b.sizeBytes - a.sizeBytes);
						node.children.forEach(child => processNode(child, node.sizeBytes));
					}
				};

				const totalFoldersBytes = topItems.reduce((acc, cur) => acc + cur.sizeBytes, 0) || 1;
				try {
					topItems.forEach(child => processNode(child, totalFoldersBytes));
				} catch (err) {
					console.error('[HorusEngine] processNode error:', err.stack || err.message);
				}

				const topExts = Array.from(extMap.entries())
					.map(([ext, sizeBytes]) => ({ ext, sizeBytes, percent: Number(Math.max(0.1, (sizeBytes * 100) / (totalFilesBytes || 1)).toFixed(1)) }))
					.sort((a, b) => b.sizeBytes - a.sizeBytes)
					.slice(0, 50);

				emitOverallProgress('finalize', 98);
				return {
					engine: 'wiztree',
					items: topItems.map((item) => ({
						...item,
						name: path.basename(item.fullPath) || item.fullPath.replace(/\\$/, '').split('\\').pop(),
						percent: Number(Math.max(0.1, (item.sizeBytes * 100) / totalFoldersBytes).toFixed(1))
					})),
					extensions: topExts
				};
			}
		} catch {
			// Continue with fallback.
		}
	}

	const root = escapePsSingleQuoted(base);
	emitOverallProgress('scan', 16);
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
	emitOverallProgress('finalize', 98);
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
		})();
		inFlightScans.set(normBase, scanPromise);
		try {
			const result = await scanPromise;
			diskScanCache.set(normBase, { timestamp: Date.now(), data: result });
			emitOverallProgress('done', 100);
			return result;
		} finally {
			inFlightScans.delete(normBase);
		}
	} finally {
		detachProgressListener();
	}
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
            const ps = `Remove-Item -Path '${pathE}' -Recurse -Force -ErrorAction SilentlyContinue`;
            await runPowerShell(ps, 15000);
            deletedCount++;
        } catch (e) {
            console.error(`[HorusEngine] Error limpiando rastro ${item.Path}:`, e.message);
        }
    }
    return { deleted: deletedCount };
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

	// CREATE_NEW_CONSOLE (0x10) para que el script tenga su propia ventana de consola visible e interactiva.
	// stdio: 'ignore' porque la consola real del proceso es la que muestra la salida, no los pipes de Electron.
	const spawnOptions = { 
		windowsHide: false,
		detached: true,
		shell: false,
		creationFlags: 0x00000010,
		env: envBlock,
		stdio: ['ignore', 'ignore', 'ignore']
	};

	if (info.isCmdScript) {
		child = spawn(info.cmd, ['/c', filePath, ...args], spawnOptions);
	} else if (info.cmd === fileName) {
		child = spawn(filePath, args, spawnOptions);
	} else {
		child = spawn(info.cmd, [filePath, ...args], spawnOptions);
	}

	activeProcesses.set(fileName, child);

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

	// Desacoplar del padre para que la ventana sobreviva si Electron se cierra
	child.unref();

	emitOutput({ fileName, type: 'success', message: '[SYS] Ventana externa abierta. La salida se muestra en la consola del script.' });

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
	getRuntimePaths: async () => ({
		storageDir,
		appDataNexus,
		portableBaseDir,
		env: {
			USERPROFILE: process.env.USERPROFILE || '',
			APPDATA: process.env.APPDATA || '',
			LOCALAPPDATA: process.env.LOCALAPPDATA || '',
			PROGRAMFILES: process.env.ProgramFiles || 'C:\\Program Files',
			PROGRAMFILES_X86: process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
			SYSTEMROOT: process.env.SystemRoot || 'C:\\Windows',
			WINDIR: process.env.WinDir || process.env.SystemRoot || 'C:\\Windows'
		}
	}),
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
		
		// Encontrar discos disponibles (PowerShell en lugar de wmic deprecado)
		execFile('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_LogicalDisk).DeviceID -join ","'], { windowsHide: true }, (err, stdout) => {
			let drives = ['C:'];
			if (!err && stdout) {
				const matches = stdout.trim().match(/[A-Z]:/g);
				if (matches) drives = matches;
			}
			
			let activeWorkers = 0;
			
			async function walk(dir) {
				if (completed || limitReached) {
					activeWorkers--;
					if (activeWorkers === 0) finish();
					return;
				}
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
							activeWorkers++; // Contar ANTES del dispatch para evitar race condition
							walk(resPath);
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
				activeWorkers++; // Contar ANTES del dispatch
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
		mftAvailable: !!findExistingTool(toolCandidates.mft),
		wiztreeAvailable: !!findExistingTool(toolCandidates.wiztree),
		geekAvailable: !!findExistingTool(toolCandidates.geek)
	}),
	buscarArchivo: async (query, limit = 120) => {
		const items = await ghostSearchFiles(query, limit);
		return items;
	},
	escanearDisco: async (rootPath = 'C:\\', onProgress) => {
		return await ghostScanDisk(rootPath, onProgress);
	},
	listarAppsInstaladas: async () => {
		return await ghostListInstalledApps();
	},
	desinstalarApp: async (payload, force = false) => {
		return await ghostUninstallApp(payload, force);
        },
        buscarRastrosApp: async (payload) => {
                return await ghostFindLeftovers(payload);
        },
        limpiarRastrosApp: async (items) => {
                return await ghostCleanLeftovers(items);
	},
	getFileIcon: (filePath) => ipcRenderer.invoke('get-file-icon', filePath)
};

try {
	contextBridge.exposeInMainWorld('api', api);
} catch (err) {
	console.error('[HorusEngine] No se pudo exponer api mediante contextBridge:', err);
}

// Pre-warm disk map scan silencioso para el disco C: (para que sea instantáneo la primera vez)
setTimeout(() => {
	ghostScanDisk('C:\\').catch(() => {});
}, 8000);
