import { ghostState, autopilotTasks, runningFiles, silentRuns, isFirstLoad, setIsFirstLoad, autostartList, favoritesList, updateFavorites, updateAutostart } from '../core/state.js';
import { obtenerInfoArchivo, safeId } from '../core/utils.js';
import { logTerminal } from '../ui/terminalSystem.js';
import { mostrarToast } from '../ui/toastSystem.js';

let selectedIndex = -1;
let currentFilter = 'all';
let runModePolicy = {};
let scriptModeOverrides = {};

export function setRunModePolicy(policy = {}) {
	runModePolicy = policy && typeof policy === 'object' ? { ...policy } : {};
}

function resolveRunMode(fileName, selectedMode) {
	// Prioridad 1: Override manual del usuario en esta sesión (Tus clics en el botón)
	if (scriptModeOverrides[fileName]) return scriptModeOverrides[fileName];
	// Prioridad 2: Política del sistema predefinida
	if (runModePolicy[fileName]) return runModePolicy[fileName];
	// Prioridad 3: Modo seleccionado en el selector global
	return selectedMode;
}

function modeLabel(mode) {
	return mode === 'external' ? 'Visual externo' : 'Integrado';
}

function parseMetaLine(linea = '') {
	const raw = String(linea || '').trim();
	if (!raw) return null;

	const clean = raw.replace(/^\s*(#|::|\/\/)+\s*/, '');
	const sep = clean.indexOf(':');
	if (sep <= 0) return null;

	const key = clean.slice(0, sep).trim().toUpperCase();
	const value = clean.slice(sep + 1).trim();
	if (!key || !value) return null;

	return { key, value };
}

function normalizeMode(value = '') {
	const mode = String(value || '').trim().toLowerCase();
	if (mode === 'internal' || mode === 'integrado') return 'internal';
	if (mode === 'external' || mode === 'visual externo') return 'external';
	return '';
}

function extractScriptMeta(lines = []) {
	const meta = {
		desc: "Añade 'DESC: tu descripción' dentro del código para que aparezca aquí.",
		args: 'Ninguno / Desconocido',
		risk: 'normal',
		perm: 'user',
		mode: ''
	};

	for (const linea of lines) {
		const parsed = parseMetaLine(linea);
		if (!parsed) continue;

		switch (parsed.key) {
			case 'DESC':
				meta.desc = parsed.value;
				break;
			case 'ARGS':
				meta.args = parsed.value;
				break;
			case 'RISK': {
				const riskValue = parsed.value.toLowerCase();
				meta.risk = ['normal', 'low', 'medium', 'high', 'critical'].includes(riskValue) ? riskValue : 'normal';
				break;
			}
			case 'PERM': {
				const permValue = parsed.value.toLowerCase();
				meta.perm = ['user', 'admin'].includes(permValue) ? permValue : 'user';
				break;
			}
			case 'MODE':
			case 'MODO':
				meta.mode = normalizeMode(parsed.value);
				break;
			default:
				break;
		}
	}

	return meta;
}

async function preloadScriptMetadata(files = []) {
	const metadataByFile = new Map();
	if (!Array.isArray(files) || files.length === 0) return metadataByFile;

	if (!window.api || typeof window.api.readScriptMeta !== 'function') {
		for (const file of files) {
			metadataByFile.set(file, extractScriptMeta([]));
		}
		return metadataByFile;
	}

	const batchSize = 24;
	for (let i = 0; i < files.length; i += batchSize) {
		const batch = files.slice(i, i + batchSize);
		const entries = await Promise.all(batch.map(async (file) => {
			try {
				const lineas = await window.api.readScriptMeta(file);
				return [file, extractScriptMeta(lineas)];
			} catch (err) {
				console.error('No se pudo leer el archivo:', file, err);
				return [file, extractScriptMeta([])];
			}
		}));

		for (const [file, meta] of entries) {
			metadataByFile.set(file, meta);
			if (meta.mode && !scriptModeOverrides[file]) {
				scriptModeOverrides[file] = meta.mode;
			}
		}
	}

	return metadataByFile;
}

// === 1-CLICK MODES ======
export async function ejecutar1ClickMode(mode) {
	const modes = {
		gaming: [
			'04_Utilidades_Archivos/Purgar_ram.py',
			'02_Optimizacion_Gaming/Despertar_Nucleos.bat',
			'06_Personalizacion/Lanzador_Cloud_Gaming.bat'
		],
		paranoia: [
			'03_Privacidad_Seguridad/Identidad_Falsa.py',
			'03_Privacidad_Seguridad/Cazador_Intrusos.py',
			'03_Privacidad_Seguridad/Asesino_Zombies.bat'
		],
		mantenimiento: [
			'01_Mantenimiento_Windows/Desinstalador_Telemetria.bat',
			'04_Utilidades_Archivos/Limpieza_Extrema_Global.py',
			'01_Mantenimiento_Windows/Actualizar_Aplicaciones.py'
		]
	};

	const ruteo = modes[mode];
	if(!ruteo) return;

	mostrarToast(`Iniciando Perfil 1-Clic: ${mode.toUpperCase()}`, 'system');
	
	for(const script of ruteo) {
		// Buscamos si existe en el cache de runningFiles o autopilot, si no lo lanzamos silencioso si se desea.
		ejecutar(script, false, true); 
	}
}

function createMetaBadge(label, variant = 'default') {
	const badge = document.createElement('span');
	badge.className = `meta-badge ${variant}`;
	badge.textContent = label;
	return badge;
}

export function openScript(fileName) {
	if (window.api && window.api.editScript) window.api.editScript(fileName);
}

export function toggleFavorite(fileName) {
    let newFavs = [...favoritesList];
	if (newFavs.includes(fileName)) {
		newFavs = newFavs.filter((f) => f !== fileName);
		mostrarToast('Habilidad desanclada de Favoritos', 'system');
	} else {
		newFavs.push(fileName);
		mostrarToast('Habilidad anclada en Favoritos', 'success');
	}
	updateFavorites(newFavs);
	cargarScripts().catch((error) => console.error('[HorusEngine] Error recargando scripts:', error));
}

export function toggleScriptMode(fileName) {
	const globalModeSelect = document.getElementById('global-terminal-mode');
	const defaultMode = globalModeSelect ? globalModeSelect.value : 'internal';
	
	// Obtenemos el estado ACTUAL real
	const current = resolveRunMode(fileName, defaultMode);
	// Invertimos el estado
	const next = current === 'internal' ? 'external' : 'internal';
	
	scriptModeOverrides[fileName] = next;
	cargarScripts().catch((error) => console.error('[HorusEngine] Error recargando scripts:', error));
}

export function toggleAutoStart(fileName) {
    let newAuto = [...autostartList];
	if (newAuto.includes(fileName)) {
		newAuto = newAuto.filter((f) => f !== fileName);
	} else {
		newAuto.push(fileName);
	}
	updateAutostart(newAuto);
}

export async function cargarScripts() {
	const loadStart = performance.now();
	console.info('[Startup] cargarScripts start');
	const list = document.getElementById('script-list');
    if (!list) return;
	list.innerHTML = '';
	scriptModeOverrides = { ...scriptModeOverrides };

	let files = [];
	try {
        if (window.api) files = await window.api.listScripts();
		console.info(`[Startup] listScripts returned ${files.length} entries`);
	} catch (err) {
		logTerminal(`[Error] No se pudo leer mis_scripts: ${err}`, 'error');
		return;
	}

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

	validFiles.sort((a, b) => a.localeCompare(b));
	const fragment = document.createDocumentFragment();
	let pendingAutostarts = [];
	let globalIndex = 0;
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
	const metaStart = performance.now();
	const metadataByFile = await preloadScriptMetadata(validFiles);
	console.info(`[Startup] preloadScriptMetadata done in ${Math.round(performance.now() - metaStart)}ms`);

	for (const folder of sortedFolders) {
		const header = document.createElement('li');
		header.className = 'category-header';
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
			const meta = metadataByFile.get(file) || extractScriptMeta([]);

			if (isFirstLoad && isAutostart) {
				pendingAutostarts.push(file);
			}

			const key = safeId(file);
			const li = document.createElement('li');
			li.className = 'script-item';
			li.setAttribute('data-name', file);
			li.setAttribute('data-type', info.name);
            // Efecto de entrada en cascada
            li.style.animationDelay = `${Math.min(globalIndex * 0.03, 1)}s`;
            globalIndex++;

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
			divDesc.title = meta.desc;
			divDesc.textContent = meta.desc;

			const divArgs = document.createElement('div');
			divArgs.className = 'script-args-info';
			divArgs.title = meta.args;
			divArgs.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="vertical-align: middle; margin-right: 4px; position:relative; top:-1px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`;
			const strong = document.createElement('strong');
			strong.textContent = 'Parámetros:';
			divArgs.appendChild(strong);
			divArgs.appendChild(document.createTextNode(' ' + meta.args));

			const badgesRow = document.createElement('div');
			badgesRow.className = 'script-meta-badges';
			if (meta.risk !== 'normal') {
				badgesRow.appendChild(createMetaBadge(`Riesgo ${meta.risk.toUpperCase()}`, `risk-${meta.risk}`));
			}
			if (meta.perm === 'admin') {
				badgesRow.appendChild(createMetaBadge('Admin', 'perm-admin'));
			}
			if (meta.mode) {
				badgesRow.appendChild(createMetaBadge(`Modo ${modeLabel(meta.mode)}`, `mode-${meta.mode}`));
			}

			const modeHint = document.createElement('div');
			modeHint.className = 'script-mode-hint';
			const globalModeSelect = document.getElementById('global-terminal-mode');
			const defaultMode = globalModeSelect ? globalModeSelect.value : 'internal';
			const preferredMode = meta.mode || resolveRunMode(file, defaultMode);
			const modeColor = preferredMode === 'external' ? '#FF9F0A' : '#30D158';
			modeHint.style.color = modeColor;
			modeHint.textContent = meta.mode
				? `Prioridad Script: ${modeLabel(preferredMode)}`
				: `Modo Activo: ${modeLabel(preferredMode)}`;

			const divInfoContainer = document.createElement('div');
			divInfoContainer.className = 'script-info-container';

			divInfoContainer.appendChild(divDesc);
			divInfoContainer.appendChild(divArgs);
			if (badgesRow.childElementCount > 0) {
				divInfoContainer.appendChild(badgesRow);
			}
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

			// Toggle de Modo de Terminal (Minimalista)
			const currentMode = scriptModeOverrides[file] || (meta.mode ? meta.mode : 'default');
			const isExternal = currentMode === 'external';
			
			const modeToggle = document.createElement('div');
			modeToggle.className = `mode-toggle-wrap ${isExternal ? 'active' : ''}`;
			modeToggle.title = "Alternar Terminal (Integrado vs Windows)";
			modeToggle.onclick = (e) => {
				e.stopPropagation();
				toggleScriptMode(file);
			};
			modeToggle.innerHTML = `
				<svg class="mode-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
					<polyline points="4 17 10 11 4 5"></polyline>
					<line x1="12" y1="19" x2="20" y2="19"></line>
				</svg>
				<span class="mode-text-hint">${isExternal ? 'Win' : 'Int'}</span>
			`;

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
			autostartRow.appendChild(modeToggle);
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
			btnAuto.onclick = () => window.toggleAutopilot(file);
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

    setIsFirstLoad(false);
	aplicarFiltros();
	updateSidebarCounts(validFiles);

	const splash = document.getElementById('splash-screen');
	if (splash) {
		splash.classList.add('hidden');
		setTimeout(() => splash.remove(), 1000);
	}
	console.info(`[Startup] cargarScripts done in ${Math.round(performance.now() - loadStart)}ms`);
}

// UX: Badge de conteo en sidebar
function updateSidebarCounts(files) {
	const total = files.length;
	const pyCount = files.filter(f => f.toLowerCase().endsWith('.py')).length;
	const batCount = files.filter(f => f.toLowerCase().endsWith('.bat') || f.toLowerCase().endsWith('.cmd')).length;
	const activeCount = runningFiles.size;

	const badges = [
		{ filter: 'all', count: total },
		{ filter: 'py', count: pyCount },
		{ filter: 'bat', count: batCount },
		{ filter: 'active', count: activeCount }
	];

	badges.forEach(({ filter, count }) => {
		const btn = document.querySelector(`.tab-btn[data-filter="${filter}"]`);
		if (!btn) return;
		let badge = btn.querySelector('.sidebar-count');
		if (!badge) {
			badge = document.createElement('span');
			badge.className = 'sidebar-count';
			btn.appendChild(badge);
		}
		badge.textContent = count;
		badge.style.cssText = 'margin-left:auto; background:rgba(255,255,255,0.1); padding:2px 8px; border-radius:999px; font-size:11px; color:var(--mac-text-muted); font-weight:600;';
		if (filter === 'active' && count > 0) {
			badge.style.background = 'rgba(48, 209, 88, 0.2)';
			badge.style.color = 'var(--mac-green)';
		}
	});
}

export function alternarBotones(fileName, ejecutando) {
	if (autopilotTasks[fileName]) return;
	const key = safeId(fileName);
	const bRun = document.getElementById(`btn-run-${key}`);
	const bStop = document.getElementById(`btn-stop-${key}`);
	if (bRun && bStop) {
		bRun.style.display = ejecutando ? 'none' : 'flex';
		bStop.style.display = ejecutando ? 'flex' : 'none';
	}
	// UX: Animación de pulse para cards en ejecución
	const card = document.querySelector(`.script-item[data-name="${fileName}"]`);
	if (card) {
		if (ejecutando) {
			card.classList.add('is-running');
		} else {
			card.classList.remove('is-running');
		}
	}
}

export async function matarProceso(fileName) {
	if (window.api) {
        // AÑADIDO AWAIT AQUI
        const res = await window.api.stopScript(fileName);
        if (res && res.stopped) {
		    logTerminal(`[!] Operación abortada: ${fileName}`, 'error');
		    alternarBotones(fileName, false);
            runningFiles.delete(fileName); // Limpiamos la caché visual
        }
	}
}

export async function ejecutar(fileName, isAuto = false, isSilent = false) {
    const argsInput = document.getElementById('script-args');
	const args = argsInput ? argsInput.value.trim() : '';
	const globalModeSelect = document.getElementById('global-terminal-mode');
	const defaultMode = globalModeSelect ? globalModeSelect.value : 'internal';
	const modeToUse = resolveRunMode(fileName, defaultMode);
	const isExternal = modeToUse === 'external';

	if (!isSilent) {
		logTerminal(`\n▶ Ejecutando: ${fileName} ${args}`, 'command');
		logTerminal(`[MODO] ${modeLabel(modeToUse)}`, 'system');
	}

	if (isExternal) {
        if (!window.api) return;
        // AÑADIDO AWAIT AQUI
		const result = await window.api.runScript({ fileName, args, mode: modeToUse });
		if (!isSilent) {
			if (result && result.forcedExternal) {
				mostrarToast('Herramienta Pro ejecutada en modo visual', 'system');
			}
			mostrarToast(`Lanzado: ${fileName.split('/').pop()}`, 'success');
		}
		return;
	}
    
	if (window.api) {
        // AÑADIDO AWAIT AQUI
        const isAlreadyRunning = await window.api.isRunning(fileName);
        if (isAlreadyRunning) {
		    if (!isSilent) logTerminal(`[!] Ya está en ejecución: ${fileName}`, 'error');
		    return;
        }
	}

	if (isSilent) silentRuns.add(fileName);
	alternarBotones(fileName, true);
	runningFiles.add(fileName);
	if (currentFilter === 'active') aplicarFiltros();
    
    if (window.api) {
        // AÑADIDO AWAIT AQUI
	    const result = await window.api.runScript({ fileName, args, mode: modeToUse });
	    if (!result || result.pid === null) {
		    runningFiles.delete(fileName);
		    alternarBotones(fileName, false);
		    if (!isSilent) {
			    logTerminal(`[SYS] No se pudo iniciar: ${fileName}`, 'error');
			    mostrarToast(`Error al iniciar ${fileName.split('/').pop()}`, 'error');
		    }
	    }
    }
}

export function aplicarFiltros() {
	selectedIndex = -1;
    const searchInput = document.getElementById('search-input');
	const term = searchInput ? searchInput.value.toLowerCase() : '';
	const terms = term.split(' ').filter(Boolean);
	let found = false;

	document.querySelectorAll('.script-item').forEach((item) => {
		item.style.boxShadow = ''; 
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
			item.style.display = '';
			found = true;
		} else {
			item.classList.add('hidden');
			setTimeout(() => {
				if (item.classList.contains('hidden')) item.style.display = 'none';
			}, 300); 
		}
	});

	let noResults = document.getElementById('no-results');
	if (!found) {
		if (!noResults) {
			noResults = document.createElement('div');
			noResults.id = 'no-results';
			noResults.style.cssText = 'color:#888; padding:60px 20px; text-align:center; grid-column:1/-1;';
			noResults.innerHTML = `
				<div style="font-size:48px; margin-bottom:15px; opacity:0.4; animation: pulse 2s ease-in-out infinite;">🔍</div>
				<h3 style="font-weight:600; margin-bottom:8px; color:var(--mac-text-muted);">Sin resultados</h3>
				<p style="opacity:0.5; font-size:13px;">Prueba ajustando los filtros o el texto de búsqueda.</p>
			`;
			const list = document.getElementById('script-list');
            if(list) list.appendChild(noResults);
		}
		if (noResults) noResults.style.display = 'block';
	} else if (noResults) {
		noResults.style.display = 'none';
	}
}

export function setupTabs() {
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
}
