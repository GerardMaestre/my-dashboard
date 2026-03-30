import { ghostState, setOjoState, ojoDatabase, ojoIndexing, ojoIndexed } from '../core/state.js';
import { safeText, formatBytes, getFileIconFromPath, getAppIconMarkup, loadRealAppIcon, escapeRegExp, highlightText } from '../core/utils.js';
import { logTerminal } from '../ui/terminalSystem.js';
import { mostrarToast } from '../ui/toastSystem.js';

let treemapComputeWorker = null;
function getTreemapWorker() {
	if (!treemapComputeWorker) treemapComputeWorker = new Worker("./workers/treemapWorker.js");
	return treemapComputeWorker;
}

export function setOjoStatus(message) {
	const status = document.getElementById('ojo-status');
	if (status) status.textContent = message;
}

export function setOjoScreen(screen) {
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

export async function cargarMotoresFantasma() {
	const statusEl = document.getElementById('ojo-status');
	if (!statusEl) return;
	try {
		ghostState.engines = await window.api.getGhostEngineStatus();
		const modeEverything = ghostState.engines.everythingAvailable ? 'Everything' : 'Fallback nativo';
		const modeWiz = ghostState.engines.wiztreeAvailable ? 'WizTree' : 'Fallback nativo';
		const modeGeek = ghostState.engines.geekAvailable ? 'Geek' : 'Registro + PowerShell';
		statusEl.textContent = `Motores activos -> Search: ${modeEverything} | Disco: ${modeWiz} | Apps: ${modeGeek}`;
	} catch (error) {
		statusEl.textContent = 'Motores fallback nativo activo';
		logTerminal(`[Ghost] Error obteniendo estado de motores: ${error.message || error}`, 'error');
	}
}

export function abrirOjoDeDios(screen = 'search') {
	const modal = document.getElementById('modal-ojo-dios');
	if (modal) {
		modal.classList.add('active');
		cargarMotoresFantasma();
		setOjoScreen(screen);

		if (!ojoIndexed && !ojoIndexing) {
			setOjoState({ ojoIndexing: true });
			setOjoStatus('Mapeando el disco hacia memoria RAM para busqueda total...');

			if(window.api) {
			    window.api.scanGlobalFiles((results) => {
				    setOjoState({ ojoDatabase: results, ojoIndexed: true, ojoIndexing: false });
				    setOjoStatus(`Indice local listo: ${results.length.toLocaleString()} rutas en RAM.`);
				    if (ghostState.activeScreen === 'search') {
					    filtrarOjoDeDios();
				    }
			    }, (count) => {
				    setOjoStatus(`Indexando RAM: ${count.toLocaleString()} rutas...`);
			    });
            }
		} else if (ghostState.activeScreen === 'search') {
			filtrarOjoDeDios();
		}
	}
}

export function cerrarOjoDeDios() {
	const modal = document.getElementById('modal-ojo-dios');
	if (modal) modal.classList.remove('active');
}

export function renderResultadosBusqueda(items) {
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
					window.api.openGlobalPath(item.installLocation);
				} else {
					mostrarToast('App detectada sin ruta local disponible', 'system');
				}
				return;
			}
			if(window.api) window.api.showGlobalItemInFolder(item.fullPath);
		});
		fragment.appendChild(row);
	});
	container.appendChild(fragment);
}

