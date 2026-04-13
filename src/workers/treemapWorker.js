/**
 * Treemap Worker - Motor de Cálculo de Alto Rendimiento (WizTree Style)
 * Implementa Squarified Treemap recursivo con Level of Detail (LoD)
 */

self.onmessage = function (e) {
    const { items, width, height, maxDepth = 4, minPixelArea = 2 } = e.data;

    if (!items || !items.length) {
        self.postMessage({ buffer: new Float32Array(0), count: 0 });
        return;
    }

    const results = []; // Guardaremos [x, y, w, h, isDir, colorHue, depth, idStrIndex]
    
    // Altura y anchura iniciales
    const rect = { x: 0, y: 0, w: width, h: height };
    
    // Iniciamos recursión
    calculateRecursive(items, rect, rect, 0, maxDepth, results, minPixelArea);

    // Convertimos a Float32Array para transferencia eficiente
    // Cada nodo ocupa 8 slots en el array
    const buffer = new Float32Array(results.length * 8);
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const offset = i * 8;
        buffer[offset + 0] = r.x;
        buffer[offset + 1] = r.y;
        buffer[offset + 2] = r.w;
        buffer[offset + 3] = r.h;
        buffer[offset + 4] = r.isDir ? 1 : 0;
        buffer[offset + 5] = r.hue || 0;
        buffer[offset + 6] = r.depth;
        buffer[offset + 7] = r.index; // Índice en el array original de items para recuperar metadata
    }

    self.postMessage({ buffer, count: results.length }, [buffer.buffer]);
};

function calculateRecursive(items, mathRect, renderRect, depth, maxDepth, results, minPixelArea) {
    if (depth >= maxDepth || mathRect.w < 1 || mathRect.h < 1) return;

    // 1. Filtrar y normalizar
    let totalSize = 0;
    const candidates = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const size = Math.max(0, Number(item.sizeBytes || 0));
        if (size <= 0) continue;
        totalSize += size;
        const globalIndex = Number.isFinite(item.__treemapIndex) ? item.__treemapIndex : i;
        candidates.push({ item, size, index: globalIndex });
    }

    if (totalSize === 0) return;

    // 2. Ordenar por tamaño (descendente)
    candidates.sort((a, b) => b.size - a.size);

    // 3. Squarify actual nivel
    const totalArea = mathRect.w * mathRect.h;
    const scale = totalArea / totalSize;
    
    // Mapear candidatos a áreas
    const nodes = candidates.map(c => ({
        ...c,
        area: c.size * scale
    }));

    const levelRects = squarify(nodes, mathRect.x, mathRect.y, mathRect.w, mathRect.h);

    // 4. Procesar resultados y recursión
    for (const r of levelRects) {
        if (r.w * r.h < minPixelArea) continue; // LoD: ignorar cosas minúsculas

        const isDir = !!(r.item.isDir || (r.item.children && r.item.children.length > 0));
        
        // Determinar Categoría de color basado en extensión
        let catId = 5; // Default (Otros)
        if (isDir) {
            catId = 0; // Carpeta
        } else {
            // Usamos la función que ya existe al final del archivo
            catId = getCategoryFromExtension(r.item.name || "");
        }

        const rendX = renderRect.x + (r.x - mathRect.x) * (renderRect.w / mathRect.w);
        const rendY = renderRect.y + (r.y - mathRect.y) * (renderRect.h / mathRect.h);
        const rendW = r.w * (renderRect.w / mathRect.w);
        const rendH = r.h * (renderRect.h / mathRect.h);

        if (rendW > 0.5 && rendH > 0.5) {
            results.push({
                x: rendX, y: rendY, w: rendW, h: rendH,
                isDir: isDir,
                hue: catId, // Reutilizamos el slot de hue para el catId
                depth: depth,
                index: r.index
            });
        }

        // Si es directorio y tiene hijos, profundizar
        if (isDir && r.item.children && r.item.children.length > 0 && depth < maxDepth - 1) {
            const childRenderRect = { x: rendX + 2, y: rendY + 18, w: rendW - 4, h: rendH - 20 };
            const childMathRect = { x: r.x, y: r.y, w: r.w, h: r.h };
            if (childRenderRect.w > 5 && childRenderRect.h > 5) {
                calculateRecursive(r.item.children, childMathRect, childRenderRect, depth + 1, maxDepth, results, minPixelArea);
            }
        }
    }
}

function squarify(nodes, x, y, w, h) {
    const rects = [];
    let rect = { x, y, w, h };
    let row = [];

    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const side = Math.min(rect.w, rect.h);
        
        if (row.length === 0) {
            row.push(node);
            continue;
        }

        if (worstAspectRatio([...row, node], side) <= worstAspectRatio(row, side)) {
            row.push(node);
        } else {
            rect = layoutRow(row, rect, rects);
            row = [node];
        }
    }
    if (row.length > 0) layoutRow(row, rect, rects);
    return rects;
}

function worstAspectRatio(row, side) {
    if (!row.length) return Infinity;
    const areas = row.map(n => n.area);
    const sum = areas.reduce((a, b) => a + b, 0);
    const max = Math.max(...areas);
    const min = Math.min(...areas);
    return Math.max((side ** 2 * max) / (sum ** 2), (sum ** 2) / (side ** 2 * min));
}

function layoutRow(row, rect, rects) {
    const rowArea = row.reduce((s, n) => s + n.area, 0);
    const isHorizontal = rect.w >= rect.h;
    
    if (isHorizontal) {
        const rowWidth = rowArea / rect.h;
        let curY = rect.y;
        for (const n of row) {
            const h = n.area / rowWidth;
            rects.push({ ...n, x: rect.x, y: curY, w: rowWidth, h });
            curY += h;
        }
        return { x: rect.x + rowWidth, y: rect.y, w: Math.max(0, rect.w - rowWidth), h: rect.h };
    } else {
        const rowHeight = rowArea / rect.w;
        let curX = rect.x;
        for (const n of row) {
            const w = n.area / rowHeight;
            rects.push({ ...n, x: curX, y: rect.y, w, h: rowHeight });
            curX += w;
        }
        return { x: rect.x, y: rect.y + rowHeight, w: rect.w, h: Math.max(0, rect.h - rowHeight) };
    }
}

function getCategoryFromExtension(name) {
    const ext = name.split('.').pop().toLowerCase();
    switch (ext) {
        case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp': return 1; // Imágenes
        case 'mp4': case 'mkv': case 'avi': case 'mov': return 2; // Vídeo
        case 'mp3': case 'wav': case 'flac': case 'aac': return 3; // Audio
        case 'exe': case 'msi': case 'dll': case 'sys': return 4; // Sistema/Apps
        case 'pdf': case 'doc': case 'docx': case 'txt': case 'zip': case 'rar': case '7z': return 5; // Docs/Otros
        default: return 5;
    }
}
