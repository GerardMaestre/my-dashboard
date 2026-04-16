export const isDesktop = Boolean(window.api);

let socket = null;
let socketInitPromise = null;

const processOutputSubscribers = new Set();
const processExitSubscribers = new Set();
const telemetrySubscribers = new Set();

function safeNotify(subscribers, payload) {
    for (const callback of subscribers) {
        try {
            callback(payload);
        } catch (error) {
            console.error('[HybridBridge] Subscriber callback failed:', error);
        }
    }
}

function getRemoteOrigin() {
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        return window.location.origin;
    }

    let configuredHost = '';
    try {
        const rawSettings = localStorage.getItem('nexus_settings_v1');
        if (rawSettings) {
            const parsed = JSON.parse(rawSettings);
            configuredHost = String(parsed?.remoteHost || '').trim();
        }
    } catch (_error) {
        configuredHost = '';
    }

    if (!configuredHost) {
        configuredHost = String(localStorage.getItem('horus_remote_host') || '').trim();
    }

    if (configuredHost) {
        if (/^https?:\/\//i.test(configuredHost)) return configuredHost;
        return `http://${configuredHost}`;
    }

    return 'http://127.0.0.1:3000';
}

async function connectMobileSocket() {
    const { io } = await import('../../node_modules/socket.io-client/dist/socket.io.esm.min.js');
    const nextSocket = io(getRemoteOrigin(), {
        transports: ['websocket', 'polling'],
        reconnection: true,
        timeout: 8000
    });

    nextSocket.on('process-output', (payload) => safeNotify(processOutputSubscribers, payload));
    nextSocket.on('process-exit', (payload) => safeNotify(processExitSubscribers, payload));
    nextSocket.on('telemetry-update', (payload) => safeNotify(telemetrySubscribers, payload));
    nextSocket.on('connect_error', (error) => {
        const msg = error?.message || String(error);
        console.warn('[HybridBridge] Socket connect error:', msg);
    });

    await new Promise((resolve, reject) => {
        if (nextSocket.connected) {
            resolve();
            return;
        }

        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Socket connection timeout'));
        }, 10000);

        const onConnect = () => {
            cleanup();
            resolve();
        };

        const onError = (error) => {
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error)));
        };

        const cleanup = () => {
            clearTimeout(timeout);
            nextSocket.off('connect', onConnect);
            nextSocket.off('connect_error', onError);
        };

        nextSocket.once('connect', onConnect);
        nextSocket.once('connect_error', onError);
    });

    socket = nextSocket;
    return socket;
}

async function ensureSocket() {
    if (isDesktop) return null;
    if (socket && socket.connected) return socket;
    if (socketInitPromise) return socketInitPromise;

    socketInitPromise = connectMobileSocket().finally(() => {
        socketInitPromise = null;
    });

    return socketInitPromise;
}

async function emitWithAck(eventName, payload = {}) {
    const activeSocket = await ensureSocket();
    if (!activeSocket) throw new Error('Socket unavailable');

    return await new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error(`${eventName} timeout`));
        }, 10000);

        activeSocket.emit(eventName, payload, (response = {}) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);

            if (!response.ok) {
                reject(new Error(response.error || `${eventName} failed`));
                return;
            }

            resolve(response.data);
        });
    });
}

export async function initHybridBridge() {
    if (isDesktop) {
        return { isDesktop: true, connected: true, origin: 'electron-ipc' };
    }

    try {
        await ensureSocket();
        return { isDesktop: false, connected: true, origin: getRemoteOrigin() };
    } catch (error) {
        console.error('[HybridBridge] Mobile socket init failed:', error);
        return {
            isDesktop: false,
            connected: false,
            origin: getRemoteOrigin(),
            error: error?.message || String(error)
        };
    }
}

export async function listScriptsBridge() {
    if (isDesktop) {
        if (!window.api || !window.api.system || typeof window.api.system.listScripts !== 'function') return [];
        return await window.api.system.listScripts();
    }

    const data = await emitWithAck('list-scripts');
    return Array.isArray(data) ? data : [];
}

export async function readScriptMetaBridge(fileName) {
    if (isDesktop) {
        if (!window.api || !window.api.system || typeof window.api.system.readScriptMeta !== 'function') return [];
        return await window.api.system.readScriptMeta(fileName);
    }

    const data = await emitWithAck('read-script-meta', { fileName });
    return Array.isArray(data) ? data : [];
}

export async function runScriptBridge(payload) {
    if (isDesktop) {
        if (!window.api || !window.api.system || typeof window.api.system.runScript !== 'function') {
            throw new Error('Desktop IPC runScript bridge unavailable');
        }

        return await window.api.system.runScript(payload);
    }

    const data = await emitWithAck('run-script', payload || {});
    return {
        pid: data?.pid || null,
        mode: data?.mode || (payload?.mode || 'internal'),
        forcedExternal: (data?.mode || payload?.mode || 'internal') === 'external'
    };
}

export async function isRunningBridge(fileName) {
    if (isDesktop) {
        if (!window.api || !window.api.system || typeof window.api.system.isRunning !== 'function') return false;
        return await window.api.system.isRunning(fileName);
    }

    return !!(await emitWithAck('is-running', { fileName }));
}

export async function stopScriptBridge(fileName) {
    if (isDesktop) {
        if (!window.api || typeof window.api.system.stopScript !== 'function') return { stopped: false };
        return await window.api.system.stopScript(fileName);
    }

    const data = await emitWithAck('stop-script', { fileName });
    return data && typeof data === 'object' ? data : { stopped: false };
}

export function onProcessOutputBridge(callback) {
    if (typeof callback !== 'function') return () => {};

    if (isDesktop) {
        if (!window.api || typeof window.api.process.onOutput !== 'function') return () => {};
        return window.api.process.onOutput(callback);
    }

    processOutputSubscribers.add(callback);
    ensureSocket().catch(() => {});
    return () => processOutputSubscribers.delete(callback);
}

export function onProcessExitBridge(callback) {
    if (typeof callback !== 'function') return () => {};

    if (isDesktop) {
        if (!window.api || typeof window.api.process.onExit !== 'function') return () => {};
        return window.api.process.onExit(callback);
    }

    processExitSubscribers.add(callback);
    ensureSocket().catch(() => {});
    return () => processExitSubscribers.delete(callback);
}

export function onTelemetryBridge(callback) {
    if (typeof callback !== 'function') return () => {};

    if (isDesktop) {
        if (!window.api || typeof window.api.telemetry.onUpdate !== 'function') return () => {};
        return window.api.telemetry.onUpdate(callback);
    }

    telemetrySubscribers.add(callback);
    ensureSocket().catch(() => {});
    return () => telemetrySubscribers.delete(callback);
}
