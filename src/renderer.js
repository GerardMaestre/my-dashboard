import { windowControl, openSettings, closeSettings, initTheme, changeTheme } from './ui/windowSystem.js';
import { toggleTerminal, logTerminal, copiarTerminal, clearTerminal } from './ui/terminalSystem.js';
import { mostrarToast } from './ui/toastSystem.js';
import { cargarScripts, ejecutar, matarProceso, openScript, toggleFavorite, toggleAutoStart, aplicarFiltros, alternarBotones, setupTabs, setRunModePolicy, ejecutar1ClickMode } from './features/dashboardSystem.js';
import { toggleAutopilot, cerrarAutopilot, iniciarAutopilot, initAutopilotLoop } from './features/autopilotSystem.js';
import { abrirOjoDeDios, cerrarOjoDeDios, bindGhostEvents, cargarMotoresFantasma } from './features/ojoDeDios.js';
import { initRuntimePaths } from './core/utils.js';
import { runningFiles, silentRuns } from './core/state.js';
import { initRadarSystem } from './ui/RadarSystem.js';

// Exponer métodos críticos a WINDOW para que index.html "onclick" sigan funcionando
window.windowControl = windowControl;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.changeTheme = changeTheme;
window.ejecutar1ClickMode = ejecutar1ClickMode;
window.ejecutarComandoTerminal = () => {
    const inputField = document.getElementById('terminal-input');
    if(!inputField) return;
    const cmd = inputField.value.trim().toLowerCase();
    if(!cmd) return;
    inputField.value = '';

    logTerminal(`$ ${cmd}`, 'command');

    if(cmd === 'limpiar' || cmd === 'clear') {
        clearTerminal();
        return;
    }

    const items = Array.from(document.querySelectorAll('.script-item'));
    const match = items.find(el => {
        const n = el.getAttribute('data-name').toLowerCase();
        return n.includes(cmd.replace(' ', '_')) || n.includes(cmd);
    });

    if(match) {
        const fileName = match.getAttribute('data-name');
        logTerminal(`[Terminal] Ejecutando coincidencia de comando: ${fileName}`, 'system');
        ejecutar(fileName);
    } else {
        logTerminal(`[Error] Comando o script no encontrado: ${cmd}`, 'error');
    }
};
window.changeGlobalTerminalMode = () => {
    const mode = document.getElementById('global-terminal-mode').value;
    localStorage.setItem('nexus_terminal_mode', mode);
    cargarScripts(); // Re-render logic to apply mode hints
};
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

// Radar de red en tiempo real (D3 + IPC + accion de firewall).
const radarController = initRadarSystem({
    containerId: 'network-radar',
    statusId: 'network-radar-status',
    modalId: 'network-node-modal',
    onNotify: (message, type = 'system') => mostrarToast(message, type),
    onLog: (message, type = 'system') => logTerminal(message, type)
});

// Spotlight global
window.toggleSpotlight = () => {
    const o = document.getElementById('spotlight-overlay');
    if(o) {
        if(o.style.display === 'flex') {
            o.style.display = 'none';
            o.style.opacity = '0';
        } else {
            o.style.display = 'flex';
            o.style.opacity = '1';
            const input = document.getElementById('spotlight-input');
            if(input) {
                input.value = '';
                document.getElementById('spotlight-results').innerHTML = '';
                setTimeout(() => input.focus(), 50);
            }
        }
    }
};

// Input handling para Spotlight
const spotInput = document.getElementById('spotlight-input');
if(spotInput) {
    spotInput.addEventListener('input', () => {
        const term = spotInput.value.toLowerCase().trim();
        const results = document.getElementById('spotlight-results');
        results.innerHTML = '';
        if(!term) return;

        // Buscar en la grilla visual de scripts
        const allItems = Array.from(document.querySelectorAll('.script-item'));
        const matches = allItems.filter(el => el.getAttribute('data-name').toLowerCase().includes(term));

        matches.slice(0, 5).forEach((match, idx) => {
            const fileName = match.getAttribute('data-name');
            const shortName = fileName.split('/').pop();
            const li = document.createElement('li');
            li.style.cssText = `padding:10px 15px; border-radius:8px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; margin-bottom:5px; background: ${idx === 0 ? 'rgba(10, 132, 255, 0.2)' : 'rgba(255,255,255,0.05)'}`;
            li.innerHTML = `<span><strong style="color:var(--mac-text); font-size:16px;">${shortName}</strong><br><span style="color:var(--mac-text-muted); font-size:12px;">${fileName}</span></span>
            <span style="font-size:11px; background:var(--mac-blue); padding:3px 8px; border-radius:4px;">${idx===0 ? 'Enter para Ejecutar' : 'Run'}</span>`;
            
            li.onclick = () => { window.toggleSpotlight(); ejecutar(fileName); };
            results.appendChild(li);
        });
    });

    spotInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const results = document.getElementById('spotlight-results');
            if(results.firstChild) {
                results.firstChild.click();
            }
        }
    });
}

