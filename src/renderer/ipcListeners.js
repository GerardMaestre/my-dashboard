import { logTerminal } from '../ui/terminalSystem.js';
import { mostrarToast } from '../ui/toastSystem.js';
import { alternarBotones, aplicarFiltros, ejecutar } from '../features/dashboardSystem.js';
import { runningFiles, silentRuns } from '../core/state.js';
import { pushSparklineValue } from './telemetry.js';
import { onProcessOutputBridge, onProcessExitBridge, onTelemetryBridge, isDesktop } from './hybridBridge.js';

export function initIpcListeners(telemetryCharts) {
    onProcessOutputBridge(({ fileName, type, message }) => {
        if (fileName === 'Sistema') {
            logTerminal(message, type);
            return;
        }
        if (!runningFiles.has(fileName)) return;
        logTerminal(message, type);
    });

    onProcessExitBridge(({ fileName, code }) => {
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

    let lastPurgeTime = 0;
    onTelemetryBridge((data) => {
        pushSparklineValue(telemetryCharts.cpu, Number(data.cpuLoad) || 0);
        const memUse = Number(data.memUse) || 0;
        const memTotal = Number(data.memTotal) || 0;
        const pct = memTotal > 0 ? (memUse / memTotal) * 100 : 0;
        pushSparklineValue(telemetryCharts.mem, pct);

        if (pct > 90 && Date.now() - lastPurgeTime > 300000) {
            lastPurgeTime = Date.now();
            logTerminal('[AUTOPILOT TRIGGER] RAM > 90%. Lanzando purgado de emergencia...', 'error');
            mostrarToast('Autopilot: Purgando RAM (>90%)', 'system');
            ejecutar('04_Utilidades_Archivos/Purgar_ram.py', true, true);
        }

        const tb = (bytes) => (bytes / (1024*1024)).toFixed(2) + ' MB/s';
        const rxEl = document.getElementById('tele-rx');
        const txEl = document.getElementById('tele-tx');
        if (rxEl) rxEl.textContent = tb(data.netRx);
        if (txEl) txEl.textContent = tb(data.netTx);
    });

    if (isDesktop && window.api && window.api.onSpotlight) {
        window.api.onSpotlight(() => {
            if (window.toggleSpotlight) window.toggleSpotlight();
        });
    }
}
