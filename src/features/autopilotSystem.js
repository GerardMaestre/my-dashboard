import { autopilotTasks } from '../core/state.js';
import { getElementId, safeId } from '../core/utils.js';
import { ejecutar, matarProceso } from './dashboardSystem.js';
import { mostrarToast } from '../ui/toastSystem.js';
import { logTerminal } from '../ui/terminalSystem.js';

export function toggleAutopilot(fileName) {
	const schName = document.getElementById('sch-filename');
    if (schName) schName.innerText = fileName;
	const activeModal = document.getElementById('autopilot-modal');
    if (activeModal) activeModal.classList.add('active');
}

export function cerrarAutopilot() {
	const activeModal = document.getElementById('autopilot-modal');
    if (activeModal) activeModal.classList.remove('active');
}

export function iniciarAutopilot() {
	const schName = document.getElementById('sch-filename');
    if (!schName) return;
    const fileName = schName.innerText;
    
    const timeInputElem = document.getElementById('sch-time');
	const timeInput = parseInt(timeInputElem ? timeInputElem.value : '15');

	if (!timeInput || timeInput <= 0) {
		mostrarToast("Por favor, introduce un tiempo válido mayor a 0.", "error");
		return;
	}

    const unitSelect = document.getElementById('sch-unit');
	const ms = timeInput * parseInt(unitSelect ? unitSelect.value : '60000');

	cerrarAutopilot();

	if (timeInputElem) timeInputElem.value = '15';

	logTerminal(`[AUTOPILOT] Bucle iniciado para ${fileName}`, 'system');
	mostrarToast(`Autopilot activado para ${fileName}`, 'success');
	ejecutar(fileName, true);

	if (autopilotTasks[fileName] && autopilotTasks[fileName].timer) {
		clearInterval(autopilotTasks[fileName].timer);
	}

	autopilotTasks[fileName] = { timer: null, nextRun: Date.now() + ms };

	const timer = setInterval(() => {
		autopilotTasks[fileName].nextRun = Date.now() + ms;
		if (window.api && !window.api.isRunning(fileName)) {
			ejecutar(fileName, true);
		}
	}, ms);

	autopilotTasks[fileName].timer = timer;

	const statusEl = document.getElementById(getElementId(fileName, 'status'));
	if (statusEl) statusEl.classList.add('active');
	const btnAuto = document.getElementById(getElementId(fileName, 'btn-auto'));
	if (btnAuto) btnAuto.style.display = 'none';

	const btnRun = document.getElementById(getElementId(fileName, 'btn-run'));
	if (btnRun) {
		btnRun.innerText = 'Stop Auto';
		btnRun.className = 'mac-action-btn stop';
		btnRun.onclick = () => detenerAutopilot(fileName);
	}

	updateTimers();
}

export function updateTimers() {
	const now = Date.now();
	for (const [fileName, task] of Object.entries(autopilotTasks)) {
		let remaining = Math.max(0, Math.ceil((task.nextRun - now) / 1000));
		if (window.api && window.api.isRunning(fileName)) remaining = 0; 

		const counterEl = document.getElementById(getElementId(fileName, 'countdown'));
		if (counterEl) {
			const m = String(Math.floor(remaining / 60)).padStart(2, '0');
			const s = String(remaining % 60).padStart(2, '0');
			counterEl.innerText = `${m}:${s}`;
		}
	}
}

export function detenerAutopilot(fileName) {
	if (autopilotTasks[fileName]) {
		clearInterval(autopilotTasks[fileName].timer);
		delete autopilotTasks[fileName];
		logTerminal(`[AUTOPILOT] Bucle cancelado para ${fileName}`, 'error');
		mostrarToast(`Autopilot detenido: ${fileName}`, 'system');

		const statusEl = document.getElementById(getElementId(fileName, 'status'));
		if (statusEl) statusEl.classList.remove('active');
		const btnRun = document.getElementById(getElementId(fileName, 'btn-run'));
		if (btnRun) {
			btnRun.innerText = 'Ejecutar';
			btnRun.className = 'mac-action-btn run';
			btnRun.onclick = () => ejecutar(fileName);
		}
		const btnAuto = document.getElementById(getElementId(fileName, 'btn-auto'));
		if (btnAuto) btnAuto.style.display = 'flex';
		matarProceso(fileName);
	}
}

export function initAutopilotLoop() {
    setInterval(updateTimers, 1000);
}