export async function ejecutarBusquedaFantasma(query) {
	const q = String(query || '').trim();
	ghostState.lastQuery = q;
	const runSeq = ++ghostState.searchSeq;
	if (q.length < 2) {
		setOjoStatus('Escribe al menos 2 caracteres para buscar.');
		renderResultadosBusqueda([]);
		return;
	}

	try {
        if(!window.api) return;
		const qLower = q.toLowerCase();
		const isExeSearch = qLower === '.exe' || qLower === 'exe' || qLower.endsWith('.exe');
		const shouldSearchApps = isExeSearch || qLower.includes('app') || qLower.includes('program');
		const useBackend = ghostState.engines.everythingAvailable || !ojoIndexed;
		setOjoStatus(useBackend ? 'Buscando en indice RAM + motor rapido...' : 'Buscando en indice RAM...');

		const backendPromise = useBackend ? window.api.buscarArchivo(q, 12000) : Promise.resolve([]);
		const appsPromise = shouldSearchApps
			? (ghostState.searchAppsCache ? Promise.resolve(ghostState.searchAppsCache) : window.api.listarAppsInstaladas())
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

export function filtrarOjoDeDios() {
	const input = document.getElementById('ojo-input');
	const ul = document.getElementById('ojo-results');
	if (!input || !ul) return;

	const query = input.value.trim().toLowerCase();
	ul.innerHTML = '';
	if (query.length < 2) return;
	ejecutarBusquedaFantasma(query);
}

// ======================== DISK LOGIC ========================

export function navegarDiscoAIndice(idx) {
	if (idx < 0 || idx >= ghostState.diskPathStack.length) return;
	ghostState.diskPathStack = ghostState.diskPathStack.slice(0, idx + 1);
	const target = ghostState.diskPathStack[idx] || 'C:\\';
	ejecutarEscaneoFantasma(target, false);
}

export function subirNivelDisco() {
	if (ghostState.diskPathStack.length <= 1) return;
	ghostState.diskPathStack.pop();
	const target = ghostState.diskPathStack[ghostState.diskPathStack.length - 1] || 'C:\\';
	ejecutarEscaneoFantasma(target, false);
}

export async function ejecutarEscaneoFantasma(rootPath = null, pushStack = false) {
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
	let loadingBarProgress = null;

	if (btn) {
		btn.disabled = true;
		btn.textContent = 'Calculando...';
	}
	if (loadingEl) loadingEl.style.display = 'flex';
	if (contentEl) contentEl.style.display = 'none';

	try {
		if(!window.api) return;
		setOjoStatus(`Escaneando ${targetRoot}...`);
		
		// Conexión con la nueva barra HTML
		loadingBarProgress = document.getElementById('ojo-disk-progress-fill');
		const loadingText = document.getElementById('ojo-disk-loading-text');
		let progressValue = 0;

		if (loadingBarProgress) {
			loadingBarProgress.style.width = '0%';
		}

		if (loadingText) {
			loadingText.innerText = 'Iniciando escaneo de disco... 0%';
		}

		const payload = await window.api.escanearDisco(targetRoot, (progress) => {
			const phase = String(progress && progress.phase ? progress.phase : 'scan');
			const raw = Math.max(0, Math.min(100, Number(progress && progress.percent ? progress.percent : 0)));
			progressValue = Math.max(progressValue, raw);

			if (loadingBarProgress) {
				loadingBarProgress.style.width = `${progressValue.toFixed(1)}%`;
			}

			if (loadingText) {
				const txt = phase === 'cached'
					? 'Usando cache del escaneo...'
					: (phase === 'parsing'
						? 'Leyendo y parseando archivos...'
						: (phase === 'finalize' ? 'Finalizando mapa de disco...' : 'Analizando estructura del disco...'));
				loadingText.innerText = `${txt} ${Math.round(progressValue)}%`;
			}
		});
		
		if (scanSeq !== ghostState.diskScanSeq) return;

		progressValue = 100;
		if (loadingBarProgress) {
			loadingBarProgress.style.width = `${progressValue}%`;
		}

		// PAUSA VISUAL: Obligamos a la interfaz a esperar casi medio segundo 
		// para que te dé tiempo a ver cómo la barra llega al final suavemente
		await new Promise(resolve => setTimeout(resolve, 400));

		// Ocultar barra y mostrar resultados
// Ocultar barra y preparar el contenedor visual
		if (loadingEl) loadingEl.style.display = 'none';
		if (contentEl) contentEl.style.display = 'flex';

		// CRÍTICO: Le damos 50ms al navegador para que asimile el "display: flex" 
		// y sepa exactamente cuántos píxeles de ancho y alto tiene la pantalla
		// antes de ponerse a calcular el tamaño de los cuadrados del mapa.
		setTimeout(() => {
			renderEscaneoDisco(payload);
			ghostState.diskScanned = true;
			setOjoStatus(`Mapa listo para ${targetRoot} (${(payload?.engine || 'native').toUpperCase()}).`);
		}, 50);
	} catch (err) {
		console.error(err);
		// Si hay un error, ocultar la carga para que no se quede bloqueado
		if (loadingEl) loadingEl.style.display = 'none';
		if (contentEl) contentEl.style.display = 'flex';
	} finally {
		if (btn) {
			btn.disabled = false;
			btn.textContent = 'Raiz C:';
		}
	}
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
        treemap.innerHTML = ''; 
        treemap.style.display = 'block'; 
        treemap.style.position = 'relative';

        const rect = treemap.getBoundingClientRect();
        const boxW = Math.max(rect.width, 600); 
        const boxH = Math.max(rect.height, 300);
        
        let mapItems = items.filter(i => Number(i.sizeBytes) > 0).sort((a, b) => Number(b.sizeBytes) - Number(a.sizeBytes)).slice(0, 250);
		// Asignamos un ID asegurado para que el worker devuelva referencias cruzadas perfectas
        mapItems.forEach((item, idx) => { if (!item.id) item.id = `disk-item-${idx}`; });
        const rootItemById = new Map(mapItems.map((item) => [String(item.id), item]));
        
        const rootContainer = document.createElement('div');
        rootContainer.className = 'wiz-container'; 
        
        rootContainer.style.position = 'absolute';
        rootContainer.style.top = '0px';
        rootContainer.style.left = '0px';
        rootContainer.style.width = `${boxW}px`;
        rootContainer.style.height = `${boxH}px`;
        
        if (mapItems.length === 0) {
            rootContainer.innerHTML = '<div style="color:red; padding: 20px;">Error: No hay items válidos para dibujar el Treemap.</div>';
        } else {
            const worker = getTreemapWorker();
			worker.onmessage = (e) => {
				const data = e.data || {};
				if (data.id !== 'main') return;
				if (data.error) {
					rootContainer.innerHTML = `<div style="color:#ff7676; padding: 20px;">Treemap worker fallo: ${safeText(data.error)}</div>`;
					return;
				}

				const rects = Array.isArray(data.rects) ? data.rects : [];
				if (!rects.length) {
					rootContainer.innerHTML = '<div style="color:#999; padding: 20px;">No hay datos suficientes para dibujar el Treemap.</div>';
					return;
				}

				const normalizedRects = rects.map((r) => {
					const node = r && r.node ? r.node : null;
					const nodeId = String(node && node.id ? node.id : '');
					const sourceItem = rootItemById.get(nodeId) || (node && node.sourceItem) || node;
					return {
						item: sourceItem,
						xPx: Number(r && Number.isFinite(Number(r.xPx)) ? r.xPx : (r && r.x) || 0),
						yPx: Number(r && Number.isFinite(Number(r.yPx)) ? r.yPx : (r && r.y) || 0),
						wPx: Number(r && Number.isFinite(Number(r.wPx)) ? r.wPx : (r && r.w) || 0),
						hPx: Number(r && Number.isFinite(Number(r.hPx)) ? r.hPx : (r && r.h) || 0)
					};
				});

				buildTreemapDOM(normalizedRects, rootContainer, boxW, boxH, 1, null, true);
			};
			worker.postMessage({ id: 'main', items: mapItems, width: boxW, height: boxH });
        }
        
        treemap.appendChild(rootContainer);
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

function squarifyLevel(items, width, height) {
    let result = [];
    let totalValue = items.reduce((sum, item) => sum + Math.max(0, Number(item.sizeBytes) || 0), 0);
    if (totalValue === 0 || width <= 0 || height <= 0) return result;

    let scale = (width * height) / totalValue;
    let safeNodes = items.map(item => ({ item, area: Math.max(0, Number(item.sizeBytes)) * scale })).filter(n => n.area > 0);
    safeNodes.sort((a, b) => b.area - a.area);

    let rect = { x: 0, y: 0, w: width, h: height };
    let row = [];

    function worstRatio(row, w) {
        if (row.length === 0) return Infinity;
        let sum = 0, max = 0, min = Infinity;
        for (let i = 0; i < row.length; i++) {
            let a = row[i].area;
            sum += a;
            if (a > max) max = a;
            if (a < min) min = a;
        }
        return Math.max((w * w * max) / (sum * sum), (sum * sum) / (w * w * min));
    }

    function layoutRow(row, isHorizontal) {
        let rowArea = row.reduce((sum, n) => sum + n.area, 0);
        if (rowArea === 0) return;
        if (isHorizontal) {
            let rowHeight = rowArea / rect.w;
            let currentX = rect.x;
            for (let i = 0; i < row.length; i++) {
                let nodeW = row[i].area / rowHeight;
                result.push({ item: row[i].item, xPx: currentX, yPx: rect.y, wPx: nodeW, hPx: rowHeight });
                currentX += nodeW;
            }
            rect.y += rowHeight;
            rect.h -= rowHeight;
        } else {
            let rowWidth = rowArea / rect.h;
            let currentY = rect.y;
            for (let i = 0; i < row.length; i++) {
                let nodeH = row[i].area / rowWidth;
                result.push({ item: row[i].item, xPx: rect.x, yPx: currentY, wPx: rowWidth, hPx: nodeH });
                currentY += nodeH;
            }
            rect.x += rowWidth;
            rect.w -= rowWidth;
        }
    }

    for (let i = 0; i < safeNodes.length; i++) {
        let node = safeNodes[i];
        let isHorizontal = rect.w >= rect.h;
        let side = isHorizontal ? rect.w : rect.h;

        if (row.length === 0) {
            row.push(node);
            continue;
        }

        let worstWith = worstRatio([...row, node], side);
        let worstWithout = worstRatio(row, side);

        if (worstWith <= worstWithout) {
            row.push(node);
        } else {
            layoutRow(row, isHorizontal);
            row = [node];
        }
    }
    
    if (row.length > 0) {
        layoutRow(row, rect.w >= rect.h);
    }

    return result.filter(r => r.wPx > 0.5 && r.hPx > 0.5);
}

function buildTreemapDOM(itemsOrRects, container, widthPx, heightPx, depth = 1, parentHue = null, isPrecalcCoords = false) {
    if (depth > 6 || widthPx < 3 || heightPx < 3 || !itemsOrRects || itemsOrRects.length === 0) return; 

    let layout;
	if (isPrecalcCoords) {
		layout = itemsOrRects
			.map(rect => {
				const item = rect?.item || rect?.node || null;
				const xPx = Number.isFinite(Number(rect?.xPx)) ? Number(rect.xPx) : Number(rect?.x || 0);
				const yPx = Number.isFinite(Number(rect?.yPx)) ? Number(rect.yPx) : Number(rect?.y || 0);
				const wPx = Number.isFinite(Number(rect?.wPx)) ? Number(rect.wPx) : Number(rect?.w || 0);
				const hPx = Number.isFinite(Number(rect?.hPx)) ? Number(rect.hPx) : Number(rect?.h || 0);
				return { item, xPx, yPx, wPx, hPx };
			})
			.filter(rect => rect.item && rect.wPx > 0 && rect.hPx > 0);
    } else {
        let sortedItems = itemsOrRects.filter(i => Number(i.sizeBytes) > 0).sort((a, b) => Number(b.sizeBytes) - Number(a.sizeBytes));
        if (depth === 1) sortedItems = sortedItems.slice(0, 250);
        layout = squarifyLevel(sortedItems, widthPx, heightPx);
	}
    
    layout.forEach(rect => {
        const { item, xPx, yPx, wPx, hPx } = rect;
        
        if (wPx < 3 || hPx < 3) return;

        const isParent = item.children && item.children.length > 0;
        
        let hue = parentHue;
        if (!isParent) {
            let ext = (item.name || '').split('.').pop().toLowerCase();
            let hash = 0;
            for (let i = 0; i < ext.length; i++) hash = ext.charCodeAt(i) + ((hash << 5) - hash);
            hue = Math.abs(hash) % 360;
        } else if (depth === 1) {
            hue = Math.floor(Math.random() * 360);
        }

        const div = document.createElement('div');
        div.className = isParent ? 'wiz-node wiz-folder' : 'wiz-node wiz-file';
        div.style.left = `${xPx}px`;
        div.style.top = `${yPx}px`;
        div.style.width = `${wPx}px`;
        div.style.height = `${hPx}px`;
        div.style.zIndex = depth;
        
        div.title = `${item.name || item.fullPath}\n${formatBytes(item.sizeBytes, 1)}`;
        div.addEventListener('click', (e) => {
            e.stopPropagation();
            if (item.fullPath && typeof ejecutarEscaneoFantasma === 'function') ejecutarEscaneoFantasma(item.fullPath, true);
        });

        if (isParent) {
            let headerHeight = (depth <= 4 && hPx > 35 && wPx > 45) ? 20 : 0;
            
            if (headerHeight > 0) {
                const title = document.createElement('div');
                title.className = 'wiz-folder-header';
                title.style.height = `${headerHeight}px`;
                title.style.lineHeight = `${headerHeight}px`;
                title.innerText = item.name || item.fullPath;
                div.appendChild(title);
            }

            let pad = (wPx > 25 && hPx > 25) ? 4 : 1; 
            let childAreaW = wPx - (pad * 2);
            let childAreaH = hPx - headerHeight - (pad * 2);

            if (childAreaW > 6 && childAreaH > 6) {
                const childContainer = document.createElement('div');
                childContainer.style.position = 'absolute';
                childContainer.style.left = `${pad}px`;
                childContainer.style.top = `${headerHeight + pad}px`;
                childContainer.style.width = `${childAreaW}px`; 
                childContainer.style.height = `${childAreaH}px`; 
                div.appendChild(childContainer);

                buildTreemapDOM(item.children, childContainer, childAreaW, childAreaH, depth + 1, hue, false);
            }
        } else {
            div.style.background = `linear-gradient(135deg, hsl(${hue}, 65%, 60%), hsl(${hue}, 70%, 40%))`;
            if (wPx > 55 && hPx > 25) {
                const label = document.createElement('div');
                label.className = 'wiz-label';
                label.innerText = item.name || 'file';
                div.appendChild(label);
            }
        }
        container.appendChild(div);
    });
}

// ======================== APPS LOGIC ========================

function filterAppsList(query) {
	const term = String(query || '').trim().toLowerCase();
	if (!term) return ghostState.appsList;
	return ghostState.appsList.filter((app) => {
		const fields = [app.name, app.publisher, app.version, app.installLocation].map((x) => String(x || '').toLowerCase());
		return fields.some((x) => x.includes(term));
	});
}

export async function cargarAppsFantasma() {
	const btn = document.getElementById('ojo-btn-apps');
	const searchInput = document.getElementById('ojo-apps-search');
	if (btn) {
		btn.disabled = true;
		btn.textContent = 'Cargando...';
	}
	try {
        if(!window.api) return;
		setOjoStatus('Listando aplicaciones instaladas...');
		const apps = await window.api.listarAppsInstaladas();
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
			if (app.installLocation && window.api) {
				window.api.openGlobalPath(app.installLocation);
			} else {
				mostrarToast('No hay ruta de instalacion disponible', 'system');
			}
		});

		
        const startUninstallFlux = async (force) => {
            const confirmMsg = force ? `Forzar desinstalacion destructiva de ${app.name} (puede romper cosas)?` : `Ejecutar desinstalador de ${app.name}?`;
            if (!window.confirm(confirmMsg)) return;

            try {
                if(!window.api) return;
                stdBtn.disabled = true;
                forceBtn.disabled = true;
                stdBtn.textContent = force ? 'Forzando...' : 'Desinstalando...';

                mostrarToast(force ? 'Forzando borrado... esto puede tardar' : 'Por favor completa el desinstalador oficial', 'system');
                const result = await window.api.desinstalarApp(app, force);

                mostrarToast('Iniciando escaneo Geek (Rastros profundos)...', 'system');
                if (!force) stdBtn.textContent = 'Escaneando...';
                
                const rastros = await window.api.buscarRastrosApp(app);

                if (rastros && rastros.length > 0) {
                    const rastrosList = rastros.map(r => `[${r.Type}] ${r.Path}`).join('\n');
                    const cleanOk = window.confirm(`Geek detecto ${rastros.length} rastros huerfanos para ${app.name}!\n\n${rastrosList.substring(0, 800)}...\n\nDeseas eliminar estos elementos residuales permanentemente?`);
                    
                    if (cleanOk) {
                        if (!force) stdBtn.textContent = 'Limpiando...';
                        const cleanRes = await window.api.limpiarRastrosApp(rastros);
                        mostrarToast(`Limpieza completada. ${cleanRes.deleted} rastros eliminados.`, 'success');
                        logTerminal(`[Ghost] Limpieza profunda: ${app.name} | Eliminados: ${cleanRes.deleted}`, 'system');
                    }
                } else {
                    mostrarToast('El desinstalador de esta app fue muy limpio. No se encontraron rastros.', 'success');
                }

                await cargarAppsFantasma();
            } catch (error) {
                mostrarToast(`Error al desinstalar ${app.name}`, 'error');
                logTerminal(`[Ghost] Desinstalar fallo (${app.name}): ${error.message || error}`, 'error');
            } finally {
                stdBtn.disabled = false;
                forceBtn.disabled = false;
                stdBtn.textContent = 'Desinstalar';
            }
        };

        const stdBtn = document.createElement('button');
        stdBtn.className = 'mac-action-btn edit';
        stdBtn.style.background = 'rgba(10, 132, 255, 0.2)';
        stdBtn.style.color = '#0A84FF';
        stdBtn.textContent = 'Desinstalar';
        stdBtn.addEventListener('click', () => startUninstallFlux(false));

        const forceBtn = document.createElement('button');
        forceBtn.className = 'mac-action-btn stop';
        forceBtn.textContent = 'Forzar';
        forceBtn.title = 'Mata procesos, borra carpeta a la fuerza y limpia registro (Fuerza bruta)';
        forceBtn.addEventListener('click', () => startUninstallFlux(true));

        actions.appendChild(locateBtn);
        actions.appendChild(stdBtn);
        actions.appendChild(forceBtn);
        card.appendChild(actions);

		fragment.appendChild(card);
	});
	grid.appendChild(fragment);
}

export function bindGhostEvents() {
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
