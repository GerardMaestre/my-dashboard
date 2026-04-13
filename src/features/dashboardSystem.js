import { ghostState, autopilotTasks, runningFiles, silentRuns, isFirstLoad, setIsFirstLoad, autostartList, favoritesList, updateFavorites, updateAutostart, proModePolicy } from '../core/state.js';
import { obtenerInfoArchivo, safeId, getElementId } from '../core/utils.js';
import { logTerminal } from '../ui/terminalSystem.js';
import { mostrarToast } from '../ui/toastSystem.js';

let selectedIndex = -1;
let currentFilter = 'all';

function resolveRunMode(fileName, selectedMode) {
	return proModePolicy[fileName] || selectedMode;
}

function modeLabel(mode) {
	return mode === 'external' ? 'Visual externo' : 'Integrado';
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
	cargarScripts(); // Re-render for sorting
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
	const list = document.getElementById('script-list');
    if (!list) return;
	list.innerHTML = '';

	let files = [];
	try {
        if (window.api) files = await window.api.listScripts();
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

			let desc = "Añade 'DESC: tu descripción' dentro del código para que aparezca aquí.";
			let args = 'Ninguno / Desconocido';

			if (window.api) {
			    try {
				    const lineas = await window.api.readScriptMeta(file);
				    for (const linea of lineas) {
					    if (linea.includes('DESC:')) desc = linea.split('DESC:')[1].trim();
					    if (linea.includes('ARGS:')) args = linea.split('ARGS:')[1].trim();
				    }
			    } catch (err) {
				    console.error('No se pudo leer el archivo: ', file, err);
			    }
            }

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
			divDesc.title = desc;
			divDesc.textContent = desc;
			divDesc.style.flex = 'none';
			divDesc.style.padding = '0';

			const divArgs = document.createElement('div');
			divArgs.className = 'script-args-info';
			divArgs.title = args;
			divArgs.style.fontSize = '11px';
			divArgs.style.color = '#0A84FF';
			divArgs.style.marginTop = '4px';
			divArgs.style.whiteSpace = 'nowrap';
			divArgs.style.overflow = 'hidden';
			divArgs.style.textOverflow = 'ellipsis';
			divArgs.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="vertical-align: middle; margin-right: 4px; position:relative; top:-1px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`;
			const strong = document.createElement('strong');
			strong.textContent = 'Parámetros:';
			divArgs.appendChild(strong);
			divArgs.appendChild(document.createTextNode(' ' + args));

			const modeHint = document.createElement('div');
            const runModeSelect = document.getElementById('run-mode');
			const preferredMode = proModePolicy[file] || (runModeSelect ? runModeSelect.value : 'internal');
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

export function matarProceso(fileName) {
	if (window.api && window.api.stopScript(fileName)) {
		logTerminal(`[!] Operación abortada: ${fileName}`, 'error');
		alternarBotones(fileName, false);
	}
}

export function ejecutar(fileName, isAuto = false, isSilent = false) {
    const argsInput = document.getElementById('script-args');
	const args = argsInput ? argsInput.value.trim() : '';
    const modeSelect = document.getElementById('run-mode');
	const selectedMode = modeSelect ? modeSelect.value : 'internal';
	const modeToUse = resolveRunMode(fileName, selectedMode);
	const isExternal = modeToUse === 'external';

	if (!isSilent) {
		logTerminal(`\n▶ Ejecutando: ${fileName} ${args}`, 'command');
		logTerminal(`[MODO] ${modeLabel(modeToUse)}`, 'system');
	}

	if (isExternal) {
        if (!window.api) return;
		const result = window.api.runScript({ fileName, args, mode: modeToUse });
		if (!isSilent) {
			if (result && result.forcedExternal) {
				mostrarToast('Herramienta Pro ejecutada en modo visual externo', 'system');
			}
			mostrarToast(`Lanzado en modo visual: ${fileName.split('/').pop()}`, 'success');
		}
		return;
	}
	if (window.api && window.api.isRunning(fileName)) {
		if (!isSilent) logTerminal(`[!] Ya está en ejecución: ${fileName}`, 'error');
		return;
	}

	if (isSilent) silentRuns.add(fileName);
	alternarBotones(fileName, true);
	runningFiles.add(fileName);
	if (currentFilter === 'active') aplicarFiltros();
    
    if (window.api) {
	    const result = window.api.runScript({ fileName, args, mode: modeToUse });
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
