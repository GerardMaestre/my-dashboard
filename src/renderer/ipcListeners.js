import { logTerminal } from '../ui/terminalSystem.js';
import { mostrarToast } from '../ui/toastSystem.js';
import { alternarBotones, aplicarFiltros, ejecutar } from '../features/dashboardSystem.js';
import { runningFiles, silentRuns } from '../core/state.js';
import { onProcessOutputBridge, onProcessExitBridge, isDesktop } from './hybridBridge.js';

export function initIpcListeners() {
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
            const isSuccess = code == 0;
            logTerminal(`[Fin] Código ${code}`, isSuccess ? 'system' : 'error');
            mostrarToast(`Script finalizado: ${fileName}`, isSuccess ? 'success' : 'error');
        }
        silentRuns.delete(fileName);
    });

    // Check for isDesktop 
    // Wait, backend error handling removed.
}
