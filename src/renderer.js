import { windowControl, openSettings, closeSettings, initTheme, changeTheme } from './ui/windowSystem.js';
import { toggleTerminal, logTerminal, copiarTerminal, clearTerminal } from './ui/terminalSystem.js';
import { mostrarToast } from './ui/toastSystem.js';
import { cargarScripts, ejecutar, matarProceso, openScript, toggleFavorite, toggleAutoStart, aplicarFiltros, setupTabs, ejecutar1ClickMode } from './features/dashboardSystem.js';
import { toggleAutopilot, cerrarAutopilot, iniciarAutopilot, initAutopilotLoop } from './features/autopilotSystem.js';
import { abrirOjoDeDios, cerrarOjoDeDios, bindGhostEvents, cargarMotoresFantasma } from './features/ojoDeDios.js';
import { initRuntimePaths } from './core/utils.js';
import { initSettingsControls, changeGlobalTerminalMode } from './core/settingsManager.js';

// New Modules
import { initSpotlight } from './renderer/spotlight.js';
import { initIpcListeners } from './renderer/ipcListeners.js';
import { initHybridBridge, isDesktop } from './renderer/hybridBridge.js';

window.__horusRendererModuleLoaded = true;
console.error('[StartupProbe] renderer.js module evaluated');

// Expose globals
window.windowControl = windowControl;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.changeTheme = changeTheme;
window.ejecutar1ClickMode = ejecutar1ClickMode;
window.toggleTerminal = toggleTerminal;
window.copiarTerminal = copiarTerminal;
window.mostrarToast = mostrarToast;
window.toggleFavorite = toggleFavorite;
window.toggleAutoStart = toggleAutoStart;
window.openScript = openScript;
window.ejecutar = ejecutar;
window.matarProceso = matarProceso;
window.toggleAutopilot = toggleAutopilot;
window.cerrarAutopilot = cerrarAutopilot;
window.iniciarAutopilot = iniciarAutopilot;
window.abrirOjoDeDios = abrirOjoDeDios;
window.cerrarOjoDeDios = cerrarOjoDeDios;
window.changeGlobalTerminalMode = () => {
    changeGlobalTerminalMode();
    cargarScripts().catch((error) => console.error('[HorusEngine] Error refreshing scripts after mode change:', error));
};

// Globals and bindings
function startupTrace(message) {
    console.info(`[Startup] ${message}`);
}

function hideSplash(immediate = false) {
    const splash = document.getElementById('splash-screen');
    if (!splash) return;

    splash.classList.add('hidden');
    if (immediate) splash.style.display = 'none';

    setTimeout(() => {
        if (splash.parentNode) splash.remove();
    }, immediate ? 60 : 1000);
}

// Fail-safe para el splash screen: Forzar ocultamiento si la inicialización se atasca.
setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    if (splash && !splash.classList.contains('hidden')) {
        console.warn('[HorusEngine] Splash failsafe activado. Forzando inicio...');
        hideSplash(true);
    }
}, 12000);

async function initApp() {
    startupTrace('initApp start');
    try {
        const bridgeInfo = await initHybridBridge();
        startupTrace(`bridge initialized (${bridgeInfo.isDesktop ? 'desktop' : 'mobile'}:${bridgeInfo.connected ? 'connected' : 'offline'})`);

        initTheme();
        startupTrace('theme initialized');
        initSettingsControls();
        startupTrace('settings initialized');
        setupTabs();
        startupTrace('tabs initialized');
        initAutopilotLoop();
        startupTrace('autopilot initialized');
        initIpcListeners();
        startupTrace('ipc listeners initialized');
        initSpotlight(ejecutar);
        startupTrace('spotlight initialized');

        await cargarScripts();
        startupTrace('scripts loaded');

        if (isDesktop && window.api) {
            startupTrace('desktop IPC available');
            await initRuntimePaths();
            startupTrace('runtime paths loaded');
            cargarMotoresFantasma();
            startupTrace('ghost engines loaded');
            bindGhostEvents();
            startupTrace('ghost events bound');
            if (window.api.system.ensureEnvironment) {
                setTimeout(() => {
                    window.api.system.ensureEnvironment().catch(e => console.error('Environment check failed', e));
                }, 250);
                startupTrace('ensureEnvironment scheduled');
            }
        } else {
            console.warn('[HorusEngine] Running in mobile remote mode. Some desktop-only modules are disabled.');
            startupTrace('mobile remote mode enabled');
        }
    } catch (error) {
        console.error('[HorusEngine] Critical Initialization Error:', error);
    } finally {
        hideSplash();
        startupTrace('splash hide requested');
    }
}

// 🛡️ Error Handling Global
window.onerror = function(message, source, lineno, colno, error) {
    console.error(`[Global Error] ${message} at ${source}:${lineno}`);
    if (typeof window.mostrarToast === 'function') {
        window.mostrarToast(`Error: ${message}`, 'error');
    }
    return false;
};

window.onunhandledrejection = function(event) {
    console.error('[Unhandled Promise Rejection]', event.reason);
};

// 🖥️ Inicialización segura
document.addEventListener('DOMContentLoaded', () => {
    initApp();

    // Search input
    let searchTimeout;
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(aplicarFiltros, 300);
        });
    }

    // Global Keybinds
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'l') { e.preventDefault(); clearTerminal(); }
        if (e.key === 'F3' || (e.ctrlKey && e.key === 'f')) { e.preventDefault(); document.getElementById('search-input')?.focus(); }
        if (e.key === 'Escape') { cerrarOjoDeDios(); closeSettings(); if(document.getElementById('spotlight-overlay')?.style.display === 'flex') window.toggleSpotlight(); }
    });
});
