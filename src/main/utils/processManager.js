const { spawn } = require('child_process');

/**
 * Ejecuta un script de manera segura usando spawn en lugar de execSync.
 * 
 * @param {string} command El comando o ruta del script.
 * @param {string[]} args Array de argumentos.
 * @param {object} options Opciones adicionales (ej. timeout, cwd).
 * @returns {Promise<string>} La salida estándar combinada.
 */
async function runScriptSafe(command, args = [], options = { timeout: 30000 }) {
    return new Promise((resolve, reject) => {
        let stdoutData = '';
        let stderrData = '';

        // shell: true ayuda a ejecutar .bat en Windows
        const spawnOptions = { shell: true, ...options };
        const proc = spawn(command, args, spawnOptions);

        // Timeout para evitar procesos zombis
        const timer = setTimeout(() => {
            try {
                proc.kill('SIGKILL');
            } catch (e) {
                // Ignore kill errors
            }
            reject(new Error(`Timeout excedido (${options.timeout}ms) para ${command}`));
        }, options.timeout);

        proc.stdout.on('data', (data) => {
            stdoutData += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderrData += data.toString();
        });

        proc.on('close', (code) => {
            clearTimeout(timer);
            if (code !== 0) {
                reject(new Error(`Proceso falló con código ${code}: ${stderrData}`));
            } else {
                resolve(stdoutData.trim());
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`Error al iniciar proceso: ${err.message}`));
        });
    });
}

module.exports = { runScriptSafe };
