import { ghostState, setOjoState, ojoDatabase, ojoIndexing, ojoIndexed } from '../core/state.js';
import { safeText, formatBytes, getFileIconFromPath, getAppIconMarkup, loadRealAppIcon, escapeRegExp, highlightText } from '../core/utils.js';
import { logTerminal } from '../ui/terminalSystem.js';
import { mostrarToast } from '../ui/toastSystem.js';

let treemapCanvas = null;
let treemapCtx = null;
let treemapRects = []; // Guardaremos los rects actuales para interacci├│n
let treemapItemsRaw = []; // Referencia a los items originales para metadata
let hoveredNode = null;
let lastMousePos = { x: 0, y: 0 };
let treemapScale = 1;
let treemapRedrawRaf = null;

const TREEMAP_RESIZE_DEBOUNCE_MS = 150;

function teardownTreemapResizeLifecycle() {
	if (ghostState.treemapResizeObs) {
		try { ghostState.treemapResizeObs.disconnect(); } catch (_) {}
		ghostState.treemapResizeObs = null;
	}

	if (ghostState.treemapResizeTimer) {
		clearTimeout(ghostState.treemapResizeTimer);
		ghostState.treemapResizeTimer = null;
	}

	if (ghostState.treemapWindowResizeHandler) {
		window.removeEventListener('resize', ghostState.treemapWindowResizeHandler);
		ghostState.treemapWindowResizeHandler = null;
	}

	if (treemapRedrawRaf) {
		cancelAnimationFrame(treemapRedrawRaf);
		treemapRedrawRaf = null;
	}
}

function requestTreemapRedraw() {
	if (treemapRedrawRaf) return;
	treemapRedrawRaf = requestAnimationFrame(() => {
		treemapRedrawRaf = null;
		drawTreemapContent();
	});
}

function resetTreemapWorker() {
	return;
}

function getTreemapTooltip() {
    let el = document.getElementById('treemap-tooltip');
    if (!el) {
        el = document.createElement('div');
        el.id = 'treemap-tooltip';
        el.className = 'mac-glass';
        document.body.appendChild(el);
    }
    return el;
}

function indexTreemapItems(items, bucket = []) {
	if (!Array.isArray(items)) return bucket;
	for (const item of items) {
		const node = item || {};
		node.__treemapIndex = bucket.length;
		bucket.push(node);
		if (Array.isArray(node.children) && node.children.length > 0) {
			indexTreemapItems(node.children, bucket);
		}
	}
	return bucket;
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
		ghostState.engines = await window.api.ghost.getStatus();
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
                // Escuchamos el progreso de instalaci├│n por si acaso
                window.api.ui.onSetupProgress((data) => {
                    setOjoStatus(`[Setup] ${data.status} (${data.percent}%)`);
                });

                // Nueva l├│gica de escaneo por chunks para no colapsar el bridge
                let totalFiles = 0;
                const db = [];
			    window.api.util.scanGlobalFiles((chunk) => {
                    db.push(...chunk);
                    totalFiles += chunk.length;
                    setOjoStatus(`Mapeando RAM: ${totalFiles.toLocaleString()} rutas...`);
			    }, (count) => {
				    // Este callback puede usarse para progreso acumulado si el backend lo soporta
			    });
                
                // Nota: El backend avisar├í cuando termine
                // Por ahora simulamos el final o esperamos que el ├║ltimo chunk llegue
                // En una implementaci├│n real, el invoke de scanGlobalFiles resolver├¡a al final
                window.api.system.ensureEnvironment().then(() => {
                    setOjoState({ ojoDatabase: db, ojoIndexed: true, ojoIndexing: false });
                    setOjoStatus(`Indice local listo: ${totalFiles.toLocaleString()} rutas en RAM.`);
                    if (ghostState.activeScreen === 'search') {
					    filtrarOjoDeDios();
				    }
                });
            }
		} else if (ghostState.activeScreen === 'search') {
			filtrarOjoDeDios();
		}
	}
}

