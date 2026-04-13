import { windowControl, openSettings, closeSettings, initTheme, changeTheme } from './ui/windowSystem.js';
import { toggleTerminal, logTerminal, copiarTerminal, clearTerminal } from './ui/terminalSystem.js';
import { mostrarToast } from './ui/toastSystem.js';
import { cargarScripts, ejecutar, matarProceso, openScript, toggleFavorite, toggleAutoStart, aplicarFiltros, alternarBotones, setupTabs } from './features/dashboardSystem.js';
import { toggleAutopilot, cerrarAutopilot, iniciarAutopilot, initAutopilotLoop } from './features/autopilotSystem.js';
import { abrirOjoDeDios, cerrarOjoDeDios, bindGhostEvents, cargarMotoresFantasma } from './features/ojoDeDios.js';
import { initRuntimePaths } from './core/utils.js';
import { runningFiles, silentRuns } from './core/state.js';

// Exponer métodos críticos a WINDOW para que index.html "onclick" sigan funcionando
window.windowControl = windowControl;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.changeTheme = changeTheme;
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

// Inicializadores
initTheme();
setupTabs();
initAutopilotLoop();

if (window.api) {
    window.api.getStorageDir();
    initRuntimePaths().catch(e => console.error('[HorusEngine] initRuntimePaths failed:', e));
    cargarScripts().catch(e => console.error('[HorusEngine] cargarScripts failed:', e));
    try { cargarMotoresFantasma(); } catch(e) { console.error('[HorusEngine] cargarMotoresFantasma failed:', e); }
    try { bindGhostEvents(); } catch(e) { console.error('[HorusEngine] bindGhostEvents failed:', e); }
    
    // IPC Listeners para salida de procesos
    window.api.onProcessOutput(({ fileName, type, message }) => {
        if (fileName === 'Sistema') {
            logTerminal(message, type);
            return;
        }
        if (!runningFiles.has(fileName)) return;
        logTerminal(message, type);
    });

    window.api.onProcessExit(({ fileName, code }) => {
        runningFiles.delete(fileName);
        alternarBotones(fileName, false);
        aplicarFiltros(); 

        if (!silentRuns.has(fileName)) {
            const isSuccess = code === 0;
            logTerminal(`[Fin] Código ${code}`, isSuccess ? 'system' : 'error');
            mostrarToast(`Script finalizado: ${fileName}`, isSuccess ? 'success' : 'error');
        }

        silentRuns.delete(fileName);
    });
}

// Global UI error catching
window.addEventListener('error', (event) => {
	setTimeout(() => {
		logTerminal(`[UI Crash] ${event.message} at ${event.filename}:${event.lineno}`, 'error');
	}, 100);
});

window.addEventListener('unhandledrejection', (event) => {
	setTimeout(() => {
		logTerminal(`[UI Promise] ${event.reason?.message || event.reason}`, 'error');
	}, 100);
});

// Search input debounce delay binding
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
	if (e.ctrlKey && e.key === 'l') {
		e.preventDefault();
		clearTerminal();
	}
	if (e.key === 'F3' || (e.ctrlKey && e.key === 'f')) {
		e.preventDefault();
        const searchField = document.getElementById('search-input');
		if(searchField) searchField.focus();
	}
    if (e.key === 'Escape') {
		cerrarOjoDeDios();
		closeSettings();
	}

    // Navegación con Teclado
	if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
		const visibleItems = Array.from(document.querySelectorAll('.script-item:not(.hidden)'));
		if (visibleItems.length === 0) return;

        let curIdx = visibleItems.findIndex(i => window.getComputedStyle(i).boxShadow.includes('inset'));
        if (curIdx === -1) curIdx = 0;

		if (e.key === 'ArrowDown') {
			curIdx = (curIdx + 1) % visibleItems.length;
		} else {
			curIdx = (curIdx - 1 + visibleItems.length) % visibleItems.length;
		}

		visibleItems.forEach((item, idx) => {
			if (idx === curIdx) {
				item.style.boxShadow = 'inset 0 0 0 2px var(--mac-blue)';
				item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			} else {
				item.style.boxShadow = '';
			}
		});
		e.preventDefault();
	}

	if (e.key === 'Enter') {
		const itemSelected = document.querySelector('.script-item[style*="inset"]');
        if (itemSelected && !itemSelected.classList.contains('hidden')) {
            const fileName = itemSelected.getAttribute('data-name');
			ejecutar(fileName);
			e.preventDefault();
        }
	}
});

const btnRefresh = document.getElementById('btn-refresh');
if(btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
        await cargarScripts();
        await cargarMotoresFantasma();
    });
}

const btnClear = document.getElementById('btn-clear');
if(btnClear) {
    btnClear.addEventListener('click', () => {
        clearTerminal();
    });
}
