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

let logBuffer = [];
let logRenderScheduled = false;

const processLogBuffer = () => {
    const terminal = document.getElementById('terminal');
    if (!terminal) {
        logBuffer = [];
        logRenderScheduled = false;
        return;
    }

    const fragment = document.createDocumentFragment();
    let lastSpan = terminal.lastElementChild;
    const isAtBottom = terminal.scrollHeight - terminal.scrollTop <= terminal.clientHeight + 20;
    const now = new Date();
    const timestamp = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;


    for (let i = 0; i < logBuffer.length; i++) {
        const { mensaje, tipo } = logBuffer[i];
        let cleanMsg = String(mensaje).replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
        
        const parts = cleanMsg.split(/\r/);
        for (let j = 0; j < parts.length; j++) {
            const part = parts[j];
            if (j > 0) {
                if (lastSpan) {
                    lastSpan.textContent = part;
                } else if (part) {
                    lastSpan = document.createElement('span');
                    lastSpan.className = `log-line log-${tipo}`;
                    lastSpan.textContent = part;
                    fragment.appendChild(lastSpan);
                }
            } else if (part) {
                lastSpan = document.createElement('span');
                lastSpan.className = `log-line log-${tipo}`;
                // Timestamp prefix para tracking profesional
                const timePrefix = document.createElement('span');
                timePrefix.className = 'log-timestamp';
                timePrefix.textContent = `[${timestamp}] `;
                lastSpan.appendChild(timePrefix);
                lastSpan.appendChild(document.createTextNode(part));
                fragment.appendChild(lastSpan);
            }
        }
    }

    if (fragment.childNodes.length > 0) {
        terminal.appendChild(fragment);
    }
    
    // Optimización: purga batch via Range (O(1) vs O(n) individual removes)
    const maxLines = 1000;
    const excess = terminal.childElementCount - maxLines;
    if (excess > 0) {
        const range = document.createRange();
        range.setStartBefore(terminal.firstElementChild);
        range.setEndAfter(terminal.children[excess - 1]);
        range.deleteContents();
    }

    if (isAtBottom) {
        terminal.scrollTop = terminal.scrollHeight;
    }

    logBuffer = [];
    logRenderScheduled = false;
};

export function logTerminal(mensaje, tipo = 'system') {
    logBuffer.push({ mensaje, tipo });
    
    if (!logRenderScheduled) {
        logRenderScheduled = true;
        requestAnimationFrame(processLogBuffer);
    }
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
