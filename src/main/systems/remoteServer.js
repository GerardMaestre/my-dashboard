const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { Server } = require('socket.io');

const logger = require('../utils/logger');

class RemoteServer {
    constructor(managers = {}, options = {}) {
        this.managers = managers;
        this.host = options.host || '0.0.0.0';
        this.port = Number(options.port) || 3000;
        this.telemetryIntervalMs = Number(options.telemetryIntervalMs) || 2000;

        this.webApp = null;
        this.httpServer = null;
        this.io = null;

        this.telemetryTimer = null;
        this.telemetryTickInFlight = false;
        this.activeProcesses = new Map();

        this.uiRoot = path.resolve(__dirname, '..', '..');
        this.nodeModulesRoot = path.resolve(this.uiRoot, '..', 'node_modules');

        this.ignoredDirs = new Set([
            'env_python',
            'node_modules',
            '.git',
            '__pycache__',
            '.venv',
            'venv',
            'lib',
            'libs',
            'site-packages',
            'scripts',
            'target'
        ]);
    }

    getStorageDir() {
        if (this.managers?.config?.storageDir) return this.managers.config.storageDir;
        return path.resolve(this.uiRoot, '..', 'mis_scripts');
    }

    normalizeRelativePath(fileName = '') {
        return String(fileName || '').replace(/\\/g, '/').replace(/^\/+/, '');
    }

    normalizeMode(mode) {
        return String(mode || 'internal').toLowerCase() === 'external' ? 'external' : 'internal';
    }

    normalizeDeclaredMode(value = '') {
        const mode = String(value || '').trim().toLowerCase();
        if (mode === 'external' || mode === 'externo' || mode === 'visual externo') return 'external';
        if (mode === 'internal' || mode === 'interno' || mode === 'integrado') return 'internal';
        return '';
    }

