import { windowControl, openSettings, closeSettings, initTheme, changeTheme } from './ui/windowSystem.js';
import { toggleTerminal, logTerminal, copiarTerminal, clearTerminal } from './ui/terminalSystem.js';
import { mostrarToast } from './ui/toastSystem.js';
import { cargarScripts, ejecutar, matarProceso, openScript, toggleFavorite, toggleAutoStart, aplicarFiltros, setupTabs, ejecutar1ClickMode } from './features/dashboardSystem.js';
import { toggleAutopilot, cerrarAutopilot, iniciarAutopilot, initAutopilotLoop } from './features/autopilotSystem.js';
import { abrirOjoDeDios, cerrarOjoDeDios, bindGhostEvents, cargarMotoresFantasma } from './features/ojoDeDios.js';
import { initRuntimePaths } from './core/utils.js';
import { initRadarSystem } from './ui/RadarSystem.js';

// New Modules
import { createSparkline, drawSparkline, pushSparklineValue } from './renderer/telemetry.js';
import { initSpotlight } from './renderer/spotlight.js';
import { initIpcListeners } from './renderer/ipcListeners.js';

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

// --- INITIALIZATION ---

const telemetryCharts = {
    cpu: createSparkline('chart-cpu', '#0A84FF', 'rgba(10, 132, 255, 0.1)'),
    mem: createSparkline('chart-mem', '#FF9F0A', 'rgba(255, 159, 10, 0.1)')
};

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
        initTheme();
        startupTrace('theme initialized');
        setupTabs();
        startupTrace('tabs initialized');
        initAutopilotLoop();
        startupTrace('autopilot initialized');
        initIpcListeners(telemetryCharts);
        startupTrace('ipc listeners initialized');
        initSpotlight(ejecutar);
        startupTrace('spotlight initialized');

        initRadarSystem({
            containerId: 'network-radar', statusId: 'network-radar-status', modalId: 'network-node-modal',
            onNotify: (m, t) => mostrarToast(m, t), onLog: (m, t) => logTerminal(m, t)
        });
        startupTrace('radar initialized');

        if (window.api) {
            startupTrace('window.api available');
            await initRuntimePaths();
            startupTrace('runtime paths loaded');
            await cargarScripts();
            startupTrace('scripts loaded');
            cargarMotoresFantasma();
            startupTrace('ghost engines loaded');
            bindGhostEvents();
            startupTrace('ghost events bound');
            if (window.api.ensureEnvironment) {
                setTimeout(() => {
                    window.api.ensureEnvironment().catch(e => console.error('Environment check failed', e));
                }, 250);
                startupTrace('ensureEnvironment scheduled');
            }
        } else {
            console.warn('[HorusEngine] API bridge unavailable. Running in limited mode.');
            startupTrace('window.api missing - limited mode');
        }
    } catch (error) {
        console.error('[HorusEngine] Critical Initialization Error:', error);
    } finally {
        hideSplash();
        startupTrace('splash hide requested');
    }
}

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

// Sparkline Resize
window.addEventListener('resize', () => {
    if (telemetryCharts.cpu) drawSparkline(telemetryCharts.cpu);
    if (telemetryCharts.mem) drawSparkline(telemetryCharts.mem);
});

// Global Keybinds
document.addEventListener('keydown', (e) => {
	if (e.ctrlKey && e.key === 'l') { e.preventDefault(); clearTerminal(); }
	if (e.key === 'F3' || (e.ctrlKey && e.key === 'f')) { e.preventDefault(); document.getElementById('search-input')?.focus(); }
    if (e.key === 'Escape') { cerrarOjoDeDios(); closeSettings(); if(document.getElementById('spotlight-overlay')?.style.display === 'flex') window.toggleSpotlight(); }
});
