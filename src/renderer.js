const terminal = document.getElementById('terminal');
const autopilotTasks = {};
const runningFiles = new Set();
const silentRuns = new Set();
let isFirstLoad = true;

let autostartList = JSON.parse(localStorage.getItem('nexus_autostart') || '[]');
let favoritesList = JSON.parse(localStorage.getItem('nexus_favorites') || '[]');

const proModePolicy = {
	'07_Herramientas_Pro/Analizador_Espacio.py': 'internal',
	'07_Herramientas_Pro/Desinstalador_Root.bat': 'external'
};

function resolveRunMode(fileName, selectedMode) {
	return proModePolicy[fileName] || selectedMode;
}

function modeLabel(mode) {
	return mode === 'external' ? 'Visual externo' : 'Integrado';
}

const ghostState = {
	engines: {
		everythingAvailable: false,
		wiztreeAvailable: false,
		geekAvailable: false
	},
	searchTimer: null,
	lastQuery: '',
	activeScreen: 'search',
	appsLoaded: false,
	diskScanned: false,
	listenersBound: false,
	searchAppsCache: null,
	searchSeq: 0,
	diskPathStack: ['C:\\'],
	diskScanSeq: 0,
	appsList: []
};

function formatBytes(size) {
	const bytes = Number(size || 0);
	if (bytes <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let idx = 0;
	let value = bytes;
	while (value >= 1024 && idx < units.length - 1) {
		value /= 1024;
		idx += 1;
	}
	return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[idx]}`;
}

function getFileIconFromPath(filePath) {
	const lower = String(filePath || '').toLowerCase();
	if (lower.endsWith('.exe')) return '🧩';
	if (lower.endsWith('.pdf')) return '📕';
	if (lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z')) return '🗜️';
	if (lower.endsWith('.mp4') || lower.endsWith('.mkv') || lower.endsWith('.avi')) return '🎬';
	if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.flac')) return '🎵';
	if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp')) return '🖼️';
	if (lower.endsWith('.doc') || lower.endsWith('.docx')) return '📝';
	if (lower.endsWith('.xls') || lower.endsWith('.xlsx') || lower.endsWith('.csv')) return '📊';
	if (lower.endsWith('.js') || lower.endsWith('.ts') || lower.endsWith('.py') || lower.endsWith('.bat')) return '💻';
	return '📄';
}

function getAppIcon(name) {
	const n = String(name || '').toLowerCase();
	if (n.includes('chrome')) return '🌐';
	if (n.includes('firefox')) return '🦊';
	if (n.includes('edge')) return '🔷';
	if (n.includes('discord')) return '🎮';
	if (n.includes('spotify')) return '🎧';
	if (n.includes('steam')) return '🎲';
	if (n.includes('nvidia')) return '🟩';
	if (n.includes('adobe')) return '🅰️';
	if (n.includes('microsoft')) return '🪟';
	if (n.includes('visual studio') || n.includes('vscode')) return '🧠';
	if (n.includes('java')) return '☕';
	if (n.includes('python')) return '🐍';
	return '🧩';
}

function buildFileUrl(winPath) {
	const p = String(winPath || '').trim();
	if (!p) return '';
	const normalized = p.replace(/\\/g, '/');
	if (/^[a-zA-Z]:\//.test(normalized)) {
		return `file:///${encodeURI(normalized)}`;
	}
	return `file://${encodeURI(normalized)}`;
}

