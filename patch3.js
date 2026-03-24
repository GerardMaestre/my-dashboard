const fs = require('fs');
let content = fs.readFileSync('src/renderer.js', 'utf8');

const sIdx = content.indexOf("const uninstallBtn = document.createElement('button');");
const eIdx = content.indexOf("card.appendChild(actions);", sIdx);

if (sIdx !== -1 && eIdx !== -1) {
    const replaceStr = `
        const startUninstallFlux = async (force) => {
            const confirmMsg = force ? \`Forzar desinstalacion destructiva de \${app.name} (puede romper cosas)?\` : \`Ejecutar desinstalador de \${app.name}?\`;
            if (!window.confirm(confirmMsg)) return;

            try {
                stdBtn.disabled = true;
                forceBtn.disabled = true;
                stdBtn.textContent = force ? 'Forzando...' : 'Desinstalando...';

                // 1. Desinstalar (Normal o Forzado)
                mostrarToast(force ? 'Forzando borrado... esto puede tardar' : 'Por favor completa el desinstalador oficial', 'system');
                const result = await api.desinstalarApp(app, force);

                // 2. Busqueda Profunda (Geek Uninstaller style)
                mostrarToast('Iniciando escaneo Geek (Rastros profundos)...', 'system');
                if (!force) stdBtn.textContent = 'Escaneando...';
                
                const rastros = await api.buscarRastrosApp(app);

                if (rastros && rastros.length > 0) {
                    const rastrosList = rastros.map(r => \`[\${r.Type}] \${r.Path}\`).join('\\n');
                    const cleanOk = window.confirm(\`¡Geek detecto \${rastros.length} rastros huerfanos para \${app.name}!\\n\\n\${rastrosList.substring(0, 800)}...\\n\\n¿Deseas eliminar estos elementos residuales permanentemente?\`);
                    
                    if (cleanOk) {
                        if (!force) stdBtn.textContent = 'Limpiando...';
                        const cleanRes = await api.limpiarRastrosApp(rastros);
                        mostrarToast(\`Limpieza completada. \${cleanRes.deleted} rastros eliminados.\`, 'success');
                        logTerminal(\`[Ghost] Limpieza profunda: \${app.name} | Eliminados: \${cleanRes.deleted}\`, 'system');
                    }
                } else {
                    mostrarToast('El desinstalador de esta app fue muy limpio. No se encontraron rastros.', 'success');
                }

                await cargarAppsFantasma();
            } catch (error) {
                mostrarToast(\`Error al desinstalar \${app.name}\`, 'error');
                logTerminal(\`[Ghost] Desinstalar fallo (\${app.name}): \${error.message || error}\`, 'error');
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
`;
    content = content.substring(0, sIdx) + replaceStr + content.substring(eIdx + "card.appendChild(actions);".length);
    fs.writeFileSync('src/renderer.js', content, 'utf8');
    console.log('Renderer patched!');
} else {
    console.log('Markers not found!');
}
