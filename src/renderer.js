const terminal = document.getElementById('terminal');
const autopilotTasks = {};
const runningFiles = new Set();
const silentRuns = new Set();
let isFirstLoad = true;

let autostartList = JSON.parse(localStorage.getItem('nexus_autostart') || '[]');

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
			!f.toLowerCase().endsWith('.exe') &&
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
		if (!groups[folder]) groups[folder] = [];
		groups[folder].push(file);
	}

	const sortedFolders = Object.keys(groups).sort((a, b) => a.localeCompare(b));
	// fragment ya está declarado en la línea 70

	for (const folder of sortedFolders) {
		const header = document.createElement('li');
		header.className = 'category-header';
		header.innerHTML = `<svg viewBox="0 0 24 24"><path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
		<span>${folder.replace(/_/g, ' ')}</span>`;
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
			li.className = 'script-item mac-glass';
			li.setAttribute('data-name', file);
			li.setAttribute('data-type', info.name);
			
			const divHeader = document.createElement('div');
			divHeader.className = 'card-header';
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

			const btnIcon = document.createElement('button');
			btnIcon.className = 'mac-icon-btn';
			btnIcon.onclick = () => toggleInfo(`info-${key}`);
			btnIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`; 
			
			divHeader.appendChild(divTitle);
			divHeader.appendChild(btnIcon);

			const divInfo = document.createElement('div');
			divInfo.id = `info-${key}`;
			divInfo.className = 'info-panel';
			divInfo.style.display = 'none';
			const pDesc = document.createElement('p');
			pDesc.textContent = desc; 
			const pArgs = document.createElement('p');
			pArgs.style.marginTop = '5px';
			const strongArgs = document.createElement('strong');
			strongArgs.textContent = 'Parámetros: ';
			const codeArgs = document.createElement('code');
			codeArgs.textContent = args; 
			pArgs.appendChild(strongArgs);
			pArgs.appendChild(codeArgs);
			divInfo.appendChild(pDesc);
			divInfo.appendChild(pArgs);

			const autostartRow = document.createElement('div');
			autostartRow.className = 'autostart-row';
			const asText = document.createElement('span');
			asText.textContent = 'Arrancar con la App';
			const asLabel = document.createElement('label');
			asLabel.className = 'mac-toggle';
			const asInput = document.createElement('input');
			asInput.type = 'checkbox';
			asInput.onchange = () => toggleAutoStart(file);
			asInput.checked = isAutostart;
			const asSlider = document.createElement('span');
			asSlider.className = 'slider';
			asLabel.appendChild(asInput);
			asLabel.appendChild(asSlider);
			autostartRow.appendChild(asText);
			autostartRow.appendChild(asLabel);

			const liveStatus = document.createElement('div');
			liveStatus.id = `status-${key}`;
			liveStatus.className = `live-status ${isAutoActive ? 'active' : ''}`;
			liveStatus.innerHTML = `<div class="live-dot"></div><span>Autopilot en <b id="countdown-${key}">--:--</b></span>`; 

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
			btnAuto.style.display = isAutoActive ? 'none' : 'block';
			btnAuto.textContent = 'Auto';

			const btnRun = document.createElement('button');
			btnRun.id = `btn-run-${key}`;
			btnRun.className = 'mac-action-btn run';
			btnRun.onclick = () => ejecutar(file);
			btnRun.textContent = 'Ejecutar';

			const btnStop = document.createElement('button');
			btnStop.id = `btn-stop-${key}`;
			btnStop.className = 'mac-action-btn stop';
			btnStop.onclick = () => matarProceso(file);
			btnStop.style.display = 'none';
			btnStop.textContent = 'Parar';

			cardActions.appendChild(btnEdit);
			cardActions.appendChild(btnAuto);
			cardActions.appendChild(btnRun);
			cardActions.appendChild(btnStop);

			li.appendChild(divHeader);
			li.appendChild(divInfo);
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
		bRun.style.display = ejecutando ? 'none' : 'block';
		bStop.style.display = ejecutando ? 'block' : 'none';
	}
}

function matarProceso(fileName) {
	if (api.stopScript(fileName)) {
		logTerminal(`[!] Operaci�n abortada: ${fileName}`, 'error');
		alternarBotones(fileName, false);
	}
}

function ejecutar(fileName, isAuto = false, isSilent = false) {
	const args = document.getElementById('script-args').value.trim();
	const isExternal = document.getElementById('run-mode').value === 'external';

	if (!isSilent) {
		logTerminal(`\n? Ejecutando: ${fileName} ${args}`, 'command');
	}

	if (isExternal) {
		api.runScript({ fileName, args, mode: 'external' });
		return;
	}

	if (api.isRunning(fileName)) {
		if (!isSilent) logTerminal(`[!] Ya est� en ejecuci�n: ${fileName}`, 'error');
		return;
	}

	if (isSilent) silentRuns.add(fileName);
	alternarBotones(fileName, true);
	runningFiles.add(fileName);
	if (currentFilter === 'active') aplicarFiltros();
	api.runScript({ fileName, args, mode: 'internal' });
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
		alert("Por favor, introduce un tiempo v�lido mayor a 0.");
		return;
	}
	
	const ms = timeInput * parseInt(document.getElementById('sch-unit').value);

	cerrarAutopilot();
	
	// Resetear valor para el siguiente uso
	document.getElementById('sch-time').value = '15';
	
	logTerminal(`[AUTOPILOT] Bucle iniciado para ${fileName}`, 'system');
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

		const statusEl = document.getElementById(getElementId(fileName, 'status'));
		if (statusEl) statusEl.classList.remove('active');
		const btnRun = document.getElementById(getElementId(fileName, 'btn-run'));
		if (btnRun) {
			btnRun.innerText = 'Ejecutar';
			btnRun.className = 'mac-action-btn run';
			btnRun.onclick = () => ejecutar(fileName);
		}
		const btnAuto = document.getElementById(getElementId(fileName, 'btn-auto'));
		if (btnAuto) btnAuto.style.display = 'block';
		matarProceso(fileName);
	}
}

function openScript(fileName) {
	api.openPath(fileName);
}

function logTerminal(mensaje, tipo) {
	const span = document.createElement('span');
	span.className = `log-line log-${tipo}`;
	span.innerText = mensaje;
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
		logTerminal(`[Fin] C�digo ${code}`, code === 0 ? 'system' : 'error');
	}

	silentRuns.delete(fileName);
});
// Atajos de teclado utiles
document.addEventListener('keydown', (e) => {
	// Ctrl + L para limpiar consola
	if (e.ctrlKey && e.key === 'l') {
		e.preventDefault();
		terminal.innerHTML = '<span class="log-system">? Sistema Nexus inicializado. Listo para operar.</span>';
	}
	
	// F3 para buscar
	if (e.key === 'F3' || (e.ctrlKey && e.key === 'f')) {
		e.preventDefault();
		document.getElementById('search-input').focus();
	}
});
document.getElementById('btn-refresh').addEventListener('click', cargarScripts);
document.getElementById('btn-clear').addEventListener('click', () => {
	terminal.innerHTML = '<span class="log-system">? Log limpiado.</span>';
});

let searchTimeout;
let currentFilter = 'all';

function aplicarFiltros() {
	const term = document.getElementById('search-input').value.toLowerCase();
	let found = false;

	document.querySelectorAll('.script-item').forEach((item) => {
		const fileName = item.getAttribute('data-name');
		const fileType = item.getAttribute('data-type');
		const isRunning = runningFiles.has(fileName) || autopilotTasks[fileName];

		const matchesSearch = fileName.toLowerCase().includes(term);
		
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
			noResults.innerHTML = `<h3>No hay scripts para mostrar</h3><p style="opacity:0.7; margin-top:10px;">Prueba ajustando los filtros o tu bsqueda.</p>`;
			document.getElementById('script-list').appendChild(noResults);
		}
		noResults.style.display = 'block';
	} else if (noResults) {
		noResults.style.display = 'none';
	}
}

document.querySelectorAll('.tab-btn').forEach(btn => {
	btn.addEventListener('click', (e) => {
		document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
		e.target.classList.add('active');
		currentFilter = e.target.getAttribute('data-filter');
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