function extractIconPath(app) {
	let raw = String(app?.displayIcon || '').trim();

	if (!raw && app?.uninstallString) {
		const match = app.uninstallString.match(/([a-zA-Z]:\\[^"*,]+\.(exe|ico))/i);
		if (match) raw = match[1];
	}

	if (!raw && app?.installLocation) {
		raw = app.installLocation;
	}

	if (!raw) return '';

	raw = raw.replace(/,[\s\-]?\d+$/, '').trim();
	raw = raw.replace(/"/g, '');

	raw = raw.replace(/%ProgramFiles%/gi, 'C:\\Program Files')
			 .replace(/%ProgramFiles\(x86\)%/gi, 'C:\\Program Files (x86)')
			 .replace(/%AppData%/gi, 'C:\\Users\\gerar\\AppData\\Roaming')
			 .replace(/%LocalAppData%/gi, 'C:\\Users\\gerar\\AppData\\Local')
			 .replace(/%SystemRoot%/gi, 'C:\\Windows')
			 .replace(/%WinDir%/gi, 'C:\\Windows');

	return raw;
}

function safeText(v) {
	return String(v || '').replace(/[&<>"']/g, (ch) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;'
	}[ch]));
}

function getAppIconMarkup(app, iconId) {
	const fallback = getAppIcon(app?.name || '');
	return `<span class="app-icon-fallback" id="${iconId}">${fallback}</span>`;
}

async function loadRealAppIcon(app, iconId) {
	const displayIconPath = extractIconPath(app);
	if (!displayIconPath) return;

	if (displayIconPath.match(/\.(png|jpg|jpeg|webp|gif|ico)$/i)) {
		const src = buildFileUrl(displayIconPath);
		const el = document.getElementById(iconId);
		if (el) el.outerHTML = `<img class="app-icon-img" id="${iconId}" src="${src}" alt="icon" loading="lazy" onerror="this.outerHTML=''">`;
		return;
	}

	if (window.api && api.getFileIcon) {
		try {
			const base64 = await api.getFileIcon(displayIconPath);
			if (base64) {
				const el = document.getElementById(iconId);
				if (el) el.outerHTML = `<img class="app-icon-img" id="${iconId}" src="${base64}" alt="icon" loading="lazy">`;
			}
		} catch (e) {}
	}
}

function filterAppsList(query) {
	const term = String(query || '').trim().toLowerCase();
	if (!term) return ghostState.appsList;
	return ghostState.appsList.filter((app) => {
		const fields = [app.name, app.publisher, app.version, app.installLocation].map((x) => String(x || '').toLowerCase());
		return fields.some((x) => x.includes(term));
	});
}

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

			const modeHint = document.createElement('div');
			const preferredMode = proModePolicy[file] || document.getElementById('run-mode').value;
			const modeColor = preferredMode === 'external' ? '#FF9F0A' : '#30D158';
			modeHint.style.fontSize = '11px';
			modeHint.style.marginTop = '4px';
			modeHint.style.color = modeColor;
			modeHint.textContent = `Modo recomendado: ${modeLabel(preferredMode)}`;

			const divInfoContainer = document.createElement('div');
			divInfoContainer.style.flex = '1';
			divInfoContainer.style.display = 'flex';
			divInfoContainer.style.flexDirection = 'column';
			divInfoContainer.style.justifyContent = 'center';
			divInfoContainer.style.overflow = 'hidden';
			divInfoContainer.style.padding = '0 15px';
			
			divInfoContainer.appendChild(divDesc);
			divInfoContainer.appendChild(divArgs);
			divInfoContainer.appendChild(modeHint);

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
	const selectedMode = document.getElementById('run-mode').value;
	const modeToUse = resolveRunMode(fileName, selectedMode);
	const isExternal = modeToUse === 'external';

	if (!isSilent) {
		logTerminal(`\n▶ Ejecutando: ${fileName} ${args}`, 'command');
		logTerminal(`[MODO] ${modeLabel(modeToUse)}`, 'system');
	}

	if (isExternal) {
		const result = api.runScript({ fileName, args, mode: modeToUse });
		if (!isSilent) {
			if (result && result.forcedExternal) {
				mostrarToast('Herramienta Pro ejecutada en modo visual externo automáticamente.', 'system');
			}
			mostrarToast(`Lanzado en modo visual: ${fileName.split('/').pop()}`, 'success');
		}
		return;
	}
	if (api.isRunning(fileName)) {
		if (!isSilent) logTerminal(`[!] Ya está en ejecución: ${fileName}`, 'error');
		return;
	}

	if (isSilent) silentRuns.add(fileName);
	alternarBotones(fileName, true);
	runningFiles.add(fileName);
	if (currentFilter === 'active') aplicarFiltros();
	const result = api.runScript({ fileName, args, mode: modeToUse });
	if (!result || result.pid === null) {
		runningFiles.delete(fileName);
		alternarBotones(fileName, false);
		if (!isSilent) {
			logTerminal(`[SYS] No se pudo iniciar: ${fileName}`, 'error');
			mostrarToast(`Error al iniciar ${fileName.split('/').pop()}`, 'error');
		}
	}
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
let isDragging = false;
let startY, startX, initialTop, initialLeft;

window.addEventListener('error', (event) => {
	setTimeout(() => {
		if (typeof logTerminal === 'function') {
			logTerminal(`[UI Crash] ${event.message} at ${event.filename}:${event.lineno}`, 'error');
		} else {
			alert(`FATAL UI ERROR: ${event.message} en lineno ${event.lineno}`);
		}
	}, 100);
});

window.addEventListener('unhandledrejection', (event) => {
	setTimeout(() => {
		if (typeof logTerminal === 'function') {
			logTerminal(`[UI Promise] ${event.reason?.message || event.reason}`, 'error');
		}
	}, 100);
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
document.getElementById('btn-refresh').addEventListener('click', async () => {
	await cargarScripts();
	await cargarMotoresFantasma();
});
document.getElementById('btn-clear').addEventListener('click', () => {
	terminal.innerHTML = '<span class="log-system"> Log limpiado.</span>';
});

async function cargarMotoresFantasma() {
	const statusEl = document.getElementById('ojo-status');
	if (!statusEl) return;

	try {
		ghostState.engines = await api.getGhostEngineStatus();
		const modeEverything = ghostState.engines.everythingAvailable ? 'Everything' : 'Fallback nativo';
		const modeWiz = ghostState.engines.wiztreeAvailable ? 'WizTree' : 'Fallback nativo';
		const modeGeek = ghostState.engines.geekAvailable ? 'Geek' : 'Registro + PowerShell';
		statusEl.textContent = `Motores activos -> Search: ${modeEverything} | Disco: ${modeWiz} | Apps: ${modeGeek}`;
	} catch (error) {
		statusEl.textContent = 'Motores fallback nativo activo';
		logTerminal(`[Ghost] Error obteniendo estado de motores: ${error.message || error}`, 'error');
	}
}

function setOjoScreen(screen) {
	const target = ['search', 'disk', 'apps'].includes(screen) ? screen : 'search';
	ghostState.activeScreen = target;

	document.querySelectorAll('.ojo-tab-btn').forEach((btn) => {
		btn.classList.toggle('active', btn.getAttribute('data-ojo-screen') === target);
	});

	document.querySelectorAll('.ojo-screen').forEach((view) => {
		view.classList.toggle('active', view.id === `ojo-screen-${target}`);
	});

	if (target === 'search') {
		const input = document.getElementById('ojo-input');
		if (input) input.focus();
	} else if (target === 'disk' && !ghostState.diskScanned) {
		ejecutarEscaneoFantasma();
	} else if (target === 'apps' && !ghostState.appsLoaded) {
		cargarAppsFantasma();
	}
}

function setOjoStatus(message) {
	const status = document.getElementById('ojo-status');
	if (status) status.textContent = message;
}

function renderResultadosBusqueda(items) {
	const container = document.getElementById('ojo-results');
	if (!container) return;
	container.innerHTML = '';

	if (!items || items.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'ghost-item';
		empty.innerHTML = '<div class="ghost-item-name">Sin resultados para esta busqueda.</div>';
		container.appendChild(empty);
		return;
	}

	setOjoStatus(`Resultados encontrados: ${items.length.toLocaleString()}`);

	const fragment = document.createDocumentFragment();
	items.forEach((item) => {
		const row = document.createElement('div');
		row.className = 'ghost-item';
		const fileIcon = getFileIconFromPath(item.fullPath || item.name);
		const sourceLabel = item.source ? `<span style="font-size:10px;color:#8aa7ff;">${item.source}</span>` : '';
		row.innerHTML = `
			<div style="font-size:16px;">${fileIcon}</div>
			<div style="min-width:0;flex:1;">
				<div class="ghost-item-name">${item.name || 'archivo'} ${sourceLabel}</div>
				<div class="ghost-item-path">${item.fullPath || ''}</div>
			</div>
		`;
		row.addEventListener('click', () => {
			if (!item.fullPath) return;
			if (item.fullPath.startsWith('[APP]')) {
				if (item.installLocation) {
					api.openGlobalPath(item.installLocation);
				} else {
					mostrarToast('App detectada sin ruta local disponible', 'system');
				}
				return;
			}
			api.showGlobalItemInFolder(item.fullPath);
		});
		fragment.appendChild(row);
	});
	container.appendChild(fragment);
}

async function ejecutarBusquedaFantasma(query) {
	const q = String(query || '').trim();
	ghostState.lastQuery = q;
	const runSeq = ++ghostState.searchSeq;
	if (q.length < 2) {
		setOjoStatus('Escribe al menos 2 caracteres para buscar.');
		renderResultadosBusqueda([]);
		return;
	}

	try {
		const qLower = q.toLowerCase();
		const isExeSearch = qLower === '.exe' || qLower === 'exe' || qLower.endsWith('.exe');
		const shouldSearchApps = isExeSearch || qLower.includes('app') || qLower.includes('program');
		const useBackend = ghostState.engines.everythingAvailable || !ojoIndexed;
		setOjoStatus(useBackend ? 'Buscando en indice RAM + motor rapido...' : 'Buscando en indice RAM...');

		const backendPromise = useBackend ? api.buscarArchivo(q, 12000) : Promise.resolve([]);
		const appsPromise = shouldSearchApps
			? (ghostState.searchAppsCache ? Promise.resolve(ghostState.searchAppsCache) : api.listarAppsInstaladas())
			: Promise.resolve([]);
		const [backend, apps] = await Promise.all([backendPromise, appsPromise]);
		if (runSeq !== ghostState.searchSeq || ghostState.lastQuery !== q) return;
		if (shouldSearchApps && !ghostState.searchAppsCache) ghostState.searchAppsCache = apps || [];

		const local = ojoIndexed ? buscarEnIndiceLocal(q, 12000) : [];
		const mergedMap = new Map();
		for (const item of local) mergedMap.set((item.fullPath || '').toLowerCase(), item);
		for (const item of (backend || [])) {
			const key = (item.fullPath || '').toLowerCase();
			if (!mergedMap.has(key)) mergedMap.set(key, { ...item, source: 'backend' });
		}

		if (shouldSearchApps) {
			for (const app of (apps || [])) {
				const n = String(app.name || '').toLowerCase();
				if (!n.includes(qLower) && !isExeSearch) continue;
				const syntheticPath = `[APP] ${app.name}`;
				const key = syntheticPath.toLowerCase();
				if (!mergedMap.has(key)) {
					mergedMap.set(key, {
						id: `app-${app.id || app.name}`,
						name: `${app.name}.exe`,
						fullPath: syntheticPath,
						installLocation: app.installLocation || '',
						source: 'apps-registry'
					});
				}
			}
		}

		renderResultadosBusqueda(Array.from(mergedMap.values()));
	} catch (error) {
		setOjoStatus('Error de busqueda. Reintenta.');
		mostrarToast('Error en Buscador Cuantico', 'error');
		logTerminal(`[Ghost] Buscar archivo fallo: ${error.message || error}`, 'error');
	}
}

function buscarEnIndiceLocal(query, max = 120) {
	const qLower = query.toLowerCase();
	const parts = qLower.split(' ').filter(Boolean);
	const isExeSearch = qLower === '.exe' || qLower === 'exe' || qLower.endsWith('.exe');
	const matches = [];
	for (let i = 0; i < ojoDatabase.length; i++) {
		const itemLine = ojoDatabase[i];
		const fullPath = itemLine.startsWith('DIR|') ? itemLine.substring(4) : itemLine.substring(5);
		const lower = fullPath.toLowerCase();
		const pass = isExeSearch
			? (itemLine.startsWith('FILE|') && lower.endsWith('.exe'))
			: parts.every((p) => lower.includes(p));
		if (pass) {
			matches.push({
				id: `local-${i}`,
				name: fullPath.split('\\').pop() || fullPath,
				fullPath,
				source: 'ram'
			});
			if (matches.length >= max) break;
		}
	}
	return matches;
}

function renderEscaneoDisco(payload) {
	const container = document.getElementById('ojo-disk-results');
	const treemap = document.getElementById('ojo-disk-treemap');
	const extensionsContainer = document.getElementById('ojo-disk-extensions');
	const breadcrumb = document.getElementById('ojo-disk-breadcrumb');
	if (!container) return;
	container.innerHTML = '';
	if (treemap) treemap.innerHTML = '';
	if (extensionsContainer) extensionsContainer.innerHTML = '';

	const currentPath = ghostState.diskPathStack[ghostState.diskPathStack.length - 1] || 'C:\\';
	if (breadcrumb) {
		breadcrumb.innerHTML = '';
		ghostState.diskPathStack.forEach((p, idx) => {
			const node = document.createElement('button');
			node.className = 'disk-crumb';
			node.textContent = idx === 0 ? p : (p.split('\\').filter(Boolean).slice(-1)[0] || p);
			node.addEventListener('click', () => navegarDiscoAIndice(idx));
			breadcrumb.appendChild(node);
			if (idx < ghostState.diskPathStack.length - 1) {
				const sep = document.createElement('span');
				sep.className = 'disk-crumb-sep';
				sep.textContent = '›';
				breadcrumb.appendChild(sep);
			}
		});
	}

	const items = payload?.items || [];
	if (items.length === 0) {
		container.innerHTML = '<div class="disk-item"><div class="disk-topline"><span>No hay datos de escaneo.</span></div></div>';
		return;
	}

	if (treemap) {
		// 1. Leer tamaño REAL del DOM para evitar deformaciones,
		// PERO si el renderizado ocurre en background oscuro (pre-warming c:\) su valor será 0.
        // En ese caso usamos un aspect ratio panorámico simulado (1200x360).
		const treemapRect = treemap.getBoundingClientRect();
		const boxW = treemapRect.width > 200 ? treemapRect.width : 1200; 
		const boxH = treemapRect.height > 100 ? treemapRect.height : 360; 

		treemap.style.minHeight = '360px'; 
		treemap.style.position = 'relative';

		let mapItems = items.filter(i => i.sizeBytes > 0).sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 180);
		
		const tmFragment = document.createDocumentFragment();
		const layout = getSquarifiedLayout(mapItems, 0, 0, boxW, boxH, 1);

		layout.forEach((rect, idx) => {
            const { item, x, y, w, h, depth, hue, isParent } = rect;
            const tile = document.createElement('button');
            tile.className = 'disk-tile';
            const pct = Math.max(0.1, Number(item.percent || 1));
            
            tile.style.position = 'absolute';
            tile.style.left = `${(x / boxW) * 100}%`;
            tile.style.top = `${(y / boxH) * 100}%`;
            tile.style.width = `${(w / boxW) * 100}%`;
            tile.style.height = `${(h / boxH) * 100}%`;
            tile.style.margin = '0';
            tile.style.zIndex = depth;
            tile.style.boxSizing = 'border-box';
            
            let varianceStr = item.name || '';
            let variance = 0;
            for(let j=0; j<varianceStr.length; j++) variance += varianceStr.charCodeAt(j);
            let lightness = depth === 1 ? 40 : (30 + (variance % 25)); 
            let saturation = depth === 1 ? 80 : (65 + (variance % 25)); 
            
            if (isParent) {
                tile.style.background = `rgba(0, 0, 0, 0.45)`;
                tile.style.border = `1px solid hsla(${hue}, 80%, 50%, 0.8)`;
                tile.style.boxShadow = 'none';
            } else {
                tile.style.border = '1px solid rgba(0,0,0,0.6)';
                tile.style.boxShadow = 'inset 2px 2px 4px rgba(255,255,255,0.15), inset -2px -2px 4px rgba(0,0,0,0.4)';
                tile.style.background = `radial-gradient(circle at 30% 30%, hsla(${hue},${saturation}%,${lightness + 12}%,1) 0%, hsla(${hue},${saturation}%,${lightness - 8}%,1) 120%)`;
            }
            
            tile.title = `${item.name || item.fullPath}\n${formatBytes(item.sizeBytes, 1)} • ${pct}%`;
            tile.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!item.fullPath) return;
                ejecutarEscaneoFantasma(item.fullPath, true);
            });
            tmFragment.appendChild(tile);
            
            // --- CORRECCIÓN DE TEXTOS SOLAPADOS Y Z-INDEX ---
            // Solo dibujamos el texto si es un padre con espacio reservado, o si es un archivo lo suficientemente grande
            let hasHeader = (isParent && depth <= 4 && h > 35);
            let isLeafAndBig = (!isParent && w > 40 && h > 15 && depth <= 5);

            if (hasHeader || isLeafAndBig) {
                const label = document.createElement('div');
                label.className = 'disk-tile-label';
                
                label.style.position = 'absolute';
                label.style.left = `${(x / boxW) * 100}%`;
                label.style.top = `${(y / boxH) * 100}%`;
                label.style.width = `${(w / boxW) * 100}%`;
                // Obligamos a que el texto siempre flote por encima de todas las cajas
                label.style.zIndex = depth + 1000;
                
                let hHeaderLimit = isParent ? Math.min(h, 18) : h;
                label.style.height = `${(hHeaderLimit / boxH) * 100}%`;
                
                let displayName = item.name || item.fullPath || 'item';
                if (item.isDir && !displayName.endsWith('\\')) displayName += '\\';
                
                let rawBytesStr = formatBytes(item.sizeBytes, 1);
                if (!rawBytesStr.includes('.') && rawBytesStr.includes('GB')) rawBytesStr = rawBytesStr.replace(' GB', '.0 GB');
                if (!rawBytesStr.includes('.') && rawBytesStr.includes('MB')) rawBytesStr = rawBytesStr.replace(' MB', '.0 MB');

                let boldness = isParent ? '700' : '600';
                let colorText = isParent ? '#fff' : 'rgba(255,255,255,0.9)';
                
                // Formateo seguro para forzar ellipsis y no ensanchar la UI
                label.innerHTML = `<span style="font-weight:${boldness}; color:${colorText}; font-size:10px; line-height:1.1; display:block; width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${displayName} (${rawBytesStr})</span>`;
                tmFragment.appendChild(label);
            }
        });
		treemap.appendChild(tmFragment);
	}

	const fragment = document.createDocumentFragment();
	items.slice(0, 220).forEach((item) => {
		const card = document.createElement('div');
		card.className = 'disk-item';
		const pct = Math.max(1, Math.min(100, Number(item.percent || 0)));
		card.innerHTML = `
			<div class="disk-topline">
				<span>${item.name || item.fullPath}</span>
				<span>${formatBytes(item.sizeBytes)}</span>
			</div>
			<div class="disk-bar-bg">
				<div class="disk-bar-fill" style="width:${pct}%"></div>
			</div>
		`;
		card.addEventListener('click', () => {
			if (!item.fullPath) return;
			if (item.fullPath.toLowerCase() === currentPath.toLowerCase()) return;
			ejecutarEscaneoFantasma(item.fullPath, true);
		});
		fragment.appendChild(card);
	});
	container.appendChild(fragment);

	if (payload?.extensions && extensionsContainer) {
		const extFragment = document.createDocumentFragment();
		payload.extensions.forEach((ext) => {
			const card = document.createElement('div');
			card.className = 'disk-item';
			const pct = Math.max(1, Math.min(100, Number(ext.percent || 0)));
			card.innerHTML = `
				<div class="disk-topline">
					<span style="color:#a8c7fa; font-weight:600;">${ext.ext}</span>
					<span>${formatBytes(ext.sizeBytes)}</span>
				</div>
				<div class="disk-bar-bg" style="background: rgba(255,255,255,0.05);">
					<div class="disk-bar-fill" style="width:${pct}%; background: linear-gradient(90deg, #5b5bd6, #a8c7fa);"></div>
				</div>
			`;
			extFragment.appendChild(card);
		});
		extensionsContainer.appendChild(extFragment);
	}
}

function navegarDiscoAIndice(idx) {
	if (idx < 0 || idx >= ghostState.diskPathStack.length) return;
	ghostState.diskPathStack = ghostState.diskPathStack.slice(0, idx + 1);
	const target = ghostState.diskPathStack[idx] || 'C:\\';
	ejecutarEscaneoFantasma(target, false);
}

function subirNivelDisco() {
	if (ghostState.diskPathStack.length <= 1) return;
	ghostState.diskPathStack.pop();
	const target = ghostState.diskPathStack[ghostState.diskPathStack.length - 1] || 'C:\\';
	ejecutarEscaneoFantasma(target, false);
}

async function ejecutarEscaneoFantasma(rootPath = null, pushStack = false) {
	const targetRoot = String(rootPath || ghostState.diskPathStack[ghostState.diskPathStack.length - 1] || 'C:\\');
	if (pushStack) {
		const last = ghostState.diskPathStack[ghostState.diskPathStack.length - 1];
		if (!last || last.toLowerCase() !== targetRoot.toLowerCase()) {
			ghostState.diskPathStack.push(targetRoot);
		}
	}

	const scanSeq = ++ghostState.diskScanSeq;
	const btn = document.getElementById('ojo-btn-scan');
	const loadingEl = document.getElementById('ojo-disk-loading');
	const contentEl = document.getElementById('ojo-disk-content');
	
	if (btn) {
		btn.disabled = true;
		btn.textContent = 'Calculando...';
	}
	if (loadingEl) loadingEl.style.display = 'flex';
	if (contentEl) contentEl.style.display = 'none';

	try {
		setOjoStatus(`Escaneando ${targetRoot}...`);
		const payload = await api.escanearDisco(targetRoot);
		if (scanSeq !== ghostState.diskScanSeq) return;
		
		if (loadingEl) loadingEl.style.display = 'none';
		if (contentEl) contentEl.style.display = 'flex';
		
		renderEscaneoDisco(payload);
		
		ghostState.diskScanned = true;
		setOjoStatus(`Mapa listo para ${targetRoot} (${(payload?.engine || 'native').toUpperCase()}).`);
	} catch (err) {
		console.error(err);
		try { require('fs').writeFileSync('C:\\Users\\gerar\\Desktop\\mi-dashboard\\my-app\\frontend_crash.txt', String(err.stack || err.message)); } catch(e){}
		logTerminal(`[ERROR] Ojo de Dios: Fallo al escanear: ${err.message}`);
		const title = document.querySelector('.ojo-dios-subtitle');
		if (title) {
			title.innerHTML = `<span style="color:var(--accent-red);">Fallo en escaneo de disco: ${err.message}. Reintente.</span>`;
		}
	} finally {
		if (btn) {
			btn.disabled = false;
			btn.textContent = 'Raiz C:';
		}
	}
}

function renderAppsGrid(apps) {
	const grid = document.getElementById('ojo-apps-grid');
	if (!grid) return;
	grid.innerHTML = '';

	if (!apps || apps.length === 0) {
		grid.innerHTML = '<div class="app-card"><div class="app-title">No hay aplicaciones detectadas.</div></div>';
		return;
	}

	const fragment = document.createDocumentFragment();
	apps.slice(0, 300).forEach((app) => {
		const card = document.createElement('div');
		card.className = 'app-card';
		const iconId = `app-icon-${Math.random().toString(36).substr(2, 9)}`;
		const iconMarkup = getAppIconMarkup(app, iconId);
		const safeName = safeText(app.name);
		const safeVersion = safeText(app.version || '-');

		// Iniciar carga asíncrona del icono real nativo al encolar la carta
		setTimeout(() => loadRealAppIcon(app, iconId), 10);
		const safePublisher = safeText(app.publisher || 'Desconocido');
		card.innerHTML = `
			<div class="app-card-top">
				<div class="app-icon">${iconMarkup}</div>
				<div style="min-width:0;flex:1;">
					<div class="app-title">${safeName}</div>
					<div class="app-meta">Version: ${safeVersion}</div>
				</div>
			</div>
			<div class="app-meta">Proveedor: ${safePublisher}</div>
		`;

		const actions = document.createElement('div');
		actions.style.display = 'flex';
		actions.style.gap = '8px';

		const locateBtn = document.createElement('button');
		locateBtn.className = 'mac-action-btn edit';
		locateBtn.textContent = 'Ruta';
		locateBtn.addEventListener('click', () => {
			if (app.installLocation) {
				api.openGlobalPath(app.installLocation);
			} else {
				mostrarToast('No hay ruta de instalacion disponible', 'system');
			}
		});

		const uninstallBtn = document.createElement('button');
		uninstallBtn.className = 'mac-action-btn stop';
		uninstallBtn.textContent = 'Auto-Desinstalar';
		uninstallBtn.addEventListener('click', async () => {
			const ok = window.confirm(`Desinstalar automaticamente ${app.name} y limpiar rastros detectables?`);
			if (!ok) return;
			try {
				uninstallBtn.disabled = true;
				uninstallBtn.textContent = 'Procesando...';
				const result = await api.desinstalarApp(app);
				if (result?.started) {
					mostrarToast(`Desinstalacion automatica finalizada para ${app.name}`, 'success');
					logTerminal(`[Ghost] Auto-desinstalacion: ${app.name} | exit:${result.exitCode} | limpieza:${result.cleanupPerformed ? 'si' : 'no'}`, 'system');
				} else {
					mostrarToast(`Proceso no confirmado para ${app.name}`, 'error');
				}
				await cargarAppsFantasma();
			} catch (error) {
				mostrarToast(`No se pudo desinstalar ${app.name}`, 'error');
				logTerminal(`[Ghost] Desinstalar fallo (${app.name}): ${error.message || error}`, 'error');
			} finally {
				uninstallBtn.disabled = false;
				uninstallBtn.textContent = 'Auto-Desinstalar';
			}
		});

		actions.appendChild(locateBtn);
		actions.appendChild(uninstallBtn);
		card.appendChild(actions);
		fragment.appendChild(card);
	});
	grid.appendChild(fragment);
}

async function cargarAppsFantasma() {
	const btn = document.getElementById('ojo-btn-apps');
	const searchInput = document.getElementById('ojo-apps-search');
	if (btn) {
		btn.disabled = true;
		btn.textContent = 'Cargando...';
	}
	try {
		setOjoStatus('Listando aplicaciones instaladas...');
		const apps = await api.listarAppsInstaladas();
		ghostState.appsList = apps;
		const filtered = filterAppsList(searchInput?.value || '');
		renderAppsGrid(filtered);
		ghostState.appsLoaded = true;
		setOjoStatus(`Aplicaciones detectadas: ${apps.length}. Mostradas: ${filtered.length}.`);
		mostrarToast(`Apps detectadas: ${apps.length}`, 'system');
	} catch (error) {
		setOjoStatus('No se pudo cargar la lista de aplicaciones.');
		mostrarToast('Error cargando aplicaciones', 'error');
		logTerminal(`[Ghost] Listar apps fallo: ${error.message || error}`, 'error');
	} finally {
		if (btn) {
			btn.disabled = false;
			btn.textContent = 'Cargar Apps';
		}
	}
}

function bindGhostEvents() {
	if (ghostState.listenersBound) return;
	ghostState.listenersBound = true;

	const searchInput = document.getElementById('ojo-input');
	if (searchInput) {
		searchInput.addEventListener('input', (event) => {
			const query = event.target.value;
			if (ghostState.searchTimer) clearTimeout(ghostState.searchTimer);
			ghostState.searchTimer = setTimeout(() => ejecutarBusquedaFantasma(query), 120);
		});
	}

	const scanBtn = document.getElementById('ojo-btn-scan');
	if (scanBtn) {
		scanBtn.addEventListener('click', () => {
			ghostState.diskPathStack = ['C:\\'];
			ejecutarEscaneoFantasma('C:\\', false);
		});
	}

	const upBtn = document.getElementById('ojo-btn-disk-up');
	if (upBtn) upBtn.addEventListener('click', subirNivelDisco);

	const appsBtn = document.getElementById('ojo-btn-apps');
	if (appsBtn) appsBtn.addEventListener('click', cargarAppsFantasma);

	const appsSearch = document.getElementById('ojo-apps-search');
	if (appsSearch) {
		appsSearch.addEventListener('input', (event) => {
			const filtered = filterAppsList(event.target.value || '');
			renderAppsGrid(filtered);
			setOjoStatus(`Aplicaciones filtradas: ${filtered.length}/${ghostState.appsList.length}`);
		});
	}

	document.querySelectorAll('.ojo-tab-btn').forEach((btn) => {
		btn.addEventListener('click', () => {
			setOjoScreen(btn.getAttribute('data-ojo-screen') || 'search');
		});
	});
}

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
cargarMotoresFantasma();
bindGhostEvents();


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
	const modal = document.getElementById('settings-modal');
	if (modal) modal.classList.add('active');
}

