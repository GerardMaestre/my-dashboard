const { contextBridge, ipcRenderer } = require('electron');
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

// -------------------------------------------------------------
// SEGURIDAD: 
// 1. No se expone `shell` directamente. Se envían a `ipcMain`.
// 2. Uso estricto de contextBridge por canales y grupos.
// -------------------------------------------------------------

const api = {
	// ---- MODULO: SYSTEM ----
	system: {
		getStorageDir: async () => storageDir,
		getRuntimePaths: async () => await ipcRenderer.invoke('get-runtime-paths'),
		listScripts: async () => await ipcRenderer.invoke('list-scripts'),
		readScriptMeta: async (fileName) => await ipcRenderer.invoke('read-script-meta', fileName),
		runScript: async (payload) => await ipcRenderer.invoke('run-script', payload),
		isRunning: async (fileName) => await ipcRenderer.invoke('is-running', fileName),
		stopScript: async (fileName) => await ipcRenderer.invoke('stop-script', fileName),
		editScript: async (fileName) => await ipcRenderer.invoke('edit-script', fileName),
		ensureEnvironment: async () => await ipcRenderer.invoke('ensure-environment'),
		showNativeNotification: async (payload) => await ipcRenderer.invoke('show-native-notification', payload)
	},

	// ---- MODULO: TELEMETRY & NETWORK ----
	telemetry: {
		onUpdate: (callback) => {
			const listener = (_event, data) => callback(data);
			ipcRenderer.on('telemetry-update', listener);
			return () => ipcRenderer.removeListener('telemetry-update', listener);
		},
		onNetworkUpdate: (callback) => {
			const listener = (_event, data) => callback(data);
			ipcRenderer.on('network-update', listener);
			return () => ipcRenderer.removeListener('network-update', listener);
		}
	},

	// ---- MODULO: PROCESS EVENTS ----
	process: {
		onOutput: (callback) => {
			const listener = (_event, data) => callback(data);
			ipcRenderer.on('process-output', listener);
			return () => ipcRenderer.removeListener('process-output', listener);
		},
		onExit: (callback) => {
			const listener = (_event, data) => callback(data);
			ipcRenderer.on('process-exit', listener);
			return () => ipcRenderer.removeListener('process-exit', listener);
		}
	},

	// ---- MODULO: UI & SPOTLIGHT ----
	ui: {
		windowControl: (action) => ipcRenderer.send('window-control', action),
		onSpotlight: (callback) => {
			const listener = () => callback();
			ipcRenderer.on('toggle-spotlight', listener);
			return () => ipcRenderer.removeListener('toggle-spotlight', listener);
		},
		onSetupProgress: (callback) => {
			const listener = (_event, data) => callback(data);
			ipcRenderer.on('setup-progress', listener);
			return () => ipcRenderer.removeListener('setup-progress', listener);
		},
        showContextMenu: (items) => ipcRenderer.send('show-context-menu', items)
	},

	// ---- MODULO: GHOST ENGINE ----
	ghost: {
		getStatus: async () => await ipcRenderer.invoke('get-ghost-engine-status'),
		buscarArchivo: async (query, limit) => await ipcRenderer.invoke('ghost-search-files', query, limit),
		clearDiskScanCache: async (rootPath) => await ipcRenderer.invoke('clear-disk-scan-cache', rootPath),
		
		escanearDisco: async (rootPath, onProgress, options) => {
			const listener = (_event, data) => onProgress(data);
			ipcRenderer.on('disk-progress', listener);
			try {
				return await ipcRenderer.invoke('ghost-scan-disk', rootPath, options);
			} finally {
				ipcRenderer.removeListener('disk-progress', listener);
			}
		},
		leerPaginaDisco: async (snapshotPath, offset = 0, limit = 1200) => 
			await ipcRenderer.invoke('ghost-read-disk-snapshot-page', snapshotPath, offset, limit),
			
		listarAppsInstaladas: async () => await ipcRenderer.invoke('ghost-list-apps'),
		desinstalarApp: async (payload, force) => await ipcRenderer.invoke('ghost-uninstall-app', payload, force),
		buscarRastrosApp: async (payload) => await ipcRenderer.invoke('ghost-find-leftovers', payload),
		limpiarRastrosApp: async (items) => await ipcRenderer.invoke('ghost-clean-leftovers', items),
		getFileIcon: async (filePath) => await ipcRenderer.invoke('get-file-icon', filePath),
		getFileIcons: async (filePaths) => await ipcRenderer.invoke('get-file-icons-batch', filePaths)
	},

	// ---- MODULO: SHELL (Sustituye llamadas directas a shell por IPC) ----
	shell: {
		openPath: async (fileName) => await ipcRenderer.invoke('shell-open-path', path.join(storageDir, toOsRelativePath(fileName))),
		openGlobalPath: async (fullPath) => await ipcRenderer.invoke('shell-open-path', fullPath),
		showGlobalItemInFolder: async (fullPath) => await ipcRenderer.invoke('shell-show-item-in-folder', fullPath),
        openExternalUrl: async (url) => await ipcRenderer.invoke('shell-open-external', url),
        openRegeditKey: async (key) => await ipcRenderer.invoke('shell-open-regedit', key)
	},

	// ---- MODULO: UTILIDADES (Legacy mappings mantenidos por compatibilidad parcial pero centralizados) ----
	util: {
		scanGlobalFiles: (callback, progressCallback) => {
			const safeCallback = typeof callback === 'function' ? callback : () => {};
			const safeProgress = typeof progressCallback === 'function' ? progressCallback : () => {};

			const onChunk = (_event, chunk) => safeCallback(chunk);
			const onProgress = (_event, count) => safeProgress(count);

			ipcRenderer.on('scan-chunk', onChunk);
			ipcRenderer.on('scan-progress', onProgress);

			return ipcRenderer
				.invoke('scan-global-files-chunked')
				.finally(() => {
					ipcRenderer.removeListener('scan-chunk', onChunk);
					ipcRenderer.removeListener('scan-progress', onProgress);
				});
		}
	}
};

contextBridge.exposeInMainWorld('api', Object.freeze(api));
