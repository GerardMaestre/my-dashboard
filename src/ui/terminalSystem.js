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

// Estado persistente para el streaming
let currentSpan = null;
let currentTextNode = null;
let lastTipo = null;
let pendingClear = false;

const processLogBuffer = () => {
    const terminal = document.getElementById('terminal');
    if (!terminal) {
        logBuffer = [];
        logRenderScheduled = false;
        return;
    }

    const fragment = document.createDocumentFragment();
    const isAtBottom = terminal.scrollHeight - terminal.scrollTop <= terminal.clientHeight + 80;
    
    // Si el terminal se limpió externamente, resetear referencias
    if (terminal.childElementCount <= 1 && !terminal.querySelector('.log-line')) {
        currentSpan = null;
        currentTextNode = null;
        pendingClear = false;
    }

    for (let i = 0; i < logBuffer.length; i++) {
        const { mensaje, tipo } = logBuffer[i];
        
        // Normalización crítica: Windows \r\n -> \n para evitar borrado fantasma
        let cleanMsg = String(mensaje)
            .replace(/\r\n/g, '\n')
            .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
        
        let start = 0;
        for (let j = 0; j < cleanMsg.length; j++) {
            const char = cleanMsg[j];
            
            if (char === '\n' || char === '\r') {
                const segment = cleanMsg.substring(start, j);
                if (segment || !currentSpan) {
                    appendToCurrentLine(segment, tipo, terminal, fragment);
                }
                
                if (char === '\n') {
                    currentSpan = null;
                    currentTextNode = null;
                    pendingClear = false;
                } else if (char === '\r') {
                    // Marcar para borrar solo cuando llegue el siguiente texto
                    pendingClear = true;
                }
                start = j + 1;
            }
        }
        
        if (start < cleanMsg.length) {
            appendToCurrentLine(cleanMsg.substring(start), tipo, terminal, fragment);
        }
    }

    if (fragment.childNodes.length > 0) {
        terminal.appendChild(fragment);
    }
    
    const maxLines = 1000;
    if (terminal.childElementCount > maxLines) {
        const excess = terminal.childElementCount - maxLines;
        for (let i = 0; i < excess; i++) {
            if (terminal.firstElementChild === currentSpan) break;
            terminal.removeChild(terminal.firstElementChild);
        }
    }

    if (isAtBottom) {
        terminal.scrollTop = terminal.scrollHeight;
    }

    logBuffer = [];
    logRenderScheduled = false;
};

function appendToCurrentLine(text, tipo, terminal, fragment) {
    if (!currentSpan || lastTipo !== tipo) {
        const now = new Date();
        const timestamp = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        
        currentSpan = document.createElement('span');
        currentSpan.className = `log-line log-${tipo}`;
        
        const timePrefix = document.createElement('span');
        timePrefix.className = 'log-timestamp';
        timePrefix.textContent = `[${timestamp}] `;
        
        currentSpan.appendChild(timePrefix);
        currentTextNode = document.createTextNode(text);
        currentSpan.appendChild(currentTextNode);
        
        fragment.appendChild(currentSpan);
        lastTipo = tipo;
        pendingClear = false;
    } else {
        if (pendingClear && text.length > 0) {
            currentTextNode.textContent = text;
            pendingClear = false;
        } else {
            currentTextNode.textContent += text;
        }
    }
}

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
        currentSpan = null;
        currentTextNode = null;
    }
}