// ==========================================
// OJO DE DIOS (Buscador Global en Memoria RAM)
// ==========================================
let ojoDatabase = [];
let ojoIndexing = false;
let ojoIndexed = false;

function abrirOjoDeDios(screen = 'search') {
    const modal = document.getElementById('modal-ojo-dios');
    if (modal) {
        modal.classList.add('active');
		cargarMotoresFantasma();
		setOjoScreen(screen);
        
        if (!ojoIndexed && !ojoIndexing) {
            ojoIndexing = true;
			setOjoStatus('Mapeando el disco hacia memoria RAM para busqueda total...');
            
            api.scanGlobalFiles((results) => {
                ojoDatabase = results;
                ojoIndexed = true;
                ojoIndexing = false;
				setOjoStatus(`Indice local listo: ${ojoDatabase.length.toLocaleString()} rutas en RAM.`);
				if (ghostState.activeScreen === 'search') {
					filtrarOjoDeDios();
				}
            }, (count) => {
                // Progress update
				setOjoStatus(`Indexando RAM: ${count.toLocaleString()} rutas...`);
            });
		} else if (ghostState.activeScreen === 'search') {
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

// ojoInput binding handled inside bindGhostEvents()


function filtrarOjoDeDios() {
    const input = document.getElementById('ojo-input');
	const ul = document.getElementById('ojo-results');
    if (!input || !ul) return;
    
    const query = input.value.trim().toLowerCase();
	ul.innerHTML = '';
	if (query.length < 2) return;
	ejecutarBusquedaFantasma(query);
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
	const modal = document.getElementById('settings-modal');
	if (modal) modal.classList.remove('active');
}
window.openSettings = openSettings;
window.closeSettings = closeSettings;

function changeTheme() {
    const theme = document.getElementById('theme-selector').value;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('nexus_theme', theme);
}
window.changeTheme = changeTheme;
window.abrirOjoDeDios = abrirOjoDeDios;
window.cerrarOjoDeDios = cerrarOjoDeDios;

function getSquarifiedLayout(items, offsetX, offsetY, width, height, currentDepth = 1, parentHue = null) {
    let result = [];
    if (items.length === 0 || width < 10 || height < 10 || currentDepth > 5) return result;
    
    let totalSize = items.reduce((sum, item) => sum + item.sizeBytes, 0);
    if (totalSize === 0) return result;
    
    let totalArea = width * height;
    let nodes = items.map(item => ({ item, area: (item.sizeBytes / totalSize) * totalArea }));
    
    let row = [];
    let bounds = { x: offsetX, y: offsetY, w: width, h: height };
    
    function worstRatio(r, w) {
        if (r.length === 0) return Infinity;
        let sumArea = r.reduce((s, node) => s + node.area, 0);
        let maxArea = Math.max(...r.map(n => n.area));
        let minArea = Math.min(...r.map(n => n.area));
        let w2 = w * w;
        let sum2 = sumArea * sumArea;
        return Math.max((w2 * maxArea) / sum2, sum2 / (w2 * minArea));
    }
    
    function layoutRow(r, shortestSide, b) {
        let sumArea = r.reduce((s, node) => s + node.area, 0);
        if (b.w <= 0 || b.h <= 0) return;

        let rowWidth = b.w >= b.h ? sumArea / b.h : b.w;
        let rowHeight = b.w >= b.h ? b.h : sumArea / b.w;
        
        let currentX = b.x;
        let currentY = b.y;
        
        r.forEach((node, nodeIdx) => {
            let nodeW, nodeH;
            if (b.w >= b.h) {
                nodeH = rowWidth > 0 ? node.area / rowWidth : 0;
                nodeW = rowWidth;
            } else {
                nodeW = rowHeight > 0 ? node.area / rowHeight : 0;
                nodeH = rowHeight;
            }
            
            const isParent = node.item.children && node.item.children.length > 0 && nodeW > 15 && nodeH > 15;
            const rootHues = [20, 200, 120, 280, 45, 170, 310, 80, 230, 350, 100, 250];
            let myHue = currentDepth === 1 ? rootHues[nodeIdx % rootHues.length] : parentHue;
            
            result.push({ item: node.item, x: currentX, y: currentY, w: nodeW, h: nodeH, depth: currentDepth, hue: myHue, isParent });
            
            if (isParent) {
                // AÑADIDO: Padding para crear el marco visual y que los hijos no pisen el borde
                let header = (currentDepth <= 4 && nodeH > 35) ? 18 : 2; 
                let padX = 2;
                let padBottom = 2;

                if (nodeW > padX * 2 && nodeH > header + padBottom) {
                    let childBoxes = getSquarifiedLayout(
                        node.item.children, 
                        currentX + padX, 
                        currentY + header, 
                        nodeW - (padX * 2), 
                        nodeH - header - padBottom, 
                        currentDepth + 1,
                        myHue
                    );
                    result = result.concat(childBoxes);
                }
            }
            
            if (b.w >= b.h) {
                currentY += nodeH;
            } else {
                currentX += nodeW;
            }
        });
        
        if (b.w >= b.h) {
            b.x += rowWidth;
            b.w = Math.max(0, b.w - rowWidth);
        } else {
            b.y += rowHeight;
            b.h = Math.max(0, b.h - rowHeight);
        }
    }
    
    for (let i = 0; i < nodes.length; i++) {
        let node = nodes[i];
        let shortestSide = Math.max(1, Math.min(bounds.w, bounds.h));
        
        if (row.length === 0) {
            row.push(node);
        } else {
            let currentWorst = worstRatio(row, shortestSide);
            let nextWorst = worstRatio([...row, node], shortestSide);
            
            if (nextWorst <= currentWorst) {
                row.push(node);
            } else {
                layoutRow(row, shortestSide, bounds);
                row = [node];
            }
        }
    }
    if (row.length > 0) {
        layoutRow(row, Math.max(1, Math.min(bounds.w, bounds.h)), bounds);
    }
    
    return result;
}

// Init Theme on Load
const savedTheme = localStorage.getItem('nexus_theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
if(document.getElementById('theme-selector')) {
    document.getElementById('theme-selector').value = savedTheme;
}
