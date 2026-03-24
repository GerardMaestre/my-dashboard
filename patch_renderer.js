const fs = require('fs');

let content = fs.readFileSync('src/renderer.js', 'utf8');

const targetStr = 
                const uninstallBtn = document.createElement('button');
                uninstallBtn.className = 'mac-action-btn stop';
                uninstallBtn.textContent = 'Auto-Desinstalar';
                uninstallBtn.addEventListener('click', async () => {
                        const ok = window.confirm(\Desinstalar automaticamente \\\ y limpiar rastros detectables?\);
                        if (!ok) return;
                        try {
                                uninstallBtn.disabled = true;
                                uninstallBtn.textContent = 'Procesando...';
                                const result = await api.desinstalarApp(app);
                                if (result?.started) {
                                        mostrarToast(\Desinstalacion automatica finalizada para \\\\, 'success');
                                        logTerminal(\[Ghost] Auto-desinstalacion: \\\ | exit:\\\ | limpieza:\\\\, 'system');
                                } else {
                                        mostrarToast(\Proceso no confirmado para \\\\, 'error');
                                }
                                await cargarAppsFantasma();
                        } catch (error) {
                                mostrarToast(\No se pudo desinstalar \\\\, 'error');
                                logTerminal(\[Ghost] Desinstalar fallo (\\\): \\\\, 'error');
                        } finally {
                                uninstallBtn.disabled = false;
                                uninstallBtn.textContent = 'Auto-Desinstalar';
                        }
                });

                actions.appendChild(locateBtn);
                actions.appendChild(uninstallBtn);
                card.appendChild(actions);
;

const replaceStr = 
                const startUninstallFlux = async (force) => {
                    const confirmMsg = force ? \Forzar desinstalacion destructiva de \\\ (puede romper cosas)?\ : \Ejecutar desinstalador de \\\?\;
                    if (!window.confirm(confirmMsg)) return;

                    try {
                        stdBtn.disabled = true;
                        forceBtn.disabled = true;
                        stdBtn.textContent = 'Desinstalando...';

                        // 1. Desinstalar (Normal o Forzado)
                        mostrarToast(force ? 'Forzando borrado... esto puede tardar' : 'Por favor completa el desinstalador oficial', 'system');
                        const result = await api.desinstalarApp(app, force);

                        // 2. Busqueda Profunda (Geek Uninstaller style)
                        mostrarToast('Iniciando escaneo Geek (Rastros profundos)...', 'system');
                        stdBtn.textContent = 'Escaneando...';
                        const rastros = await api.buscarRastrosApp(app);

                        if (rastros && rastros.length > 0) {
                            const rastrosList = rastros.map(r => \[\\\] \\\\).join('\\n');
                            const cleanOk = window.confirm(\\\\ rastros encontrados de \\\:\\n\\n\\\...\\n\\n¿Deseas eliminar estos elementos residuales?\);
                            
                            if (cleanOk) {
                                stdBtn.textContent = 'Limpiando...';
                                const cleanRes = await api.limpiarRastrosApp(rastros);
                                mostrarToast(\Limpieza completada. \\\ rastros eliminados.\, 'success');
                                logTerminal(\[Ghost] Limpieza profunda: \\\ | Eliminados: \\\\, 'system');
                            }
                        } else {
                            mostrarToast('El desinstalador fue muy limpio. No se encontraron rastros.', 'success');
                        }

                        await cargarAppsFantasma();
                    } catch (error) {
                        mostrarToast(\Error al desinstalar \\\\, 'error');
                        logTerminal(\[Ghost] Desinstalar fallo (\\\): \\\\, 'error');
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
;

const cleanedContent = content.replace(/\r\n/g, '\n');
const cleanedTarget = targetStr.replace(/\r\n/g, '\n');

if (cleanedContent.includes(cleanedTarget.trim())) {
    const finalContent = cleanedContent.replace(cleanedTarget.trim(), replaceStr.trim());
    fs.writeFileSync('src/renderer.js', finalContent, 'utf8');
    console.log('Renderer patched correctly.');
} else {
    // try line by line matching or index based
    console.log('Target block not perfectly matched due to spacing, trying fallback method');
    
    const s1 = content.indexOf("const uninstallBtn = document.createElement('button');");
    const e1 = content.indexOf("card.appendChild(actions);", s1);
    
    if (s1 !== -1 && e1 !== -1) {
        const finalContent = content.substring(0, s1) + replaceStr + content.substring(e1 + "card.appendChild(actions);".length);
        fs.writeFileSync('src/renderer.js', finalContent, 'utf8');
        console.log('Renderer patched via fallback indexing.');
    } else {
        console.log('Failed to find markers.');
    }
}
