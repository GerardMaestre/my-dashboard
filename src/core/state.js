export const ghostState = {
	engines: {
		everythingAvailable: false,
		wiztreeAvailable: false,
		geekAvailable: false
	},
	searchTimer: null,
	lastQuery: '',
	activeScreen: 'search',
	appsLoaded: false,
	diskScanned: false,
	listenersBound: false,
	searchAppsCache: null,
	searchSeq: 0,
	diskPathStack: ['C:\\'],
	diskScanSeq: 0,
	appsList: []
};

export const autopilotTasks = {};
export const runningFiles = new Set();
export const silentRuns = new Set();
export let isFirstLoad = true;

export function setIsFirstLoad(value) {
    isFirstLoad = value;
}

function safeParseLocalStorage(key, fallback = []) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch (e) {
        console.error(`[HorusEngine] Corrupted localStorage key "${key}", resetting.`);
        localStorage.removeItem(key);
        return fallback;
    }
}

export let autostartList = safeParseLocalStorage('nexus_autostart');
export let favoritesList = safeParseLocalStorage('nexus_favorites');

export function updateFavorites(newList) {
    favoritesList = newList;
    localStorage.setItem('nexus_favorites', JSON.stringify(favoritesList));
}

export function updateAutostart(newList) {
    autostartList = newList;
    localStorage.setItem('nexus_autostart', JSON.stringify(autostartList));
}

export const proModePolicy = {
	'07_Herramientas_Pro/Analizador_Espacio.py': 'internal',
	'07_Herramientas_Pro/Desinstalador_Root.bat': 'external'
};

export let ojoDatabase = [];
export let ojoIndexing = false;
export let ojoIndexed = false;

export function setOjoState(update) {
    if (update.ojoDatabase !== undefined) ojoDatabase = update.ojoDatabase;
    if (update.ojoIndexing !== undefined) ojoIndexing = update.ojoIndexing;
    if (update.ojoIndexed !== undefined) ojoIndexed = update.ojoIndexed;
}
