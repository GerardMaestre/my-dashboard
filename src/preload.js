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

const appDataNexus = path.join(process.env.APPDATA || process.env.USERPROFILE, 'HorusEngine');
const pythonEnvPath = isPackaged 
	? path.join(appDataNexus, 'env_python') 
	: path.join(storageDir, 'env_python');
const pythonExePath = path.join(pythonEnvPath, 'python.exe');

// Autoinstalador silencioso de Python Portable
function ensureStandaloneEnvironment() {
    const pipPath = path.join(pythonEnvPath, 'Scripts', 'pip.exe');
    
    // Si ya existe python Y pip, estamos listos.
    if (fs.existsSync(pythonExePath) && fs.existsSync(pipPath)) return;
    
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
    } catch(e) { }
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

function quoteCmdArg(arg) {
	const escaped = String(arg).replace(/"/g, '\\"');
	return `"${escaped}"`;
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
	const filePath = path.join(storageDir, fileName);
	const info = getScriptInfo(fileName);
	let child = null;

	if (info.isCmdScript) {
		child = spawn(info.cmd, ['/c', filePath, ...args], { windowsHide: true });
	} else if (info.cmd === fileName) {
		child = spawn(filePath, args, { windowsHide: true });
	} else {
		child = spawn(info.cmd, [filePath, ...args], { windowsHide: true });
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
	const filePath = path.join(storageDir, fileName);
	const info = getScriptInfo(fileName);
	let command = '';

	if (info.isCmdScript) {
		command = [quoteCmdArg(filePath), ...args.map(quoteCmdArg)].join(' ');
	} else if (info.cmd === fileName) {
		command = [quoteCmdArg(filePath), ...args.map(quoteCmdArg)].join(' ');
	} else {
		command = [info.cmd, quoteCmdArg(filePath), ...args.map(quoteCmdArg)].join(' ');
	}

	spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', command], { windowsHide: false, windowsVerbatimArguments: true, detached: true });
	return null;
}

function killProcessTree(fileName) {
	const child = activeProcesses.get(fileName);
	if (!child) return false;

	if (process.platform === 'win32') {
		execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
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
		const filePath = path.join(storageDir, fileName);
		try {
			const content = await fs.promises.readFile(filePath, 'utf8');
			return content.substring(0, 1000).split(/\r?\n/);
		} catch(e) { return []; }
	},
	openPath: (fileName) => shell.openPath(path.join(storageDir, fileName)),
	editScript: (fileName) => {
		if (fileName.includes('Inyector_Macros')) {
			const configPath = path.join(appDataNexus, 'macros_config.json');
			if (fs.existsSync(configPath)) {
				spawn('notepad.exe', [configPath]);
				return;
			}
		}
		// Forzar bloc de notas para Editar en lugar de Ejecutar (peligro default association)
		const filePath = path.join(storageDir, fileName);
		spawn('notepad.exe', [filePath]);
	},
	openGlobalPath: (fullPath) => shell.openPath(fullPath),
	showGlobalItemInFolder: (fullPath) => shell.showItemInFolder(fullPath),
	scanGlobalFiles: (callback, progressCallback) => {
		// Modo Asíncrono no bloqueante absoluto
		const results = [];
		const excludePatterns = ['\\Windows', '\\ProgramData', '\\node_modules', '\\.git', '\\AppData\\Local\\Microsoft'];
		
		// Encontrar discos disponibles
		execFile('wmic', ['logicaldisk', 'get', 'name'], (err, stdout) => {
			let drives = ['C:'];
			if (!err) {
				const matches = stdout.match(/[A-Z]:/g);
				if (matches) drives = matches;
			}
			
			let activeWorkers = 0;
			
			async function walk(dir) {
				activeWorkers++;
				try {
					// Yield event loop completely to prevent UI freeze
					await new Promise(r => setTimeout(r, 0));
					
					const entries = await fs.promises.readdir(dir, { withFileTypes: true });
					for (const entry of entries) {
						if (entry.name.startsWith('$')) continue;
						
						const resPath = path.join(dir, entry.name);
						
						if (entry.isDirectory()) {
							// Ignorar carpetas del nucleo para no morir escaneando sistema
							if (excludePatterns.some(p => resPath.includes(p))) continue;
							results.push(`DIR|${resPath}`);
							walk(resPath); // disparamos el worker asíncrono sin await
						} else {
							results.push(`FILE|${resPath}`);
						}
					}
				} catch (e) {
					// Ignorar accesos denegados
				} finally {
					activeWorkers--;
					if (activeWorkers % 50 === 0 && progressCallback) {
						progressCallback(results.length);
					}
					if (activeWorkers === 0) {
						callback(results);
					}
				}
			}
			
			// Iniciar crawler para cada disco
			for (const drive of drives) {
				const startDir = drive === 'C:' ? path.join('C:', 'Users', process.env.USERNAME || process.env.USER) : `${drive}\\`;
				walk(startDir);
			}
		});
	},
	runScript: ({ fileName, args = '', mode = 'internal' }) => {
		const parsedArgs = splitArgs(args);
		if (mode === 'external') {
			runExternal(fileName, parsedArgs);
			return { pid: null };
		}
		const pid = runInternal(fileName, parsedArgs);
		return { pid };
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
};

try {
	contextBridge.exposeInMainWorld('api', api);
} catch (err) {
	globalThis.api = api;
}
