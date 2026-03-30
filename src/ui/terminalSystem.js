import { mostrarToast } from './toastSystem.js';

export function toggleTerminal() {
	const drawer = document.getElementById("terminal-drawer");
	const icon = document.getElementById("btn-terminal-icon");
    if (!drawer) return;
	if (drawer.classList.contains("collapsed")) {
		drawer.classList.remove("collapsed");
		if (icon) icon.style.transform = "rotate(0deg)";
	} else {
		drawer.classList.add("collapsed");
		if (icon) icon.style.transform = "rotate(180deg)";
	}
}

export function logTerminal(mensaje, tipo = 'system') {
    const terminal = document.getElementById('terminal');
    if (!terminal) return;
	const span = document.createElement('span');
	span.className = `log-line log-${tipo}`;
	span.textContent = String(mensaje).replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
	terminal.appendChild(span);

	if (terminal.childNodes.length > 1000) {
		terminal.removeChild(terminal.firstChild);
	}

	terminal.scrollTop = terminal.scrollHeight;
}

export function copiarTerminal() {
    const terminal = document.getElementById('terminal');
    if (!terminal) return;
	const text = Array.from(terminal.childNodes).map(node => node.innerText).join('\n');
	navigator.clipboard.writeText(text).then(() => {
		mostrarToast('Log de consola copiado al portapapeles', 'success');
	}).catch(() => {
		mostrarToast('No se pudo copiar al portapapeles', 'error');
	});
}

export function clearTerminal() {
    const terminal = document.getElementById('terminal');
    if (terminal) {
        terminal.innerHTML = '<span class="log-system"> Log limpiado.</span>';
    }
}