// Cargar preferencia de terminal global
const savedTerminalMode = localStorage.getItem('nexus_terminal_mode') || 'external';
const globalSelector = document.getElementById('global-terminal-mode');
if (globalSelector) globalSelector.value = savedTerminalMode;

// ====== TELEMETRY & CHART.JS SETTINGS ======
let cpuChart = null;
let memChart = null;

function initCharts() {
    const commonOpts = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 }, // For real-time updates
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
            x: { display: false },
            y: { min: 0, max: 100, display: false }
        },
        elements: { point: { radius: 0 }, line: { tension: 0.4 } }
    };

    const ctxCpu = document.getElementById('chart-cpu');
    if(ctxCpu && window.Chart) {
        cpuChart = new Chart(ctxCpu, {
            type: 'line',
            data: { labels: Array(20).fill(''), datasets: [{ data: Array(20).fill(0), borderColor: '#0A84FF', borderWidth: 2, fill: true, backgroundColor: 'rgba(10, 132, 255, 0.1)' }] },
            options: commonOpts
        });
    }

    const ctxMem = document.getElementById('chart-mem');
    if(ctxMem && window.Chart) {
        memChart = new Chart(ctxMem, {
            type: 'line',
            data: { labels: Array(20).fill(''), datasets: [{ data: Array(20).fill(0), borderColor: '#FF9F0A', borderWidth: 2, fill: true, backgroundColor: 'rgba(255, 159, 10, 0.1)' }] },
            options: commonOpts
        });
    }
}

initCharts();

if (window.api) {
    window.api.getStorageDir();
    initRuntimePaths().catch(e => console.error('[HorusEngine] initRuntimePaths failed:', e));
    if (window.api.getRunModePolicy) {
        window.api.getRunModePolicy()
            .then((policy) => setRunModePolicy(policy || {}))
            .catch((e) => console.error('[HorusEngine] getRunModePolicy failed:', e))
            .finally(() => cargarScripts().catch(e => console.error('[HorusEngine] cargarScripts failed:', e)));
    } else {
        cargarScripts().catch(e => console.error('[HorusEngine] cargarScripts failed:', e));
    }
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

    if (window.api.onTelemetry) {
        let lastPurgeTime = 0;
        
        window.api.onTelemetry((data) => {
            if (cpuChart) {
                const arr = cpuChart.data.datasets[0].data;
                arr.shift();
                arr.push(data.cpuLoad);
                cpuChart.update();
            }
            if (memChart) {
                const arr = memChart.data.datasets[0].data;
                const pct = (data.memUse / data.memTotal) * 100;
                arr.shift();
                arr.push(pct);
                memChart.update();

                // AUTOPILOT EVENT TRIGGER: Limpiar RAM si supera el 90%
                if (pct > 90 && Date.now() - lastPurgeTime > 300000) { // Max 1 purga automátca cada 5 minutos
                    lastPurgeTime = Date.now();
                    logTerminal('[AUTOPILOT TRIGGER] RAM > 90%. Lanzando purgado de emergencia...', 'error');
                    mostrarToast('Autopilot: Purgando RAM (>90%)', 'system');
                    ejecutar('04_Utilidades_Archivos/Purgar_ram.py', true, true);
                }
            }
            const tb = (bytes) => (bytes / (1024*1024)).toFixed(2) + ' MB/s';
            const rxEl = document.getElementById('tele-rx');
            const txEl = document.getElementById('tele-tx');
            if (rxEl) rxEl.textContent = tb(data.netRx);
            if (txEl) txEl.textContent = tb(data.netTx);
        });
    }

    if (window.api.onSpotlight) {
        window.api.onSpotlight(() => {
            window.toggleSpotlight();
        });
    }
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
        const o = document.getElementById('spotlight-overlay');
        if(o && o.style.display === 'flex') window.toggleSpotlight();
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

        const terminalInput = document.getElementById('terminal-input');
        if(terminalInput && document.activeElement === terminalInput) {
            window.ejecutarComandoTerminal();
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

window.addEventListener('beforeunload', () => {
    if (radarController && typeof radarController.destroy === 'function') {
        radarController.destroy();
    }
});
