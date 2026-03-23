const terminal = document.getElementById('terminal');
const autopilotTasks = {};
const runningFiles = new Set();
const silentRuns = new Set();
let isFirstLoad = true;

let autostartList = JSON.parse(localStorage.getItem('nexus_autostart') || '[]');
let favoritesList = JSON.parse(localStorage.getItem('nexus_favorites') || '[]');

function toggleFavorite(fileName) {
	if (favoritesList.includes(fileName)) {
		favoritesList = favoritesList.filter((f) => f !== fileName);
		mostrarToast('Habilidad desanclada de Favoritos', 'system');
	} else {
		favoritesList.push(fileName);
		mostrarToast('Habilidad anclada en Favoritos', 'success');
	}
	localStorage.setItem('nexus_favorites', JSON.stringify(favoritesList));
	cargarScripts(); // Re-render for sorting
}

function safeId(fileName) {
	return encodeURIComponent(fileName).replace(/[^a-z0-9]/gi, '_');
}

function getElementId(fileName, prefix) {
	return `${prefix}-${safeId(fileName)}`;
}

function windowControl(action) {
	api.windowControl(action);
}

function toggleAutoStart(fileName) {
	if (autostartList.includes(fileName)) {
		autostartList = autostartList.filter((f) => f !== fileName);
	} else {
		autostartList.push(fileName);
	}
	localStorage.setItem('nexus_autostart', JSON.stringify(autostartList));
}