export function cerrarOjoDeDios() {
	const modal = document.getElementById('modal-ojo-dios');
	teardownTreemapResizeLifecycle();
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
		const sourceLabel = item.source ? `<span style="font-size:10px;color:#8aa7ff;">${safeText(item.source)}</span>` : '';
		row.innerHTML = `
			<div style="font-size:16px;">${fileIcon}</div>
			<div style="min-width:0;flex:1;">
				<div class="ghost-item-name">${safeText(item.name || 'archivo')} ${sourceLabel}</div>
				<div class="ghost-item-path">${safeText(item.fullPath || '')}</div>
			</div>
		`;
		row.addEventListener('click', () => {
			if (!item.fullPath) return;
			if (item.fullPath.startsWith('[APP]')) {
				if (item.installLocation) {
					window.api.shell.openGlobalPath(item.installLocation);
				} else {
					mostrarToast('App detectada sin ruta local disponible', 'system');
				}
				return;
			}
			if(window.api) window.api.shell.showGlobalItemInFolder(item.fullPath);
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

		const backendPromise = useBackend ? window.api.ghost.buscarArchivo(q, 12000) : Promise.resolve([]);
		const appsPromise = shouldSearchApps
			? (ghostState.searchAppsCache ? Promise.resolve(ghostState.searchAppsCache) : window.api.ghost.listarAppsInstaladas())
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

export async function ejecutarEscaneoFantasma(rootPath = null, pushStack = false, options = {}) {
	const targetRoot = String(rootPath || ghostState.diskPathStack[ghostState.diskPathStack.length - 1] || 'C:\\');
	const forceFresh = !!(options && options.forceFresh);
	const sameRootAsCurrent = String(ghostState.currentDiskRoot || '').toLowerCase() === targetRoot.toLowerCase();
	const keepCurrentView = forceFresh && sameRootAsCurrent && !!ghostState.currentDiskPayload;
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

	// Reinicio estricto de estado antes de iniciar un escaneo nuevo
	teardownTreemapResizeLifecycle();
	resetTreemapWorker();
	if (!keepCurrentView) {
		treemapRects = [];
		treemapItemsRaw = [];
		hoveredNode = null;
		ghostState.currentDiskPayload = null;
	}

	if (btn) {
		btn.disabled = true;
		btn.textContent = 'Calculando...';
	}
	if (keepCurrentView) {
		if (loadingEl) loadingEl.style.display = 'none';
		if (contentEl) contentEl.style.display = 'grid';
	} else {
		if (loadingEl) loadingEl.style.display = 'flex';
		if (contentEl) contentEl.style.display = 'none';
	}

	try {
		if(!window.api) return;
		setOjoStatus(keepCurrentView ? `Actualizando ${targetRoot} en segundo plano...` : `Escaneando ${targetRoot}...`);
		if (forceFresh && window.api.ghost.clearDiskScanCache) {
			await window.api.ghost.clearDiskScanCache(targetRoot);
		}
		
		// Conexi├│n con la nueva barra HTML
		loadingBarProgress = document.getElementById('ojo-disk-progress-fill');
		const loadingText = document.getElementById('ojo-disk-loading-text');
		let progressValue = 0;

		const syncLoadingProgress = (phase, percent) => {
			const raw = Number(percent) || 0;
			const normalized = raw <= 1 ? raw * 100 : raw;
			progressValue = Math.max(progressValue, Math.max(0, Math.min(100, normalized)));
			const visualPercent = Math.round(progressValue);

			if (loadingBarProgress) {
				loadingBarProgress.style.width = `${visualPercent}%`;
				loadingBarProgress.style.maxWidth = `${visualPercent}%`;
				loadingBarProgress.style.flexBasis = `${visualPercent}%`;
			}

			if (loadingText) {
				const txt = phase === 'cached'
					? 'Usando datos recientes para acelerar...'
					: (phase === 'parsing'
						? 'Leyendo y parseando archivos...'
						: (phase === 'finalize'
							? 'Finalizando mapa de disco...'
							: (phase === 'done' ? 'Escaneo completo.' : 'Analizando estructura del disco...')));
				loadingText.innerText = `${txt} ${visualPercent}%`;
				if (keepCurrentView) {
					setOjoStatus(`${txt} ${visualPercent}%`);
				}
			}
		};

		if (loadingBarProgress) {
			loadingBarProgress.style.width = '0%';
			loadingBarProgress.style.maxWidth = '0%';
			loadingBarProgress.style.flexBasis = '0%';
		}

		if (loadingText) {
			loadingText.innerText = 'Iniciando escaneo de disco... 0%';
		}

		const payload = await window.api.ghost.escanearDisco(targetRoot, (progress) => {
			if (scanSeq !== ghostState.diskScanSeq) return;
			const phase = String(progress && progress.phase ? progress.phase : 'scan');
			const raw = Number(progress && progress.percent ? progress.percent : 0);
			syncLoadingProgress(phase, raw);
		}, { forceFresh });

		let payloadForRender = payload || null;
		if (
			payloadForRender &&
			payloadForRender.itemsTruncated &&
			payloadForRender.snapshotPath &&
			window.api &&
			typeof window.api.ghost.leerPaginaDisco === 'function'
		) {
			const page = await window.api.ghost.leerPaginaDisco(
				payloadForRender.snapshotPath,
				0,
				1200
			);

			if (Array.isArray(page?.items) && page.items.length > 0) {
				payloadForRender = {
					...payloadForRender,
					items: page.items,
					totalItems: Number(page.totalItems) || Number(payloadForRender.totalItems) || page.items.length
				};
			}
		}
		
		if (scanSeq !== ghostState.diskScanSeq) return;

		if (!keepCurrentView) {
			syncLoadingProgress('done', 100);

			// PAUSA VISUAL: Obligamos a la interfaz a esperar casi medio segundo 
			// para que te d├® tiempo a ver c├│mo la barra llega al final suavemente
			await new Promise(resolve => setTimeout(resolve, 400));

			// Ocultar barra y mostrar resultados
			if (loadingEl) loadingEl.style.display = 'none';
			if (contentEl) contentEl.style.display = 'grid';
		}

		// CR├ìTICO: Le damos 50ms al navegador para que asimile el "display: flex" 
		// y sepa exactamente cu├íntos p├¡xeles de ancho y alto tiene la pantalla
		// antes de ponerse a calcular el tama├▒o de los cuadrados del mapa.
		setTimeout(() => {
			ghostState.currentDiskPayload = payloadForRender || null;
			ghostState.currentDiskRoot = targetRoot;
			const heatmapItems = Array.isArray(payloadForRender?.items) ? payloadForRender.items.slice(0, 30) : [];
			if (window.__radarSystem && typeof window.__radarSystem.renderHeatmap === 'function') {
				window.__radarSystem.renderHeatmap(heatmapItems);
			} else {
				window.dispatchEvent(new CustomEvent('disk-heatmap:update', { detail: { items: heatmapItems } }));
			}
			renderEscaneoDisco(payloadForRender);
			ghostState.diskScanned = true;
			const engine = (payloadForRender?.engine || 'native').toUpperCase();
			const totalItems = Number(payloadForRender?.totalItems) || Number(payloadForRender?.items?.length) || 0;
			setOjoStatus(`Mapa listo para ${targetRoot} (${engine}) · nodos: ${totalItems.toLocaleString()}`);
		}, keepCurrentView ? 0 : 50);
	} catch (err) {
		console.error(err);
		// Si hay un error, ocultar la carga para que no se quede bloqueado
		if (loadingEl) loadingEl.style.display = 'none';
		if (contentEl) contentEl.style.display = 'grid';
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
				sep.textContent = 'ÔÇ║';
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
		treemap.style.display = 'block';
		treemap.style.position = 'relative';

		// Inicialización correcta de Canvas
		if (!treemapCanvas) {
			treemap.innerHTML = ''; // Limpiar el innerHTML antes de inyectar el canvas
			treemapCanvas = document.createElement('canvas');
			treemapCanvas.style.display = 'block';
			treemapCanvas.style.width = '100%';
			treemapCanvas.style.height = '100%';
			treemapCtx = treemapCanvas.getContext('2d', { alpha: false });
			
			treemap.appendChild(treemapCanvas);
			
			// Conectar eventos existentes
			treemapCanvas.addEventListener('mousemove', handleCanvasMouseMove);
			treemapCanvas.addEventListener('mouseleave', handleCanvasMouseLeave);
			treemapCanvas.addEventListener('click', handleCanvasClick);
			treemapCanvas.addEventListener('contextmenu', handleCanvasContextMenu);
			
			// Responsive: ResizeObserver con debounce de 150ms
			let resizeTimer = null;
			const resizeObs = new ResizeObserver(() => {
				if (resizeTimer) clearTimeout(resizeTimer);
				resizeTimer = setTimeout(() => {
					if (treemapItemsRaw && treemapItemsRaw.length > 0) {
						recalcularYDibujarTreemap(treemapItemsRaw);
					}
				}, 150);
			});
			resizeObs.observe(treemap);
			
			// Guardamos para lifecycle clearing (si existe logica de teardown, evitar fugar el observer)
			ghostState.treemapResizeObs = resizeObs; 
		}
		
		// Esperar al layout del DOM (10ms) antes de calcular dimensiones
		setTimeout(() => {
			recalcularYDibujarTreemap(items);
		}, 10);
	}

	const fragment = document.createDocumentFragment();
	items.slice(0, 220).forEach((item) => {
		const card = document.createElement('div');
		card.className = 'disk-item';
		const pct = Math.max(1, Math.min(100, Number(item.percent || 0)));
		card.innerHTML = `
			<div class="disk-topline">
				<span>${safeText(item.name || item.fullPath)}</span>
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

/**
 * Paleta sem├íntica para archivos; directorios siempre van en pizarra oscuro.
 */
function isFolderNode(node, fallbackIsDir = false) {
	return Boolean(
		fallbackIsDir ||
		node?.isFolder ||
		node?.isDir ||
		(Array.isArray(node?.children) && node.children.length > 0)
	);
}

function getColorForNode(node, fallbackIsDir = false, hueCategory = null, depth = 0) {
	const rawName = String(node?.name || node?.fullPath || 'item');
	const fileName = rawName.split(/[\\/]/).pop() || rawName;
	const dirPalette = ['#355c7d', '#6c5b7b', '#2f6f5e', '#7b5e57', '#4e5d94', '#5f7c4a', '#7d4f6f', '#447b8f'];
	const fileFallbackPalette = ['#00e5ff', '#b388ff', '#ffd740', '#ff5252', '#69f0ae', '#448aff', '#40c4ff', '#ea80fc'];

	const pickByHash = (seed, palette) => {
		const s = String(seed || 'x');
		let hash = 0;
		for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash) + s.charCodeAt(i);
		return palette[Math.abs(hash) % palette.length];
	};

	if (isFolderNode(node, fallbackIsDir)) {
		return pickByHash(`${fileName}:${depth}`, dirPalette);
	}

	if (!fileName.includes('.')) {
		if (hueCategory === 1) return '#00e5ff';
		if (hueCategory === 2) return '#b388ff';
		if (hueCategory === 3) return '#ffd740';
		if (hueCategory === 4) return '#ff5252';
		if (hueCategory === 5) return '#448aff';
		return pickByHash(fileName, fileFallbackPalette);
	}

	const ext = fileName.split('.').pop().toLowerCase();

	switch (ext) {
		case 'jpg':
		case 'jpeg':
		case 'png':
		case 'gif':
		case 'webp':
			return '#00e5ff';
		case 'mp4':
		case 'mkv':
		case 'avi':
		case 'mov':
			return '#b388ff';
		case 'mp3':
		case 'wav':
		case 'flac':
			return '#ffd740';
		case 'exe':
		case 'msi':
		case 'bat':
		case 'dll':
			return '#ff5252';
		case 'zip':
		case 'rar':
		case '7z':
			return '#69f0ae';
		case 'pdf':
		case 'doc':
		case 'txt':
			return '#448aff';
		default:
			return pickByHash(ext, fileFallbackPalette);
	}
}

function darkenHexByPercent(hex, percent = 0.3) {
	const clean = (hex || '').replace('#', '').trim();
	if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '#448aff';

	const factor = Math.max(0, Math.min(1, 1 - percent));
	const r = Math.max(0, Math.min(255, Math.round(parseInt(clean.slice(0, 2), 16) * factor)));
	const g = Math.max(0, Math.min(255, Math.round(parseInt(clean.slice(2, 4), 16) * factor)));
	const b = Math.max(0, Math.min(255, Math.round(parseInt(clean.slice(4, 6), 16) * factor)));
	return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function boostHexSaturation(hex, amount = 0.12) {
	const clean = (hex || '').replace('#', '').trim();
	if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '#448aff';

	let r = parseInt(clean.slice(0, 2), 16) / 255;
	let g = parseInt(clean.slice(2, 4), 16) / 255;
	let b = parseInt(clean.slice(4, 6), 16) / 255;

	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	let h = 0;
	let s = 0;
	const l = (max + min) / 2;

	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

		switch (max) {
			case r:
				h = (g - b) / d + (g < b ? 6 : 0);
				break;
			case g:
				h = (b - r) / d + 2;
				break;
			default:
				h = (r - g) / d + 4;
		}
		h /= 6;
	}

	s = Math.max(0, Math.min(1, s + amount));

	const hue2rgb = (p, q, t) => {
		let tt = t;
		if (tt < 0) tt += 1;
		if (tt > 1) tt -= 1;
		if (tt < 1 / 6) return p + (q - p) * 6 * tt;
		if (tt < 1 / 2) return q;
		if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
		return p;
	};

	if (s === 0) {
		r = l;
		g = l;
		b = l;
	} else {
		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		r = hue2rgb(p, q, h + 1 / 3);
		g = hue2rgb(p, q, h);
		b = hue2rgb(p, q, h - 1 / 3);
	}

	return `#${Math.round(r * 255).toString(16).padStart(2, '0')}${Math.round(g * 255).toString(16).padStart(2, '0')}${Math.round(b * 255).toString(16).padStart(2, '0')}`;
}

function drawTreemapLabel(ctx, x, y, width, height, name, isDir) {
	ctx.save();
	ctx.beginPath();
	ctx.rect(x, y, width, height);
	ctx.clip();

	if (width < 45 || height < 15) {
		ctx.restore();
		return;
	}

	ctx.fillStyle = '#ffffff';
	ctx.shadowColor = 'rgba(0,0,0,0.85)';
	ctx.shadowBlur = 3;

	if (isDir) {
		ctx.font = '600 11px "SF Pro Display", "Inter", sans-serif';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.fillText(name, x + 6, y + 9);
	} else {
		const fontSize = Math.min(12, Math.max(9, height / 5));
		ctx.font = `500 ${fontSize}px "SF Pro Display", "Inter", sans-serif`;
		ctx.textBaseline = 'middle';
		ctx.textAlign = 'center';
		ctx.fillText(name, x + (width / 2), y + (height / 2));
	}

	ctx.restore();
}

function calculateTreemapRects(items, totalWidth, totalHeight) {
	if (!items || items.length === 0 || totalWidth <= 0 || totalHeight <= 0) return [];
	
	// Ordenar ítems usando copia
	const sortedItems = items.map((item, index) => ({ item, index }))
		.sort((a, b) => (Number(b.item.sizeBytes) || 0) - (Number(a.item.sizeBytes) || 0));
	
	// Limitar rectángulos por rendimiento, evitar microscópicos
	const renderItems = sortedItems.slice(0, 400);
	
	let totalSize = 0;
	for (const r of renderItems) totalSize += (Number(r.item.sizeBytes) || 0);
	if (totalSize <= 0) return [];

	// Mapear el tamaño en bytes a área proporcional real del canvas
	const containerArea = totalWidth * totalHeight;
	const data = renderItems.map(r => ({
		...r,
		area: ((Number(r.item.sizeBytes) || 0) / totalSize) * containerArea
	})).filter(r => r.area > 0);

	const rects = [];
	const hues = [210, 190, 0, 30, 120, 270, 330, 240, 150];

	// Estado del contenedor mutable durante el Squarify
	let x = 0;
	let y = 0;
	let w = totalWidth;
	let h = totalHeight;

	// Calcula la peor proporción (aspect ratio) de una fila de rectángulos
	function worst(row, length) {
		if (row.length === 0) return Infinity;
		let minArea = Infinity;
		let maxArea = 0;
		let sumArea = 0;
		for (let i = 0; i < row.length; i++) {
			const a = row[i].area;
			if (a < minArea) minArea = a;
			if (a > maxArea) maxArea = a;
			sumArea += a;
		}
		const sqLength = length * length;
		const sumSq = sumArea * sumArea;
		return Math.max((sqLength * maxArea) / sumSq, sumSq / (sqLength * minArea));
	}

	// Posiciona una fila de componentes y acota el contenedor restante
	function layoutRow(row, length) {
		let rowArea = 0;
		for (let i = 0; i < row.length; i++) rowArea += row[i].area;

		let rx = x;
		let ry = y;
		let rw, rh;

		if (w >= h) {
			rw = rowArea / h;
			rh = h;
			for (let i = 0; i < row.length; i++) {
				const node = row[i];
				const nodeH = node.area / rw;
				const hue = hues[node.index % hues.length];
				rects.push({
					x: rx, y: ry, w: rw, h: nodeH,
					itemIndex: node.index,
					isDir: node.item.isDir || false,
					baseColor: `hsl(${hue}, 70%, 45%)`
				});
				ry += nodeH;
			}
			x += rw;
			w -= rw;
		} else {
			rw = w;
			rh = rowArea / w;
			for (let i = 0; i < row.length; i++) {
				const node = row[i];
				const nodeW = node.area / rh;
				const hue = hues[node.index % hues.length];
				rects.push({
					x: rx, y: ry, w: nodeW, h: rh,
					itemIndex: node.index,
					isDir: node.item.isDir || false,
					baseColor: `hsl(${hue}, 70%, 45%)`
				});
				rx += nodeW;
			}
			y += rh;
			h -= rh;
		}
	}

	// Algoritmo recursivo original Squarify de Mark Bruls
	function squarify(children) {
		let row = [];
		let length = Math.min(w, h);

		for (let i = 0; i < children.length; i++) {
			const node = children[i];
			const nextRow = [...row, node];
			
			// Si agregar el nodo mejora (disminuye ratio) la mejor aproximación a cuadrado, conservalo
			if (row.length === 0 || worst(nextRow, length) <= worst(row, length)) {
				row = nextRow;
			} else {
				// De locontrario, acomoda la fila y empieza una nueva con el nodo sobrante en el plano restante
				layoutRow(row, length);
				row = [node];
				length = Math.min(w, h);
			}
		}
		if (row.length > 0) {
			layoutRow(row, length);
		}
	}

	squarify(data);
	return rects;
}

function recalcularYDibujarTreemap(items) {
	if (!treemapCanvas || !treemapCtx) return;
	const parentContainer = treemapCanvas.closest('#ojo-disk-treemap');
	if (!parentContainer) return;

	const rect = parentContainer.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) return; // div hidden

	const dpr = window.devicePixelRatio || 1;
	treemapCanvas.width = rect.width * dpr;
	treemapCanvas.height = rect.height * dpr;
	treemapCanvas.style.width = `${rect.width}px`;
	treemapCanvas.style.height = `${rect.height}px`;

	treemapScale = dpr;
	treemapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

	treemapItemsRaw = items || [];
	treemapRects = calculateTreemapRects(treemapItemsRaw, rect.width, rect.height);
	
	requestTreemapRedraw();
}

function drawTreemapContent() {
	if (!treemapCtx || !treemapCanvas) return;
	const ctx = treemapCtx;
	const tw = treemapCanvas.width / treemapScale;
	const th = treemapCanvas.height / treemapScale;

	ctx.clearRect(0, 0, tw, th);
	ctx.fillStyle = '#0f1115';
	ctx.fillRect(0, 0, tw, th);

	if (!treemapRects || treemapRects.length === 0) return;

	for (const r of treemapRects) {
		if (r.w <= 0.5 || r.h <= 0.5) continue;

		ctx.save();
		
		// Fill base
		ctx.fillStyle = r.baseColor;
		ctx.fillRect(r.x, r.y, r.w, r.h);

		// Cushion 3D Effect - Radial Gradient estilo WizTree (Luz central, sombra externa propogada suave)
		const cx = r.x + r.w / 2;
		const cy = r.y + r.h / 2;
		const radius = Math.max(r.w, r.h) * 0.7;
		
		const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
		grd.addColorStop(0, 'rgba(255,255,255,0.2)');
		grd.addColorStop(1, 'rgba(0,0,0,0.4)');
		
		ctx.fillStyle = grd;
		ctx.fillRect(r.x, r.y, r.w, r.h);

		// Biselado 3D - Luz (Highlight) arriba/izquierda
		ctx.beginPath();
		ctx.moveTo(r.x, r.y + r.h);
		ctx.lineTo(r.x, r.y);
		ctx.lineTo(r.x + r.w, r.y);
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
		ctx.lineWidth = 1;
		ctx.stroke();

		// Biselado 3D - Sombra oscura abajo/derecha
		ctx.beginPath();
		ctx.moveTo(r.x + r.w, r.y);
		ctx.lineTo(r.x + r.w, r.y + r.h);
		ctx.lineTo(r.x, r.y + r.h);
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
		ctx.stroke();

		// Hover Effect - Overlay blanco suave y borde resaltado
		if (hoveredNode === r) {
			ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
			ctx.fillRect(r.x, r.y, r.w, r.h);
			
			ctx.strokeStyle = '#ffffff';
			ctx.lineWidth = 2;
			ctx.strokeRect(r.x + 1, r.y + 1, Math.max(0, r.w - 2), Math.max(0, r.h - 2));
		}
		
		ctx.restore();
	}

	// Text Layer independiente - Evita solapamiento de opacidades durante el render
	for (const r of treemapRects) {
		if (r.w >= 35 && r.h >= 15) {
			const item = treemapItemsRaw[r.itemIndex] || null;
			if (!item) continue;
			drawTreemapLabel(ctx, r.x, r.y, r.w, r.h, item.name || '...', item.isDir || r.isDir);
		}
	}
}

function handleCanvasMouseMove(e) {
    const rect = treemapCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    lastMousePos = { x: e.clientX, y: e.clientY };

    // B├║squeda del nodo m├ís profundo bajo el cursor
    let best = null;
    let maxDepth = -1;

    for (const r of treemapRects) {
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            if (r.depth > maxDepth) {
                maxDepth = r.depth;
                best = r;
            }
        }
    }

    if (best !== hoveredNode) {
        hoveredNode = best;
		requestTreemapRedraw();
        updateTreemapTooltip();
    } else if (hoveredNode) {
        updateTreemapTooltip();
    }
}

function updateTreemapTooltip() {
    const tooltip = getTreemapTooltip();
    if (!hoveredNode) {
        tooltip.style.display = 'none';
        return;
    }

    const item = treemapItemsRaw[hoveredNode.itemIndex];
    if (!item) return;

    const parentSize = ghostState.currentDiskPayload?.totalSize || item.sizeBytes;
    const percent = ((item.sizeBytes / parentSize) * 100).toFixed(2);

    tooltip.innerHTML = `
        <div style="font-weight:700; color:#fff; margin-bottom:4px; word-break:break-all;">${safeText(item.name)}</div>
        <div style="color:#aaa; font-size:11px; margin-bottom:6px; word-break:break-all;">${safeText(item.fullPath)}</div>
        <div style="display:flex; justify-content:space-between; gap:20px;">
            <span style="color:#0A84FF;">Tama├▒o: ${formatBytes(item.sizeBytes)}</span>
            <span style="color:#30D158;">${percent}%</span>
        </div>
    `;

    tooltip.style.display = 'block';
    
    // Posicionamiento inteligente
    let tx = lastMousePos.x + 15;
    let ty = lastMousePos.y + 15;
    
    if (tx + 250 > window.innerWidth) tx = lastMousePos.x - 265;
    if (ty + 100 > window.innerHeight) ty = lastMousePos.y - 115;

    tooltip.style.left = `${tx}px`;
    tooltip.style.top = `${ty}px`;
}

function handleCanvasMouseLeave() {
    hoveredNode = null;
	requestTreemapRedraw();
    getTreemapTooltip().style.display = 'none';
}

function handleCanvasClick(e) {
    if (hoveredNode) {
        const item = treemapItemsRaw[hoveredNode.itemIndex];
        if (item && item.isDir && item.fullPath) {
            // Animaci├│n de Zoom-In
            animateZoomIn(hoveredNode, () => {
                ejecutarEscaneoFantasma(item.fullPath, true);
            });
        }
    }
}

function animateZoomIn(node, callback) {
    const startX = 0, startY = 0, startW = treemapCanvas.width / treemapScale, startH = treemapCanvas.height / treemapScale;
    const targetX = node.x, targetY = node.y, targetW = node.w, targetH = node.h;
    
    let startTime = null;
    const duration = 250; // ms

    function animate(timestamp) {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3); // easeOutCubic

        // Calculamos el viewport de transformaci├│n
        const currentW = startW / (1 + (startW/targetW - 1) * ease);
        const currentH = startH / (1 + (startH/targetH - 1) * ease);
        const currentX = targetX * ease;
        const currentY = targetY * ease;

        // Limpiamos y redibujamos con transformaci├│n
        treemapCtx.save();
        treemapCtx.clearRect(0, 0, startW, startH);
        
        const scaleX = startW / (startW - (startW - targetW) * ease);
        const scaleY = startH / (startH - (startH - targetH) * ease);
        
        treemapCtx.translate(-targetX * ease * scaleX, -targetY * ease * scaleY);
        treemapCtx.scale(scaleX, scaleY);
        
        drawTreemapContent();
        treemapCtx.restore();

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            callback();
        }
    }
    requestAnimationFrame(animate);
}

function handleCanvasContextMenu(e) {
    if (!hoveredNode) return;
    e.preventDefault();
    const item = treemapItemsRaw[hoveredNode.itemIndex];
    if (!item || !item.fullPath) return;

    // Men├║ contextual nativo de Electron v├¡a Preload
    if (window.api && window.api.ui.showContextMenu) {
        window.api.ui.showContextMenu([
            { label: 'Abrir en Explorador', click: () => window.api.shell.showGlobalItemInFolder(item.fullPath) },
            { label: 'Copiar Ruta', click: () => navigator.clipboard.writeText(item.fullPath) },
            { type: 'separator' },
            { label: 'EliminarArchivo (Permanente)', click: () => {
                if (confirm(`┬┐Eliminar definitivamente?\n${item.fullPath}`)) {
                    // L├│gica de eliminaci├│n...
                }
            }}
        ]);
    }
}

// ======================== APPS LOGIC ========================

let appsSortColumn = 'name';
let appsSortOrder = 'asc';

function filterAppsList(query) {
	const term = String(query || '').trim().toLocaleLowerCase();
	if (!term) return ghostState.appsList;
	
	return ghostState.appsList.filter((app) => {
		const name = String(app.name || '').toLocaleLowerCase();
		const pub = String(app.publisher || '').toLocaleLowerCase();
		return name.includes(term) || pub.includes(term);
	});
}

function sortAppsList(apps) {
	const col = appsSortColumn;
	const dir = appsSortOrder === 'asc' ? 1 : -1;
	return [...apps].sort((a, b) => {
		let va, vb;
		if (col === 'size') {
			va = Number(a.estimatedSize) || 0;
			vb = Number(b.estimatedSize) || 0;
		} else if (col === 'date') {
			va = String(a.installDate || '');
			vb = String(b.installDate || '');
		} else if (col === 'publisher') {
			va = String(a.publisher || '').toLowerCase();
			vb = String(b.publisher || '').toLowerCase();
		} else if (col === 'version') {
			va = String(a.version || '').toLowerCase();
			vb = String(b.version || '').toLowerCase();
		} else {
			va = String(a.name || '').toLowerCase();
			vb = String(b.name || '').toLowerCase();
		}
		if (va < vb) return -1 * dir;
		if (va > vb) return 1 * dir;
		return 0;
	});
}

function formatInstallDate(raw) {
	if (!raw || raw.length < 8) return '-';
	const y = raw.substring(0, 4);
	const m = raw.substring(4, 6);
	const d = raw.substring(6, 8);
	return `${d}/${m}/${y}`;
}

function formatSizeKB(bytes) {
	if (!bytes || bytes <= 0) return '-';
	if (bytes < 1024) return '< 1 KB';
	if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
	if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
	return (bytes / 1073741824).toFixed(2) + ' GB';
}

export async function cargarAppsFantasma() {
	const btn = document.getElementById('ojo-btn-apps');
	const loadingBar = document.getElementById('apps-loading-bar');
	const counter = document.getElementById('apps-counter');
	const searchInput = document.getElementById('ojo-apps-search');

	if (btn) { btn.disabled = true; btn.textContent = 'Escaneando...'; }
	if (loadingBar) loadingBar.style.display = 'block';
	if (counter) counter.textContent = 'Escaneando registro...';

	try {
		if (!window.api) return;
		setOjoStatus('Leyendo registro de Windows (3 ramas)...');
		const apps = await window.api.ghost.listarAppsInstaladas();
		ghostState.appsList = apps;
		const filtered = filterAppsList(searchInput?.value || '');
		renderAppsTable(filtered);
		ghostState.appsLoaded = true;
		if (counter) counter.textContent = `${apps.length} aplicaciones`;
		setOjoStatus(`Registro leido: ${apps.length} aplicaciones detectadas.`);
		mostrarToast(`Apps detectadas: ${apps.length}`, 'system');
	} catch (error) {
		setOjoStatus('No se pudo cargar la lista de aplicaciones.');
		mostrarToast('Error cargando aplicaciones', 'error');
		logTerminal(`[Ghost] Listar apps fallo: ${error.message || error}`, 'error');
	} finally {
		if (btn) { btn.disabled = false; btn.textContent = 'Escanear'; }
		if (loadingBar) loadingBar.style.display = 'none';
	}
}

function renderAppsTable(apps) {
	const tbody = document.getElementById('apps-table-body');
	if (!tbody) return;
	tbody.innerHTML = '';

	// Update sort header visuals
	document.querySelectorAll('.apps-th-sortable').forEach(th => {
		th.classList.toggle('sorted', th.getAttribute('data-sort') === appsSortColumn);
		th.classList.toggle('sorted-desc', th.getAttribute('data-sort') === appsSortColumn && appsSortOrder === 'desc');
	});

	if (!apps || apps.length === 0) {
		tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--mac-text-muted);">No se encontraron aplicaciones. Pulsa Escanear para cargar.</td></tr>';
		return;
	}

	const sorted = sortAppsList(apps);
	const fragment = document.createDocumentFragment();

	sorted.forEach((app) => {
		const row = document.createElement('tr');
		row.className = 'apps-row';
		row.id = `app-row-${app.id}`; // Add ID for real-time manipulation
		const iconId = `app-tbl-icon-${Math.random().toString(36).substr(2, 9)}`;
		const iconMarkup = getAppIconMarkup(app, iconId);
		setTimeout(() => loadRealAppIcon(app, iconId), 10);

		row.innerHTML = `
			<td class="apps-td" style="flex:4;">
				<div class="apps-td-name">
					<span class="apps-td-icon">${iconMarkup}</span>
					<span class="apps-td-name-text">${safeText(app.name)}</span>
				</div>
			</td>
			<td class="apps-td apps-td-muted" style="flex:1.5;">${safeText(app.version || '-')}</td>
			<td class="apps-td apps-td-muted" style="flex:1.5;">${formatSizeKB(app.estimatedSize)}</td>
			<td class="apps-td apps-td-muted" style="flex:1.5;">${formatInstallDate(app.installDate)}</td>
			<td class="apps-td apps-td-muted" style="flex:3;">${safeText(app.publisher || 'Desconocido')}</td>
		`;

		// Context menu on right click
		row.addEventListener('contextmenu', (e) => {
			if (row.classList.contains('uninstalling')) return;
			e.preventDefault();
			showAppsContextMenu(e, app);
		});

		// Double click to uninstall
		row.addEventListener('dblclick', () => {
			if (row.classList.contains('uninstalling')) return;
			startUninstallFlux(app, false);
		});

		fragment.appendChild(row);
	});

	tbody.appendChild(fragment);
}

