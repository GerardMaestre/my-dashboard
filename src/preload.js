const { contextBridge, ipcRenderer, shell } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const isPackaged = __dirname.includes('app.asar');
const storageDir = isPackaged
	? path.join(process.resourcesPath, 'mis_scripts')
	: path.join(__dirname, '..', '..', 'mis_scripts');

const activeProcesses = new Map();
const outputListeners = new Set();
const exitListeners = new Set();

const pythonEnvPath = path.join(storageDir, 'env_python');
const pythonExePath = path.join(pythonEnvPath, 'python.exe');

// Autoinstalador silencioso de Python Portable
function ensureStandaloneEnvironment() {
    if (fs.existsSync(pythonExePath)) return; // Ya está instalado, no hace nada
    
    try {
        if (!fs.existsSync(pythonEnvPath)) fs.mkdirSync(pythonEnvPath, { recursive: true });
        const zipPath = path.join(pythonEnvPath, 'python.zip');
        
        // Pide a powershell descargar Python en modo sigiloso total
        const psCommand = `
        $ProgressPreference = 'SilentlyContinue';
        Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.11.8/python-3.11.8-embed-amd64.zip" -OutFile "${zipPath}";
        Expand-Archive -Path "${zipPath}" -DestinationPath "${pythonEnvPath}" -Force;
        Remove-Item "${zipPath}";
        `;

        execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCommand], { windowsHide: true }, (err) => {
            if (!err) {
                // Habilitamos site-packages por si acaso en el portátil
                const pthPath = path.join(pythonEnvPath, 'python311._pth');
                if (fs.existsSync(pthPath)) {
                    let pth = fs.readFileSync(pthPath, 'utf8');
                    fs.writeFileSync(pthPath, pth.replace('#import site', 'import site'));
                }
                setTimeout(() => emitOutput({ fileName: 'Sistema', type: 'system', message: 'Entorno Python instalado correctamente' }), 2000);
            } else {
                setTimeout(() => emitOutput({ fileName: 'Sistema', type: 'error', message: 'Fallo al instalar entorno Python' }), 2000);
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
	if (!child || child.killed) return false;

	if (process.platform === 'win32') {
		execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
	} else {
		child.kill('SIGKILL');
	}

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
			return await fs.promises.readdir(storageDir);
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
