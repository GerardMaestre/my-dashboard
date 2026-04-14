const { contextBridge, ipcRenderer, shell } = require('electron');
const path = require('path');

const isPackaged = __dirname.includes('app.asar');
const resourcesBase = isPackaged 
	? process.resourcesPath 
	: path.join(__dirname, '..');

const storageDir = path.join(resourcesBase, 'mis_scripts');

const outputListeners = new Set();
const exitListeners = new Set();

function normalizeRelativePath(fileName) {
	return String(fileName || '').replace(/\\/g, '/');
}

function toOsRelativePath(fileName) {
	return normalizeRelativePath(fileName).replace(/\//g, path.sep);
}

const api = {
	getStorageDir: async () => storageDir,
	getRuntimePaths: async () => ipcRenderer.invoke('get-runtime-paths'),
	listScripts: async () => ipcRenderer.invoke('list-scripts'),
	readScriptMeta: async (fileName) => ipcRenderer.invoke('read-script-meta', fileName),
	openPath: (fileName) => shell.openPath(path.join(storageDir, toOsRelativePath(fileName))),
	editScript: (fileName) => ipcRenderer.invoke('edit-script', fileName),
	openGlobalPath: (fullPath) => shell.openPath(fullPath),
	showGlobalItemInFolder: (fullPath) => shell.showItemInFolder(fullPath),
	
    // Mapeo de disco ahora por chunks
	scanGlobalFiles: (callback, progressCallback) => {
        ipcRenderer.on('scan-chunk', (_event, chunk) => callback(chunk));
        ipcRenderer.on('scan-progress', (_event, count) => progressCallback(count));
        ipcRenderer.invoke('scan-global-files-chunked');
	},

	runScript: (payload) => ipcRenderer.invoke('run-script', payload),
	isRunning: (fileName) => ipcRenderer.invoke('is-running', fileName),
	stopScript: (fileName) => ipcRenderer.invoke('stop-script', fileName),
	
    onProcessOutput: (callback) => {
		const listener = (_event, data) => callback(data);
		ipcRenderer.on('process-output', listener);
		return () => ipcRenderer.removeListener('process-output', listener);
	},
	onProcessExit: (callback) => {
		const listener = (_event, data) => callback(data);
		ipcRenderer.on('process-exit', listener);
		return () => ipcRenderer.removeListener('process-exit', listener);
	},
	onTelemetry: (callback) => {
		const listener = (_event, data) => callback(data);
		ipcRenderer.on('telemetry-update', listener);
		return () => ipcRenderer.removeListener('telemetry-update', listener);
	},
	onSpotlight: (callback) => {
		const listener = () => callback();
		ipcRenderer.on('toggle-spotlight', listener);
		return () => ipcRenderer.removeListener('toggle-spotlight', listener);
	},
	onNetworkUpdate: (callback) => {
		const listener = (_event, data) => callback(data);
		ipcRenderer.on('network-update', listener);
		return () => ipcRenderer.removeListener('network-update', listener);
	},
    onSetupProgress: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('setup-progress', listener);
        return () => ipcRenderer.removeListener('setup-progress', listener);
    },
    
	windowControl: (action) => ipcRenderer.send('window-control', action),
	getGhostEngineStatus: async () => ipcRenderer.invoke('get-ghost-engine-status'),
	buscarArchivo: async (query, limit) => ipcRenderer.invoke('ghost-search-files', query, limit),
	clearDiskScanCache: async (rootPath) => ipcRenderer.invoke('clear-disk-scan-cache', rootPath),
	escanearDisco: async (rootPath, onProgress, options) => {
        const listener = (_event, data) => onProgress(data);
        ipcRenderer.on('disk-progress', listener);
        const result = await ipcRenderer.invoke('ghost-scan-disk', rootPath, options);
        ipcRenderer.removeListener('disk-progress', listener);
        return result;
    },
	listarAppsInstaladas: async () => ipcRenderer.invoke('ghost-list-apps'),
	desinstalarApp: async (payload, force) => ipcRenderer.invoke('ghost-uninstall-app', payload, force),
	buscarRastrosApp: async (payload) => ipcRenderer.invoke('ghost-find-leftovers', payload),
	limpiarRastrosApp: async (items) => ipcRenderer.invoke('ghost-clean-leftovers', items),
	getFileIcon: (filePath) => ipcRenderer.invoke('get-file-icon', filePath),
	getFileIcons: (filePaths) => ipcRenderer.invoke('get-file-icons-batch', filePaths),
    ensureEnvironment: () => ipcRenderer.invoke('ensure-environment')
};

contextBridge.exposeInMainWorld('api', api);