// ======================== CONTEXT MENU ========================

function showAppsContextMenu(event, app) {
	// Remove any existing context menu
	const old = document.getElementById('apps-context-menu');
	if (old) old.remove();

	const menu = document.createElement('div');
	menu.id = 'apps-context-menu';
	menu.className = 'apps-context-menu';

	const items = [
		{ label: '🗑️ Desinstalar', action: () => startUninstallFlux(app, false) },
		{ label: '⚠️ Desinstalación Forzada', action: () => startUninstallFlux(app, true), cls: 'danger' },
		{ type: 'separator' },
		{ label: '📂 Abrir carpeta de instalación', action: () => {
			if (app.installLocation && window.api) { window.api.shell.openGlobalPath(app.installLocation); }
			else { mostrarToast('No hay ruta de instalación disponible', 'system'); }
		}},
		{ label: '🔑 Abrir en el Registro (Regedit)', action: () => {
			if (app.registryPath && window.api) {
				// Convert PSPath format to regedit-compatible path
				let regPath = app.registryPath
					.replace('Microsoft.PowerShell.Core\\Registry::', '')
					.replace(/\//g, '\\');
				window.api.shell.openRegeditKey(regPath);
			} else {
				mostrarToast('Ruta del registro no disponible', 'system');
			}
		}},
		{ type: 'separator' },
		{ label: '🔍 Buscar en Google', action: () => {
			const q = encodeURIComponent(app.name + ' uninstall');
			if (window.api && window.api.shell.openExternalUrl) { window.api.shell.openExternalUrl(`https://www.google.com/search?q=${q}`); }
			else { window.open(`https://www.google.com/search?q=${q}`, '_blank'); }
		}}
	];

	items.forEach(item => {
		if (item.type === 'separator') {
			const sep = document.createElement('div');
			sep.className = 'ctx-separator';
			menu.appendChild(sep);
			return;
		}
		const btn = document.createElement('button');
		btn.className = 'ctx-item' + (item.cls ? ` ctx-${item.cls}` : '');
		btn.textContent = item.label;
		btn.addEventListener('click', () => { menu.remove(); item.action(); });
		menu.appendChild(btn);
	});

	// Position
	menu.style.left = `${event.clientX}px`;
	menu.style.top = `${event.clientY}px`;
	document.body.appendChild(menu);

	// Adjust if overflows viewport
	requestAnimationFrame(() => {
		const rect = menu.getBoundingClientRect();
		if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
		if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
	});

	// Close on click outside
	const closeHandler = (e) => {
		if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeHandler); }
	};
	setTimeout(() => document.addEventListener('click', closeHandler), 10);
}

