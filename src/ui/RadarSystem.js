function escapeHtml(input) {
    return String(input || '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value <= 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    const precision = unitIndex === 0 ? 0 : (size >= 100 ? 0 : 1);
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function resolveHeatmapContainer(containerId) {
    const preferred = document.querySelector('.radar-view') || document.getElementById('radar-container');
    if (preferred) return preferred;
    return document.getElementById(containerId);
}

function normalizeTreeData(treeData) {
    if (!Array.isArray(treeData)) return [];

    return treeData
        .map((item, index) => {
            const fullPath = String(item?.fullPath || item?.name || 'Ruta desconocida');
            const sizeBytes = Math.max(0, Number(item?.sizeBytes) || 0);
            const rawName = String(item?.name || '').trim();
            const name = rawName || fullPath.split('\\').filter(Boolean).pop() || fullPath;

            return {
                id: String(item?.id || `heat-${index}`),
                fullPath,
                name,
                sizeBytes
            };
        })
        .sort((a, b) => b.sizeBytes - a.sizeBytes)
        .slice(0, 30);
}

function getHeatToneClass(percentOfMax) {
    if (percentOfMax > 70) return 'is-hot';
    if (percentOfMax > 30) return 'is-warm';
    return 'is-cool';
}

export function initRadarSystem({
    containerId = 'network-radar',
    statusId = 'network-radar-status',
    onNotify = () => {},
    onLog = () => {}
} = {}) {
    const container = resolveHeatmapContainer(containerId);
    const statusEl = document.getElementById(statusId);

    if (!container) {
        return {
            renderHeatmap: () => {},
            destroy: () => {}
        };
    }

    let destroyed = false;

    const setStatus = (message) => {
        if (statusEl) statusEl.textContent = message;
    };

    const renderHeatmap = (treeData = []) => {
        if (destroyed) return;

        const items = normalizeTreeData(treeData);
        if (items.length === 0) {
            container.innerHTML = '<div class="heatmap-empty">Ejecuta un escaneo de disco para cargar el mapa de calor.</div>';
            setStatus('Heatmap en espera: sin datos de disco.');
            return;
        }

        const maxSize = Math.max(1, ...items.map((item) => item.sizeBytes));
        const totalSize = Math.max(1, items.reduce((sum, item) => sum + item.sizeBytes, 0));

        const rows = items.map((item, index) => {
            const percentOfMax = (item.sizeBytes / maxSize) * 100;
            const percentOfTotal = (item.sizeBytes / totalSize) * 100;
            const toneClass = getHeatToneClass(percentOfMax);

            return `
                <article class="heatmap-item" data-id="${escapeHtml(item.id)}">
                    <div class="heatmap-item-top">
                        <span class="heatmap-rank">#${index + 1}</span>
                        <span class="heatmap-name" title="${escapeHtml(item.fullPath)}">${escapeHtml(item.name)}</span>
                        <span class="heatmap-size">${formatBytes(item.sizeBytes)}</span>
                    </div>
                    <div class="heatmap-item-meta">
                        <span class="heatmap-path">${escapeHtml(item.fullPath)}</span>
                        <span class="heatmap-percent">${percentOfTotal.toFixed(1)}%</span>
                    </div>
                    <div class="heatmap-bar-container">
                        <div class="heatmap-bar ${toneClass}" style="width:${percentOfMax.toFixed(2)}%"></div>
                    </div>
                </article>
            `;
        }).join('');

        container.innerHTML = `<div class="radar-heatmap">${rows}</div>`;
        setStatus(`Heatmap de disco activo: Top ${items.length} carpetas raiz.`);
    };

    const onDiskHeatmapUpdate = (event) => {
        const payload = event?.detail;
        if (Array.isArray(payload)) {
            renderHeatmap(payload);
            return;
        }

        renderHeatmap(payload?.items || []);
    };

    window.addEventListener('disk-heatmap:update', onDiskHeatmapUpdate);

    renderHeatmap([]);
    onNotify('Radar en modo Heatmap de Disco', 'system');
    onLog('[Radar] Heatmap liviano inicializado', 'system');

    return {
        renderHeatmap,
        destroy() {
            destroyed = true;
            window.removeEventListener('disk-heatmap:update', onDiskHeatmapUpdate);
            container.innerHTML = '';
            setStatus('Heatmap detenido.');
        }
    };
}