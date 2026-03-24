const fs = require('fs');

// 1. STYLE.CSS
let css = fs.readFileSync('src/style.css', 'utf8');
if (!css.includes('.disk-grid-row')) {
    css += \\n\n/* --- WIZTREE DATA GRID STYLES --- */
.disk-grid-row {
    position: absolute;
    left: 0;
    width: 100%;
    margin: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-size: 11px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    cursor: pointer;
    transition: background 0.1s;
    color: var(--mac-text);
}
.disk-grid-row:hover {
    background: rgba(10, 132, 255, 0.2);
}
.disk-grid-name {
    flex: 5;
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.disk-grid-bar-wrap {
    flex: 2;
    position: relative;
    height: 14px;
    background: rgba(0,0,0,0.3);
    border-radius: 2px;
    overflow: hidden;
    margin: 0 10px;
    display: flex;
    align-items: center;
}
.disk-grid-bar-fill {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    background: linear-gradient(90deg, #0A84FF, #5b5bd6);
    z-index: 1;
}
.disk-grid-bar-text {
    position: relative;
    z-index: 2;
    font-size: 9px;
    width: 100%;
    text-align: right;
    padding-right: 4px;
    color: rgba(255,255,255,0.9);
}
.disk-grid-size {
    flex: 2;
    text-align: right;
    color: rgba(255,255,255,0.7);
}

.ext-row {
    display: flex;
    align-items: center;
    padding: 6px 12px;
    font-size: 11px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    color: rgba(255,255,255,0.9);
}
.ext-color-box {
    width: 12px;
    height: 12px;
    border-radius: 2px;
    margin-right: 8px;
}
\;
    fs.writeFileSync('src/style.css', css);
}

// 2. INDEX.HTML
let html = fs.readFileSync('src/index.html', 'utf8');
const searchHtml = '<div id="ojo-disk-content"';
const replaceHtml = \                        <div id="ojo-disk-content" style="display: flex; flex-direction: column; flex: 1; min-height: 0;">
                            <!-- Panel dividido superior -->
                            <div style="display: flex; gap: 15px; flex: 1; min-height: 0; margin-bottom: 15px;">
                                <!-- Panel izquierdo (Tree View) -->
                                <div style="flex: 7; min-width: 0; display: flex; flex-direction: column; background: rgba(0,0,0,0.3); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); overflow: hidden;">
                                    <div style="display: flex; padding: 6px 12px; font-size: 11px; font-weight: 600; color: #888; border-bottom: 1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.5);">
                                        <div style="flex: 5;">Nombre</div>
                                        <div style="flex: 2; text-align: center;">% de Padre</div>
                                        <div style="flex: 2; text-align: right;">Tamaño</div>
                                    </div>
                                    <div id="ojo-disk-results" style="flex: 1; position: relative;"></div>
                                </div>
                                
                                <!-- Panel derecho (Extensiones) -->
                                <div style="flex: 3; min-width: 0; display: flex; flex-direction: column; background: rgba(0,0,0,0.3); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); overflow: hidden;">
                                    <div style="display: flex; padding: 6px 12px; font-size: 11px; font-weight: 600; color: #888; border-bottom: 1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.5);">
                                        <div style="flex: 4;">Extensión</div>
                                        <div style="flex: 2; text-align: right;">%</div>
                                        <div style="flex: 3; text-align: right;">Tamaño</div>
                                    </div>
                                    <div id="ojo-disk-extensions" style="flex: 1; overflow-y: auto; overflow-x: hidden;"></div>
                                </div>
                            </div>

                            <!-- Treemap inferior -->
                            <div style="flex: 1; min-height: 150px; background: rgba(0,0,0,0.3); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); overflow: hidden; display: flex; flex-direction: column;">
                                <div style="padding: 4px 12px; font-size: 11px; font-weight: 600; color: #888; border-bottom: 1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.5);">Treemap Visual</div>
                                <div id="ojo-disk-treemap" class="disk-treemap" style="flex: 1; padding: 10px; overflow: hidden;"></div>
                            </div>
                        </div>\;

const htmlStart = html.indexOf(searchHtml);
if (htmlStart !== -1) {
    const nextScreen = html.indexOf('<div id="ojo-screen-apps"', htmlStart);
    html = html.substring(0, htmlStart) + replaceHtml + '\n\n                    </div>\n                </div>\n\n                ' + html.substring(nextScreen);
    fs.writeFileSync('src/index.html', html);
}

// 3. RENDERER.JS
// Extract the current DOM-based treemap logic
let js = fs.readFileSync('src/renderer.js', 'utf8');

const regexEscaneo = /function renderEscaneoDisco\(payload\) \{([\s\S]*?)\n\}\n\nfunction subirNivel/;
const match = js.match(regexEscaneo);

if (match) {
    // Original body of renderEscaneoDisco is in match[1]
    
    // We will place all 3 functions:
    const newFns = \unction renderVirtualDiskList(container, items, currentPath) {
    container.innerHTML = '';
    const totalItems = Array.isArray(items) ? items : [];
    if (!totalItems.length) {
        container.innerHTML = '<div style="padding:10px;font-size:12px;color:#888;">No hay datos de escaneo.</div>';
        return;
    }

    const rowHeight = 26; // Altura ultra reducida para estilo de datos tipo WizTree
    const bufferRows = 10;

    const viewport = document.createElement('div');
    viewport.className = 'disk-virtual-viewport';
    const spacer = document.createElement('div');
    spacer.className = 'disk-virtual-spacer';
    spacer.style.height = \\px\;
    const layer = document.createElement('div');
    layer.className = 'disk-virtual-layer';
    viewport.appendChild(spacer);
    viewport.appendChild(layer);
    container.appendChild(viewport);

    let rafId = 0;
    const renderSlice = () => {
        rafId = 0;
        const viewHeight = viewport.clientHeight || 400;
        const scrollTop = viewport.scrollTop || 0;
        const start = Math.max(0, Math.floor(scrollTop / rowHeight) - bufferRows);
        const visibleCount = Math.ceil(viewHeight / rowHeight) + (bufferRows * 2);
        const end = Math.min(totalItems.length, start + visibleCount);

        layer.innerHTML = '';
        const fragment = document.createDocumentFragment();
        for (let i = start; i < end; i++) {
            const item = totalItems[i];
            const pct = Math.max(0.1, Math.min(100, Number(item.percent || 0)));
            const row = document.createElement('div');
            row.className = 'disk-grid-row';
            row.style.transform = \	ranslateY(\px)\;
            row.style.height = \\px\;
            row.innerHTML = \
                <div class="disk-grid-name">
                    <span style="font-size:12px; opacity:0.8;">\</span>
                    \
                </div>
                <div class="disk-grid-bar-wrap">
                    <div class="disk-grid-bar-fill" style="width:\%"></div>
                    <div class="disk-grid-bar-text">\%</div>
                </div>
                <div class="disk-grid-size">\</div>
            \;
            row.addEventListener('click', () => {
                if (!item.fullPath || item.isDir === false) return;
                if (item.fullPath.toLowerCase() === currentPath.toLowerCase()) return;
                ejecutarEscaneoFantasma(item.fullPath, true);
            });
            fragment.appendChild(row);
        }
        layer.appendChild(fragment);
    };

    viewport.addEventListener('scroll', () => {
        if (rafId) return;
        rafId = window.requestAnimationFrame(renderSlice);
    }, { passive: true });

    renderSlice();
}

function renderDiskExtensions(container, extensions) {
    if (!container) return;
    container.innerHTML = '';
    if (!extensions || !extensions.length) {
        container.innerHTML = '<div style="padding:10px;font-size:12px;color:#888;">Sin datos de extensión.</div>';
        return;
    }
    
    const fragment = document.createDocumentFragment();
    extensions.forEach((ext, i) => {
        const hue = (i * 37) % 360;
        const color = \hsl(\ 70% 50%)\;
        const pct = Math.max(0.1, Math.min(100, Number(ext.percent || 0)));
        
        const row = document.createElement('div');
        row.className = 'ext-row';
        row.innerHTML = \
            <div style="flex: 4; display:flex; align-items:center;">
                <div class="ext-color-box" style="background:\;"></div>
                <span style="font-weight:600; text-transform:uppercase;">\</span>
            </div>
            <div style="flex: 2; text-align: right; opacity:0.8;">\%</div>
            <div style="flex: 3; text-align: right; opacity:0.9;">\</div>
        \;
        fragment.appendChild(row);
    });
    container.appendChild(fragment);
}

function renderEscaneoDisco(payload) {
    const container = document.getElementById('ojo-disk-results');
    const treemap = document.getElementById('ojo-disk-treemap');
    const breadcrumb = document.getElementById('ojo-disk-breadcrumb');
    const extContainer = document.getElementById('ojo-disk-extensions');
    
    if (!container) return;
    container.innerHTML = '';
    if (treemap) treemap.innerHTML = '';
    if (extContainer) extContainer.innerHTML = '';

    const currentPath = ghostState.diskPathStack[ghostState.diskPathStack.length - 1] || 'C:\\\\';
    if (breadcrumb) {
        breadcrumb.innerHTML = '';
        ghostState.diskPathStack.forEach((p, idx) => {
            const node = document.createElement('button');
            node.className = 'disk-crumb';
            node.textContent = idx === 0 ? p : (p.split('\\\\').filter(Boolean).slice(-1)[0] || p);
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
        container.innerHTML = '<div style="padding:10px;font-size:12px;color:#888;">No hay datos de escaneo.</div>';
        return;
    }

    // ORIGINAL DOM TREEMAP LOGIC IMPORTED
    if (treemap) {
        const tmFragment = document.createDocumentFragment();
        items.slice(0, 180).forEach((item, idx) => {
            const tile = document.createElement('button');
            tile.className = 'disk-tile';
            const pct = Math.max(1, Math.min(100, Number(item.percent || 0)));
            tile.style.flex = \\ 1 140px\;
            tile.style.minHeight = \\px\;
            tile.style.background = \linear-gradient(135deg, hsla(\,75%,48%,0.78), hsla(\,80%,28%,0.85))\;
            tile.innerHTML = \
                <div class="disk-tile-name">\</div>
                <div class="disk-tile-meta">\ • \%</div>
            \;
            tile.title = item.fullPath || item.name || '';
            tile.addEventListener('click', () => {
                if (!item.fullPath) return;
                ejecutarEscaneoFantasma(item.fullPath, true);
            });
            tmFragment.appendChild(tile);
        });
        treemap.appendChild(tmFragment);
    }

    if (extContainer && payload.extensions) {
        renderDiskExtensions(extContainer, payload.extensions);
    }

    renderVirtualDiskList(container, items, currentPath);
}
\nfunction subirNivel/;
    
    js = js.replace(regexEscaneo, newFns);
    fs.writeFileSync('src/renderer.js', js);
} else {
    console.log("no match found for renderEscaneoDisco");
}