// ======================== UNINSTALL + DEEP SCAN ========================

async function startUninstallFlux(app, force) {
	const row = document.getElementById(`app-row-${app.id}`);
	const confirmMsg = force
		? `⚠️ Desinstalación FORZADA de "${app.name}"\n\nEsto matará procesos (si los hay), borrará la carpeta de instalación y limpiará el registro.\n\n¿Continuar?`
		: `¿Ejecutar desinstalador oficial de "${app.name}"?`;
	
	if (!window.confirm(confirmMsg)) return;

	try {
		if (!window.api) return;
		
		// 1. UI Reactiva: Marcar como desinstalando
		if (row) row.classList.add('uninstalling');
		mostrarToast(force ? 'Forzando borrado...' : 'Ejecutando desinstalador oficial...', 'system');
		setOjoStatus(`Desinstalando ${app.name}...`);
		
		logTerminal(`[Ghost] Iniciando flujo para: ${app.name}`, 'system');
		logTerminal(`[Ghost] Comando registro: ${app.uninstallString || app.quietUninstallString}`, 'command');

		// 2. Ejecutar (el backend ahora hace polling si no es forzada)
		const result = await window.api.ghost.desinstalarApp(app, force);

		// 3. Deep Scan (Se lanza cuando el polling del registro confirma la desaparicion)
		mostrarToast('Buscando rastros en carpetas y registro...', 'system');
		setOjoStatus('Escaneando sistema en busca de restos residuales...');

		const rastros = await window.api.ghost.buscarRastrosApp(app);

		if (rastros && rastros.length > 0) {
			showLeftoversModal(app, rastros, () => {
				// Al finalizar (limpiar o cancelar), removemos el item de la lista real local
				removeAppFromLocalList(app.id);
			});
		} else {
			mostrarToast('Limpieza perfecta. No se encontraron rastros.', 'success');
			setOjoStatus('Desinstalaci├│n completa sin rastros residuales.');
			removeAppFromLocalList(app.id);
		}

	} catch (error) {
		if (row) row.classList.remove('uninstalling');
		mostrarToast(`Error al desinstalar ${app.name}`, 'error');
		logTerminal(`[Ghost] Desinstalar fallo (${app.name}): ${error.message || error}`, 'error');
	}
}