function toggleInfo(id) {
	const el = document.getElementById(id);
	if (!el) return;
	el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function obtenerInfoArchivo(fileName) {
	const lastDot = fileName.lastIndexOf('.');
	const ext = lastDot !== -1 ? fileName.slice(lastDot).toLowerCase() : '';
	if (ext === '.py') return { color: '#FFD60A', name: 'PY' };
	if (ext === '.bat' || ext === '.cmd') return { color: '#0A84FF', name: 'BAT' };
	if (ext === '.sh') return { color: '#30D158', name: 'SH' };
	return { color: '#8E8E93', name: 'BIN' };
}

async function cargarScripts() {
	const list = document.getElementById('script-list');
	list.innerHTML = '';

	let files = [];
	try {
		files = await api.listScripts();
	} catch (err) {
		logTerminal(`[Error] No se pudo leer mis_scripts: ${err}`, 'error');
		return;
	}
	
	// Ignore venv folders, non scripts, and explicitly hide .exe files from the UI
	// Internal logic will still be able to call them, but they won't clutter the dashboard.
	let validFiles = files.filter(
		(f) =>
			!f.includes('env_python') &&
			!f.includes('node_modules') &&
			!f.includes('.git') &&
			!f.includes('__pycache__') &&
			!f.toLowerCase().endsWith('.exe') &&
			!f.toLowerCase().endsWith('.pyc') &&
			!f.toLowerCase().endsWith('.md') && 
			!f.toLowerCase().endsWith('.txt')
	);

	// Sort files alphabetically for a solid experience
	validFiles.sort((a, b) => a.localeCompare(b));

	const fragment = document.createDocumentFragment();

	let pendingAutostarts = [];

	const groups = {};
	for (const file of validFiles) {
		const parts = file.split('/');
		const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : 'Misceláneo';
		
		if (favoritesList.includes(file)) {
			if (!groups['★ Destacados']) groups['★ Destacados'] = [];
			groups['★ Destacados'].push(file);
		} else {
			if (!groups[folder]) groups[folder] = [];
			groups[folder].push(file);
		}
	}

	const sortedFolders = Object.keys(groups).sort((a, b) => a.localeCompare(b));
	// fragment ya está declarado en la línea 70

	for (const folder of sortedFolders) {
		const header = document.createElement('li');
		header.className = 'category-header';
		// No usar innerHTML con datos dinámicos del disco (XSS en nombres de carpetas)
		header.innerHTML = `<svg viewBox="0 0 24 24"><path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;
		const title = document.createElement('span');
		title.textContent = folder.replace(/_/g, ' ');
		header.appendChild(title);
		fragment.appendChild(header);

		for (const file of groups[folder]) {
			const fileNameOnly = file.split('/').pop();
			const info = obtenerInfoArchivo(file);
			const isAutoActive = !!autopilotTasks[file];
			const isAutostart = autostartList.includes(file);

			let desc = "Añade 'DESC: tu descripción' dentro del código de tu script para que aparezca aquí.";
			let args = 'Ninguno / Desconocido';

			try {
				const lineas = await api.readScriptMeta(file);
				for (const linea of lineas) {
					if (linea.includes('DESC:')) desc = linea.split('DESC:')[1].trim();
					if (linea.includes('ARGS:')) args = linea.split('ARGS:')[1].trim();
				}
			} catch (err) {
				console.error('No se pudo leer el archivo: ', file, err);
			}

			if (isFirstLoad && isAutostart) {
				pendingAutostarts.push(file);
			}

			const key = safeId(file);
			const li = document.createElement('li');
			li.className = 'script-item';
			li.setAttribute('data-name', file);
			li.setAttribute('data-type', info.name);
			
			const divHeader = document.createElement('div');
			divHeader.className = 'card-header';
			const divTitleGroup = document.createElement('div');
			divTitleGroup.className = 'card-title-group';
			const divTitle = document.createElement('div');
			divTitle.className = 'card-title';
			const dot = document.createElement('span');
			dot.className = 'dot';
			dot.style.background = info.color;
			const spanName = document.createElement('span');
			spanName.className = 'file-name';
			spanName.title = file;
			spanName.textContent = fileNameOnly; 

			divTitle.appendChild(dot);
			divTitle.appendChild(spanName);
			divTitleGroup.appendChild(divTitle);
			divHeader.appendChild(divTitleGroup);

			const divDesc = document.createElement('div');
			divDesc.className = 'script-desc';
			divDesc.title = desc;
			divDesc.textContent = desc;
			divDesc.style.flex = 'none';
            divDesc.style.padding = '0'; // We'll move padding to the container

			const divArgs = document.createElement('div');
			divArgs.className = 'script-args-info';
			divArgs.title = args;
			divArgs.style.fontSize = '11px';
			divArgs.style.color = '#0A84FF';
			divArgs.style.marginTop = '4px';
			divArgs.style.whiteSpace = 'nowrap';
			divArgs.style.overflow = 'hidden';
			divArgs.style.textOverflow = 'ellipsis';
			// Importante: evita XSS (args viene de metadatos/entrada y no debe inyectarse con innerHTML)
			divArgs.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="vertical-align: middle; margin-right: 4px; position:relative; top:-1px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`;
			const strong = document.createElement('strong');
			strong.textContent = 'Parámetros:';
			divArgs.appendChild(strong);
			divArgs.appendChild(document.createTextNode(' ' + args));

			const divInfoContainer = document.createElement('div');
			divInfoContainer.style.flex = '1';
			divInfoContainer.style.display = 'flex';
			divInfoContainer.style.flexDirection = 'column';
			divInfoContainer.style.justifyContent = 'center';
			divInfoContainer.style.overflow = 'hidden';
			divInfoContainer.style.padding = '0 15px';
			
			divInfoContainer.appendChild(divDesc);
			divInfoContainer.appendChild(divArgs);

			const isFavorite = favoritesList.includes(file);
			
			const btnFav = document.createElement('button');
			btnFav.className = 'mac-icon-btn';
			btnFav.onclick = () => toggleFavorite(file);
			btnFav.style.marginRight = '10px';
			btnFav.innerHTML = isFavorite ? 
                `<svg viewBox="0 0 24 24" fill="var(--mac-blue)"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>` : 
                `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/></svg>`;

			const autostartRow = document.createElement('div');
			autostartRow.className = 'autostart-row';
			const asText = document.createElement('span');
			asText.className = 'autostart-text';
			asText.textContent = 'Auto';
			const asLabel = document.createElement('label');
			asLabel.className = 'mac-toggle';
			asLabel.title = "Arrancar con la App al inicio";
			const asInput = document.createElement('input');
			asInput.type = 'checkbox';
			asInput.onchange = () => toggleAutoStart(file);
			asInput.checked = isAutostart;
			const asSlider = document.createElement('span');
			asSlider.className = 'slider';
			asLabel.appendChild(asInput);
			asLabel.appendChild(asSlider);
			autostartRow.appendChild(btnFav);
			autostartRow.appendChild(asText);
			autostartRow.appendChild(asLabel);

			const liveStatus = document.createElement('div');
			liveStatus.id = `status-${key}`;
			liveStatus.className = `live-status ${isAutoActive ? 'active' : ''}`;
			liveStatus.innerHTML = `<div class="live-dot"></div><span><b id="countdown-${key}">--:--</b></span>`; 

			const cardActions = document.createElement('div');
			cardActions.className = 'card-actions';

			const btnEdit = document.createElement('button');
			btnEdit.className = 'mac-action-btn edit';
			btnEdit.onclick = () => openScript(file);
			btnEdit.textContent = 'Editar';

			const btnAuto = document.createElement('button');
			btnAuto.id = `btn-auto-${key}`;
			btnAuto.className = 'mac-action-btn auto';
			btnAuto.onclick = () => toggleAutopilot(file);
			btnAuto.style.display = isAutoActive ? 'none' : 'flex';
			btnAuto.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg> Auto`;

			const btnRun = document.createElement('button');
			btnRun.id = `btn-run-${key}`;
			btnRun.className = 'mac-action-btn run';
			btnRun.onclick = () => ejecutar(file);
			btnRun.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="margin-right:4px;"><path d="M8 5v14l11-7z"/></svg> Run`;

			const btnStop = document.createElement('button');
			btnStop.id = `btn-stop-${key}`;
			btnStop.className = 'mac-action-btn stop';
			btnStop.onclick = () => matarProceso(file);
			btnStop.style.display = 'none';
			btnStop.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="margin-right:4px;"><path d="M6 6h12v12H6z"/></svg> Stop`;

			cardActions.appendChild(btnEdit);
			cardActions.appendChild(btnAuto);
			cardActions.appendChild(btnRun);
			cardActions.appendChild(btnStop);

			li.appendChild(divHeader);
			li.appendChild(divInfoContainer);
			li.appendChild(autostartRow);
			li.appendChild(liveStatus);
			li.appendChild(cardActions);

			fragment.appendChild(li);
		}
	}
	
	list.appendChild(fragment);

	for (const file of pendingAutostarts) {
		logTerminal(`[AUTO-ARRANQUE] Lanzando ${file} de fondo...`, 'system');
		ejecutar(file, false, true);
	}

	isFirstLoad = false;
	aplicarFiltros();

	// Ocultar pantalla de carga
	const splash = document.getElementById('splash-screen');
	if (splash) {
		splash.classList.add('hidden');
		setTimeout(() => splash.remove(), 1000); // limpiar del DOM
	}
}

function alternarBotones(fileName, ejecutando) {
	if (autopilotTasks[fileName]) return;
	const key = safeId(fileName);
	const bRun = document.getElementById(`btn-run-${key}`);
	const bStop = document.getElementById(`btn-stop-${key}`);
	if (bRun && bStop) {
		bRun.style.display = ejecutando ? 'none' : 'flex';
		bStop.style.display = ejecutando ? 'flex' : 'none';
	}
}

function matarProceso(fileName) {
	if (api.stopScript(fileName)) {
		logTerminal(`[!] Operación abortada: ${fileName}`, 'error');
		alternarBotones(fileName, false);
	}
}

function ejecutar(fileName, isAuto = false, isSilent = false) {
	const args = document.getElementById('script-args').value.trim();
	const isExternal = document.getElementById('run-mode').value === 'external';

	if (!isSilent) {
		logTerminal(`\n▶ Ejecutando: ${fileName} ${args}`, 'command');
	}

	if (api.isRunning(fileName)) {
		if (!isSilent) logTerminal(`[!] Ya está en ejecución: ${fileName}`, 'error');
		return;
	}

	if (isSilent) silentRuns.add(fileName);
	alternarBotones(fileName, true);
	runningFiles.add(fileName);
	if (currentFilter === 'active') aplicarFiltros();
	api.runScript({ fileName, args, mode: isExternal ? 'external' : 'internal' });
}

function toggleAutopilot(fileName) {
	document.getElementById('sch-filename').innerText = fileName;
	document.getElementById('autopilot-modal').classList.add('active');
}

function cerrarAutopilot() {
	document.getElementById('autopilot-modal').classList.remove('active');
}

function iniciarAutopilot() {
	const fileName = document.getElementById('sch-filename').innerText;
	const timeInput = parseInt(document.getElementById('sch-time').value);
	
	if (!timeInput || timeInput <= 0) {
		mostrarToast("Por favor, introduce un tiempo válido mayor a 0.", "error");
		return;
	}
	
	const ms = timeInput * parseInt(document.getElementById('sch-unit').value);

	cerrarAutopilot();
	
	// Resetear valor para el siguiente uso
	document.getElementById('sch-time').value = '15';
	
	logTerminal(`[AUTOPILOT] Bucle iniciado para ${fileName}`, 'system');
	mostrarToast(`Autopilot activado para ${fileName}`, 'success');
	ejecutar(fileName, true);

	if (autopilotTasks[fileName] && autopilotTasks[fileName].timer) {
		clearInterval(autopilotTasks[fileName].timer);
	}

	autopilotTasks[fileName] = { timer: null, nextRun: Date.now() + ms }; // Initialize immediately
	
	const timer = setInterval(() => {
		autopilotTasks[fileName].nextRun = Date.now() + ms;
		if (!api.isRunning(fileName)) {
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
	
	// Actualizar timer inmediatamente para no mostrar --:-- el primer segundo
	updateTimers();
}

function updateTimers() {
	const now = Date.now();
	for (const [fileName, task] of Object.entries(autopilotTasks)) {
		let remaining = Math.max(0, Math.ceil((task.nextRun - now) / 1000));
		if (api.isRunning(fileName)) remaining = 0; // Mostrar 00:00 mientras corre

		const counterEl = document.getElementById(getElementId(fileName, 'countdown'));
		if (counterEl) {
			const m = String(Math.floor(remaining / 60)).padStart(2, '0');
			const s = String(remaining % 60).padStart(2, '0');
			counterEl.innerText = `${m}:${s}`;
		}
	}
}

setInterval(updateTimers, 1000);

function detenerAutopilot(fileName) {
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

function openScript(fileName) {
	api.editScript(fileName);
}

function logTerminal(mensaje, tipo) {
	const span = document.createElement('span');
	span.className = `log-line log-${tipo}`;
	// Limpiar códigos ANSI de la consola de Python/CMD
	span.textContent = String(mensaje).replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
	terminal.appendChild(span);
	
	// Limitar el registro a 1000 lineas para evitar sobrecarga de memoria
	if (terminal.childNodes.length > 1000) {
		terminal.removeChild(terminal.firstChild);
	}
	
	terminal.scrollTop = terminal.scrollHeight;
}

api.onProcessOutput(({ fileName, type, message }) => {
	if (fileName === 'Sistema') {
		logTerminal(message, type);
		return;
	}
	if (!runningFiles.has(fileName)) return;
	logTerminal(message, type);
});

api.onProcessExit(({ fileName, code }) => {
	runningFiles.delete(fileName);
	alternarBotones(fileName, false);
	if (currentFilter === 'active') aplicarFiltros();

	if (!silentRuns.has(fileName)) {
		const isSuccess = code === 0;
		logTerminal(`[Fin] Código ${code}`, isSuccess ? 'system' : 'error');
		mostrarToast(`Script finalizado: ${fileName}`, isSuccess ? 'success' : 'error');
	}

	silentRuns.delete(fileName);
});
let selectedIndex = -1;

// Atajos de teclado utiles
document.addEventListener('keydown', (e) => {
	// Ctrl + L para limpiar consola
	if (e.ctrlKey && e.key === 'l') {
		e.preventDefault();
		terminal.innerHTML = '<span class="log-system"> Sistema Nexus inicializado. Listo para operar.</span>';
	}
	
	// F3 para buscar
	if (e.key === 'F3' || (e.ctrlKey && e.key === 'f')) {
		e.preventDefault();
		document.getElementById('search-input').focus();
	}

	// Navegación con Teclado
	if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const visibleItems = Array.from(document.querySelectorAll('.script-item:not(.hidden)'));
        if (visibleItems.length === 0) return;
        
        if (e.key === 'ArrowDown') {
            selectedIndex = (selectedIndex + 1) % visibleItems.length;
        } else {
            selectedIndex = (selectedIndex - 1 + visibleItems.length) % visibleItems.length;
        }
        
        visibleItems.forEach((item, idx) => {
            if (idx === selectedIndex) {
                item.style.boxShadow = 'inset 0 0 0 2px var(--mac-blue)';
                item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            } else {
                item.style.boxShadow = '';
            }
        });
        e.preventDefault();
    }

	if (e.key === 'Enter' && selectedIndex >= 0) {
        const visibleItems = Array.from(document.querySelectorAll('.script-item:not(.hidden)'));
        if (visibleItems[selectedIndex]) {
            const fileName = visibleItems[selectedIndex].getAttribute('data-name');
            ejecutar(fileName);
			e.preventDefault();
        }
    }
});
document.getElementById('btn-refresh').addEventListener('click', cargarScripts);
document.getElementById('btn-clear').addEventListener('click', () => {
	terminal.innerHTML = '<span class="log-system"> Log limpiado.</span>';
});

let searchTimeout;
let currentFilter = 'all';

function aplicarFiltros() {
	selectedIndex = -1;
	const term = document.getElementById('search-input').value.toLowerCase();
	const terms = term.split(' ').filter(Boolean);
	let found = false;

	document.querySelectorAll('.script-item').forEach((item) => {
		item.style.boxShadow = ''; // Limpiar selector teclado
		const fileName = item.getAttribute('data-name');
		const fileType = item.getAttribute('data-type');
		const isRunning = runningFiles.has(fileName) || autopilotTasks[fileName];

		const matchesSearch = terms.every(t => fileName.toLowerCase().includes(t));
		
		let matchesFilter = true;
		if (currentFilter === 'py') matchesFilter = fileType === 'PY';
		else if (currentFilter === 'bat') matchesFilter = fileType === 'BAT';
		else if (currentFilter === 'active') matchesFilter = isRunning;

		const show = matchesSearch && matchesFilter;
		
		if (show) {
			item.classList.remove('hidden');
			// Usamos setTimeout para que display block ocurra antes de la transicin de opacidad en CSS
			item.style.display = ''; 
			found = true;
		} else {
			item.classList.add('hidden');
			setTimeout(() => {
				if (item.classList.contains('hidden')) item.style.display = 'none';
			}, 300); // Mismo tiempo que la transicin CSS
		}
	});

	let noResults = document.getElementById('no-results');
	if (!found) {
		if (!noResults) {
			noResults = document.createElement('div');
			noResults.id = 'no-results';
			noResults.style.color = '#888';
			noResults.style.padding = '50px 20px';
			noResults.style.textAlign = 'center';
			noResults.style.gridColumn = '1 / -1';
			noResults.innerHTML = `<h3>No hay scripts para mostrar</h3><p style="opacity:0.7; margin-top:10px;">Prueba ajustando los filtros o tu búsqueda.</p>`;
			document.getElementById('script-list').appendChild(noResults);
		}
		noResults.style.display = 'block';
	} else if (noResults) {
		noResults.style.display = 'none';
	}
}

document.querySelectorAll('.tab-btn').forEach(btn => {
	btn.addEventListener('click', (e) => {
		const targetBtn = e.target.closest('.tab-btn');
		if (!targetBtn) return;
		
		document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
		targetBtn.classList.add('active');
		
		currentFilter = targetBtn.getAttribute('data-filter');
		
		const titleEl = document.getElementById('current-category-title');
		if (titleEl) {
			titleEl.textContent = targetBtn.textContent.trim();
		}
		
		aplicarFiltros();
	});
});

document.getElementById('search-input').addEventListener('input', () => {
	clearTimeout(searchTimeout);
	searchTimeout = setTimeout(aplicarFiltros, 300);
});

window.windowControl = windowControl;
window.toggleInfo = toggleInfo;
window.toggleAutoStart = toggleAutoStart;
window.toggleAutopilot = toggleAutopilot;
window.cerrarAutopilot = cerrarAutopilot;
window.iniciarAutopilot = iniciarAutopilot;
window.ejecutar = ejecutar;
window.matarProceso = matarProceso;
window.openScript = openScript;

api.getStorageDir();
cargarScripts();


function toggleTerminal() {
    const drawer = document.getElementById("terminal-drawer");
    const icon = document.getElementById("btn-terminal-icon");
    if (drawer.classList.contains("collapsed")) {
        drawer.classList.remove("collapsed");
        if(icon) icon.style.transform = "rotate(0deg)";
    } else {
        drawer.classList.add("collapsed");
        if(icon) icon.style.transform = "rotate(180deg)";
    }
}
window.toggleTerminal = toggleTerminal;

function mostrarToast(mensaje, tipo = 'system') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;
    
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;align-items:center;gap:10px;';
    
    const iconDiv = document.createElement('span');
    if (tipo === 'success') iconDiv.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="var(--mac-green)"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    else if (tipo === 'error') iconDiv.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="var(--mac-red)"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    else iconDiv.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="var(--mac-blue)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';
    
    const textSpan = document.createElement('span');
    textSpan.textContent = mensaje; // textContent prevents XSS
    
    wrapper.appendChild(iconDiv);
    wrapper.appendChild(textSpan);
    toast.appendChild(wrapper);
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fadeOut');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
window.mostrarToast = mostrarToast;

function copiarTerminal() {
    const text = Array.from(document.getElementById('terminal').childNodes).map(node => node.innerText).join('\n');
    navigator.clipboard.writeText(text).then(() => {
        mostrarToast('Log de consola copiado al portapapeles', 'success');
    }).catch(() => {
        mostrarToast('No se pudo copiar al portapapeles', 'error');
    });
}
window.copiarTerminal = copiarTerminal;

// Theming & Settings Logic
function openSettings() {
    document.getElementById('settings-modal').classList.add('hidden');
}

// ==========================================
// OJO DE DIOS (Buscador Global en Memoria RAM)
// ==========================================
let ojoDatabase = [];
let ojoIndexing = false;
let ojoIndexed = false;

function abrirOjoDeDios() {
    const modal = document.getElementById('modal-ojo-dios');
    if (modal) {
        modal.classList.add('active');
        const input = document.getElementById('ojo-input');
        if (input) input.focus();
        
        if (!ojoIndexed && !ojoIndexing) {
            ojoIndexing = true;
            document.getElementById('ojo-status').textContent = "Mapeando el disco duro hacia la memoria RAM... (Iniciando)";
            
            api.scanGlobalFiles((results) => {
                ojoDatabase = results;
                ojoIndexed = true;
                ojoIndexing = false;
                document.getElementById('ojo-status').textContent = `Índice listo: ${ojoDatabase.length.toLocaleString()} archivos inyectados en RAM.`;
                filtrarOjoDeDios();
            }, (count) => {
                // Progress update
                document.getElementById('ojo-status').textContent = `Indexando a ultra-velocidad: ${count.toLocaleString()} archivos encontrados...`;
            });
        } else {
            filtrarOjoDeDios();
        }
    }
}

function cerrarOjoDeDios() {
    const modal = document.getElementById('modal-ojo-dios');
    if (modal) modal.classList.remove('active');
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        cerrarOjoDeDios();
        closeSettings();
    }
});

const ojoInput = document.getElementById('ojo-input');
if (ojoInput) {
    ojoInput.addEventListener('input', filtrarOjoDeDios);
}

function filtrarOjoDeDios() {
    const input = document.getElementById('ojo-input');
    const ul = document.getElementById('ojo-results');
    if (!input || !ul) return;
    
    const query = input.value.trim().toLowerCase();
    ul.innerHTML = '';
    
    if (query.length < 2) return;
    if (!ojoIndexed) return;
    
    const parts = query.split(' ');
    let matches = [];
    
    for (let i = 0; i < ojoDatabase.length; i++) {
        const itemLine = ojoDatabase[i]; // ej: "FILE|C:\Users\foo\bar.txt"
        
        // Extraer nombre del archivo velozmente
        const lastSlash = Math.max(itemLine.lastIndexOf('\\'), itemLine.lastIndexOf('/'));
        const name = lastSlash !== -1 ? itemLine.substring(lastSlash + 1) : itemLine;
        const lowerName = name.toLowerCase();
        
        if (parts.every(p => lowerName.includes(p))) {
            matches.push({ line: itemLine, name: name });
            if (matches.length >= 100) break; // Límite por rendimiento visual y DOM
        }
    }
    
    if (matches.length === 0) {
        ul.innerHTML = '<li style="color:#888; padding: 20px; text-align:center;">Ningún archivo coincide con tu búsqueda (Ojo de Dios).</li>';
        return;
    }
    
    const iconMap = {
        'DIR': '📁',
        'FILE': '📄'
    };
    
    const fragment = document.createDocumentFragment();
    matches.forEach(m => {
        const typeMatch = m.line.substring(0, 4); // "DIR|" o "FILE|"
        const type = typeMatch.startsWith('DIR') ? 'DIR' : 'FILE';
        const fullPath = type === 'DIR' ? m.line.substring(4) : m.line.substring(5);
        
        const li = document.createElement('li');
        li.style.cssText = `
            background: rgba(255, 255, 255, 0.03); border-radius: 8px; padding: 10px 15px; 
            display: flex; align-items: center; cursor: pointer; border: 1px solid transparent; transition: 0.1s;
        `;
        li.onmouseenter = () => { li.style.background = 'rgba(10, 132, 255, 0.15)'; li.style.borderColor = 'rgba(10, 132, 255, 0.3)'; };
        li.onmouseleave = () => { li.style.background = 'rgba(255, 255, 255, 0.03)'; li.style.borderColor = 'transparent'; };
        
		// Match words for highlighting (sin innerHTML para evitar XSS con nombres de archivo)
		const displayName = m.name;
		const iconDiv = document.createElement('div');
		iconDiv.style.fontSize = '20px';
		iconDiv.style.marginRight = '15px';
		iconDiv.textContent = iconMap[type] || '📄';

		const textContainer = document.createElement('div');
		textContainer.style.flex = '1';
		textContainer.style.overflow = 'hidden';
		textContainer.style.whiteSpace = 'nowrap';
		textContainer.style.textOverflow = 'ellipsis';

		const titleDiv = document.createElement('div');
		titleDiv.style.color = 'white';
		titleDiv.style.fontWeight = '500';
		titleDiv.style.fontSize = '14px';
		titleDiv.appendChild(highlightText(displayName, parts));

		const pathDiv = document.createElement('div');
		pathDiv.style.color = '#888';
		pathDiv.style.fontSize = '11px';
		pathDiv.textContent = fullPath;

		textContainer.appendChild(titleDiv);
		textContainer.appendChild(pathDiv);

		li.appendChild(iconDiv);
		li.appendChild(textContainer);
        li.onclick = () => {
            api.showGlobalItemInFolder(fullPath);
            cerrarOjoDeDios();
        };
        fragment.appendChild(li);
    });
    ul.appendChild(fragment);
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function highlightText(text, parts) {
	// Devuelve nodos con resaltado seguro (sin inyectar HTML)
	if (!parts || parts.length === 0) return document.createTextNode(text);

	const escapedParts = parts
		.map(p => String(p).trim())
		.filter(Boolean)
		.map(escapeRegExp);

	if (escapedParts.length === 0) return document.createTextNode(text);

	const regex = new RegExp(`(${escapedParts.join('|')})`, 'gi');
	const fragment = document.createDocumentFragment();
	let lastIndex = 0;
	let match = null;

	while ((match = regex.exec(text)) !== null) {
		const start = match.index;
		const matched = match[0];
		if (start > lastIndex) {
			fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
		}

		const span = document.createElement('span');
		span.style.color = '#FF9500';
		span.textContent = matched;
		fragment.appendChild(span);

		lastIndex = start + matched.length;
		if (matched.length === 0) regex.lastIndex++;
	}

	if (lastIndex < text.length) {
		fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
	}

	return fragment;
}
function closeSettings() {
    document.getElementById('settings-modal').classList.remove('active');
}
window.openSettings = openSettings;
window.closeSettings = closeSettings;

function changeTheme() {
    const theme = document.getElementById('theme-selector').value;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('nexus_theme', theme);
}
window.changeTheme = changeTheme;

// Init Theme on Load
const savedTheme = localStorage.getItem('nexus_theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
if(document.getElementById('theme-selector')) {
    document.getElementById('theme-selector').value = savedTheme;
}