    readDeclaredMode(scriptPath) {
        try {
            const content = fs.readFileSync(scriptPath, 'utf8');
            const headLines = content.substring(0, 1200).split(/\r?\n/);

            for (const rawLine of headLines) {
                const line = String(rawLine || '').trim();
                if (!line) continue;

                const clean = line.replace(/^\s*(#|::|\/\/)+\s*/, '');
                const match = clean.match(/^(MODE|MODO)\s*:\s*(.+)$/i);
                if (!match) continue;

                const parsed = this.normalizeDeclaredMode(match[2]);
                if (parsed) return parsed;
            }
        } catch (_error) {
            // Ignore parsing issues and fallback to requested mode.
        }

        return '';
    }

    resolveScriptPath(fileName = '') {
        const storageDir = this.getStorageDir();
        const normalized = this.normalizeRelativePath(fileName);
        if (!normalized) return null;

        const candidate = path.resolve(storageDir, normalized.replace(/\//g, path.sep));
        const rootWithSep = storageDir.endsWith(path.sep) ? storageDir : `${storageDir}${path.sep}`;
        if (candidate !== storageDir && !candidate.startsWith(rootWithSep)) return null;

        return { normalized, absolutePath: candidate };
    }

    listScripts() {
        const storageDir = this.getStorageDir();
        if (!fs.existsSync(storageDir)) return [];

        const maxResults = 12000;
        const out = [];

        const walk = (dir, base = '') => {
            if (out.length >= maxResults) return;

            let dirents = [];
            try {
                dirents = fs.readdirSync(dir, { withFileTypes: true });
            } catch (_error) {
                return;
            }

            for (const dirent of dirents) {
                if (out.length >= maxResults) break;

                const absPath = path.resolve(dir, dirent.name);
                const relPath = path.posix.join(base, dirent.name);
                const lowerName = dirent.name.toLowerCase();
                const lowerRel = relPath.toLowerCase();

                if (dirent.isDirectory()) {
                    if (this.ignoredDirs.has(lowerName)) continue;
                    if (lowerRel.includes('/env_python/') || lowerRel.includes('/node_modules/')) continue;
                    walk(absPath, relPath);
                    continue;
                }

                if (/\.(py|bat|cmd|sh|exe)$/i.test(dirent.name)) {
                    out.push(relPath);
                }
            }
        };

        walk(storageDir);
        return out;
    }

    readScriptMeta(fileName = '') {
        const resolved = this.resolveScriptPath(fileName);
        if (!resolved) throw new Error('fileName is required');
        if (!fs.existsSync(resolved.absolutePath)) throw new Error('Script not found');

        const content = fs.readFileSync(resolved.absolutePath, 'utf8');
        return content.substring(0, 1000).split(/\r?\n/);
    }

    registerSocketEvent(socket, eventName, handler) {
        socket.on(eventName, async (payload, ack) => {
            try {
                const data = await handler.call(this, payload || {}, socket);
                if (typeof ack === 'function') ack({ ok: true, data });
            } catch (error) {
                logger.error(`[RemoteServer] ${eventName} failed: ${error.message}`);
                if (typeof ack === 'function') ack({ ok: false, error: error.message });
            }
        });
    }

    async handleRunScript(payload) {
        const fileName = payload?.fileName || payload?.command;
        const resolved = this.resolveScriptPath(fileName);
        if (!resolved) throw new Error('fileName is required');

        const requestedMode = this.normalizeMode(payload?.mode);
        const declaredMode = this.readDeclaredMode(resolved.absolutePath);
        const finalMode = (requestedMode === 'external' || declaredMode === 'external') ? 'external' : 'internal';

        const appManager = this.managers?.appManager;
        if (!appManager) throw new Error('AppManager unavailable');

        const runner = typeof appManager.runScript === 'function'
            ? appManager.runScript.bind(appManager)
            : (typeof appManager.executeScript === 'function' ? appManager.executeScript.bind(appManager) : null);

        if (!runner) throw new Error('AppManager runner method unavailable');

        const result = await runner(resolved.normalized, payload?.args, {
            mode: finalMode,
            onOutput: (chunk) => {
                if (!this.io) return;
                this.io.emit('process-output', {
                    fileName: resolved.normalized,
                    type: chunk?.type || 'success',
                    message: String(chunk?.message || '')
                });
            },
            onExit: ({ code }) => {
                this.activeProcesses.delete(resolved.normalized);
                if (!this.io) return;
                this.io.emit('process-exit', {
                    fileName: resolved.normalized,
                    code: Number.isInteger(code) ? code : -1
                });
            }
        });

        if (result?.child) {
            this.activeProcesses.set(resolved.normalized, result.child);
        }

        return {
            started: !!result?.started,
            pid: result?.pid || null,
            mode: result?.mode || finalMode,
            forcedExternal: finalMode === 'external' && requestedMode !== 'external',
            fileName: resolved.normalized
        };
    }

    async handleIsRunning(payload) {
        const fileName = this.normalizeRelativePath(payload?.fileName || '');
        if (!fileName) throw new Error('fileName is required');

        const child = this.activeProcesses.get(fileName);
        return !!child && !child.killed;
    }

    async handleStopScript(payload) {
        const fileName = this.normalizeRelativePath(payload?.fileName || '');
        if (!fileName) throw new Error('fileName is required');

        const child = this.activeProcesses.get(fileName);
        if (!child) return { stopped: false };

        this.activeProcesses.delete(fileName);

        if (process.platform === 'win32' && child.pid) {
            spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
            child.kill('SIGTERM');
        }

        if (this.io) {
            this.io.emit('process-exit', { fileName, code: -1 });
        }

        return { stopped: true };
    }

    async emitTelemetry(targetSocket = null) {
        const telemetryManager = this.managers?.telemetryManager;
        if (!telemetryManager || typeof telemetryManager.getTelemetryData !== 'function') return;

        const payload = await telemetryManager.getTelemetryData();
        if (!payload) return;

        if (targetSocket) {
            targetSocket.emit('telemetry-update', payload);
            return;
        }

        if (this.io) this.io.emit('telemetry-update', payload);
    }

    startTelemetryLoop() {
        if (this.telemetryTimer) return;

        this.telemetryTimer = setInterval(async () => {
            if (!this.io) return;
            if (this.io.engine.clientsCount <= 0) return;
            if (this.telemetryTickInFlight) return;

            this.telemetryTickInFlight = true;
            try {
                await this.emitTelemetry();
            } catch (error) {
                logger.warn(`[RemoteServer] Telemetry emit failed: ${error.message}`);
            } finally {
                this.telemetryTickInFlight = false;
            }
        }, this.telemetryIntervalMs);
    }

    stopTelemetryLoop() {
        if (!this.telemetryTimer) return;
        clearInterval(this.telemetryTimer);
        this.telemetryTimer = null;
    }

    registerSocketHandlers() {
        if (!this.io) return;

        this.io.on('connection', async (socket) => {
            logger.info(`[RemoteServer] Client connected: ${socket.id}`);

            this.registerSocketEvent(socket, 'run-script', this.handleRunScript);
            this.registerSocketEvent(socket, 'is-running', this.handleIsRunning);
            this.registerSocketEvent(socket, 'stop-script', this.handleStopScript);
            this.registerSocketEvent(socket, 'list-scripts', async () => this.listScripts());
            this.registerSocketEvent(socket, 'read-script-meta', async (payload) => this.readScriptMeta(payload?.fileName));

            try {
                await this.emitTelemetry(socket);
            } catch (_error) {
                // Telemetry bootstrap errors are non-fatal.
            }

            socket.on('disconnect', () => {
                logger.info(`[RemoteServer] Client disconnected: ${socket.id}`);
            });
        });
    }

    start() {
        if (this.httpServer) return;

        this.webApp = express();
        this.webApp.disable('x-powered-by');
        this.webApp.use(express.json({ limit: '1mb' }));

        this.webApp.use(express.static(this.uiRoot));
        if (fs.existsSync(this.nodeModulesRoot)) {
            this.webApp.use('/node_modules', express.static(this.nodeModulesRoot));
        }

        this.webApp.get('/healthz', (_req, res) => {
            res.json({ ok: true, host: this.host, port: this.port });
        });

        this.httpServer = http.createServer(this.webApp);
        this.io = new Server(this.httpServer, {
            cors: { origin: '*', methods: ['GET', 'POST'] }
        });

        this.registerSocketHandlers();
        this.startTelemetryLoop();

        this.httpServer.on('error', (error) => {
            logger.error(`[RemoteServer] HTTP error: ${error.message}`);
        });

        this.httpServer.listen(this.port, this.host, () => {
            logger.info(`[RemoteServer] Listening on http://${this.host}:${this.port}`);
        });
    }

    async stop() {
        this.stopTelemetryLoop();

        if (this.io) {
            await new Promise((resolve) => this.io.close(() => resolve()));
            this.io = null;
        }

        if (this.httpServer) {
            await new Promise((resolve) => this.httpServer.close(() => resolve()));
            this.httpServer = null;
        }

        this.webApp = null;
        logger.info('[RemoteServer] Stopped.');
    }
}

module.exports = RemoteServer;