function removeAppFromLocalList(appId) {
	ghostState.appsList = ghostState.appsList.filter(a => a.id !== appId);
	const searchInput = document.getElementById('ojo-apps-search');
	const filtered = filterAppsList(searchInput?.value || '');
	renderAppsTable(filtered);
	
	const counter = document.getElementById('apps-counter');
	if (counter) counter.textContent = `${ghostState.appsList.length} aplicaciones`;
}

function showLeftoversModal(app, rastros, onFinished) {
	// Remove existing modal
	const old = document.getElementById('leftovers-modal');
	if (old) old.remove();

	const overlay = document.createElement('div');
	overlay.id = 'leftovers-modal';
	overlay.className = 'modal-overlay active';
	overlay.style.cssText = 'z-index:20000; background:rgba(0,0,0,0.7); backdrop-filter:blur(8px);';

	const modal = document.createElement('div');
	modal.className = 'mac-modal mac-glass';
	modal.style.cssText = 'width:600px; max-height:500px; text-align:left; display:flex; flex-direction:column; padding:0;';

	const header = document.createElement('div');
	header.style.cssText = 'padding:20px 24px 12px; border-bottom:1px solid rgba(255,255,255,0.08);';
	header.innerHTML = `
		<h3 style="margin:0 0 4px; font-size:16px;">­ƒöì Rastros encontrados para ${safeText(app.name)}</h3>
		<p style="margin:0; font-size:12px; color:var(--mac-text-muted);">${rastros.length} elemento(s) residual(es) detectados</p>
	`;

	const body = document.createElement('div');
	body.style.cssText = 'flex:1; overflow-y:auto; padding:12px 24px;';

	const checkAll = document.createElement('label');
	checkAll.style.cssText = 'display:flex; align-items:center; gap:8px; padding:8px 0; font-size:13px; font-weight:600; color:var(--mac-blue); cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.05); margin-bottom:8px;';
	const checkAllBox = document.createElement('input');
	checkAllBox.type = 'checkbox';
	checkAllBox.checked = true;
	checkAllBox.addEventListener('change', () => {
		body.querySelectorAll('.leftover-check').forEach(cb => { cb.checked = checkAllBox.checked; });
	});
	checkAll.appendChild(checkAllBox);
	checkAll.appendChild(document.createTextNode('Seleccionar todo'));
	body.appendChild(checkAll);

	rastros.forEach((r, i) => {
		const row = document.createElement('label');
		row.className = 'leftover-item';
		row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px 8px; font-size:12px; cursor:pointer; border-bottom:1px solid rgba(255,255,255,0.03);';
		const cb = document.createElement('input');
		cb.type = 'checkbox';
		cb.checked = true;
		cb.className = 'leftover-check';
		cb.dataset.index = i;

		const icon = r.Type === 'Registry' ? '­ƒöæ' : '­ƒôü';
		const label = document.createElement('span');
		label.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--mac-text-muted); flex:1;';
		label.innerHTML = `<span class="leftover-icon">${icon}</span> <span style="color:var(--mac-text);">[${r.Type}]</span> ${r.Path}`;
		label.title = r.Path;

		row.appendChild(cb);
		row.appendChild(label);
		body.appendChild(row);
	});

	const footer = document.createElement('div');
	footer.style.cssText = 'padding:12px 24px 20px; display:flex; gap:10px; border-top:1px solid rgba(255,255,255,0.08);';

	const cancelBtn = document.createElement('button');
	cancelBtn.className = 'mac-btn-outline';
	cancelBtn.style.flex = '1';
	cancelBtn.textContent = 'Omitir limpieza';
	cancelBtn.addEventListener('click', () => { 
		overlay.remove(); 
		if(onFinished) onFinished();
	});

	const cleanBtn = document.createElement('button');
	cleanBtn.className = 'mac-btn-primary';
	cleanBtn.style.cssText = 'flex:1; background:var(--mac-red);';
	cleanBtn.textContent = `Eliminar seleccionados`;
	cleanBtn.addEventListener('click', async () => {
		const selected = [];
		body.querySelectorAll('.leftover-check:checked').forEach(cb => {
			selected.push(rastros[Number(cb.dataset.index)]);
		});
		if (selected.length === 0) { overlay.remove(); if(onFinished) onFinished(); return; }

		cleanBtn.disabled = true;
		cleanBtn.textContent = 'Eliminando...';
		try {
			const res = await window.api.ghost.limpiarRastrosApp(selected);
			mostrarToast(`Limpieza completada: ${res.deleted} rastros eliminados.`, 'success');
			logTerminal(`[Ghost] Limpieza profunda: ${app.name} | Eliminados: ${res.deleted}`, 'system');
		} catch (err) {
			mostrarToast('Error durante la limpieza', 'error');
		}
		overlay.remove();
		if(onFinished) onFinished();
	});

	footer.appendChild(cancelBtn);
	footer.appendChild(cleanBtn);

	modal.appendChild(header);
	modal.appendChild(body);
	modal.appendChild(footer);
	overlay.appendChild(modal);

	overlay.addEventListener('click', (e) => { 
		if (e.target === overlay) {
			overlay.remove(); 
			if(onFinished) onFinished();
		}
	});
	document.body.appendChild(overlay);
}

function exportAppsCSV() {
	if (!ghostState.appsList || ghostState.appsList.length === 0) {
		mostrarToast('No hay datos para exportar. Escanea primero.', 'system');
		return;
	}
	const header = 'Nombre,Versi├│n,Tama├▒o (bytes),Fecha,Editor,Ruta Instalaci├│n';
	const rows = ghostState.appsList.map(a =>
		[a.name, a.version, a.estimatedSize || '', a.installDate || '', a.publisher || '', a.installLocation || '']
			.map(v => `"${String(v).replace(/"/g, '""')}"`)
			.join(',')
	);
	const csv = [header, ...rows].join('\n');
	const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `apps_instaladas_${new Date().toISOString().slice(0,10)}.csv`;
	a.click();
	URL.revokeObjectURL(url);
	mostrarToast('Lista exportada a CSV', 'success');
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
			ejecutarEscaneoFantasma('C:\\', false, { forceFresh: true });
		});
	}

	const upBtn = document.getElementById('ojo-btn-disk-up');
	if (upBtn) upBtn.addEventListener('click', subirNivelDisco);

	const appsBtn = document.getElementById('ojo-btn-apps');
	if (appsBtn) appsBtn.addEventListener('click', cargarAppsFantasma);

	// Apps table: sortable headers
	document.querySelectorAll('.apps-th-sortable').forEach(th => {
		th.addEventListener('click', () => {
			const col = th.getAttribute('data-sort');
			if (appsSortColumn === col) {
				appsSortOrder = appsSortOrder === 'asc' ? 'desc' : 'asc';
			} else {
				appsSortColumn = col;
				appsSortOrder = 'asc';
			}
			const searchInput = document.getElementById('ojo-apps-search');
			const filtered = filterAppsList(searchInput?.value || '');
			renderAppsTable(filtered);
		});
	});

	// Apps table: search filter
	const appsSearch = document.getElementById('ojo-apps-search');
	if (appsSearch) {
		appsSearch.addEventListener('input', (event) => {
			const filtered = filterAppsList(event.target.value || '');
			renderAppsTable(filtered);
			const counter = document.getElementById('apps-counter');
			if (counter) counter.textContent = `${filtered.length}/${ghostState.appsList.length} aplicaciones`;
			setOjoStatus(`Aplicaciones filtradas: ${filtered.length}/${ghostState.appsList.length}`);
		});
	}

	// CSV export button
	const csvBtn = document.getElementById('btn-export-apps');
	if (csvBtn) csvBtn.addEventListener('click', exportAppsCSV);

	document.querySelectorAll('.ojo-tab-btn').forEach((btn) => {
		btn.addEventListener('click', () => {
			setOjoScreen(btn.getAttribute('data-ojo-screen') || 'search');
		});
	});
}
