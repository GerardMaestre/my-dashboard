const { ipcMain } = require('electron');
const logger = require('../utils/logger');

class NetworkRadar {
    constructor(mainWindow, getNetworkMonitorModule, getThreatIntel, networkIntervalMs) {
        this.mainWindow = mainWindow;
        this.getNetworkMonitorModule = getNetworkMonitorModule;
        this.getThreatIntel = getThreatIntel;
        this.NETWORK_INTERVAL_MS = networkIntervalMs;
        this.networkMonitor = null;
        
        this.lastNetworkSignature = '';
        this.lastExposureSignature = '';
        this.lastListenersSignature = '';
    }

    setMainWindow(win) {
        this.mainWindow = win;
    }

    canRunMonitoring() {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return false;
        return this.mainWindow.isVisible() && !this.mainWindow.isMinimized();
    }

    sendToRenderer(channel, payload) {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        this.mainWindow.webContents.send(channel, payload);
    }

    fnv1aHash(items, toKey, limit = 5000) {
        let hash = 2166136261;
        const max = Math.min(items.length, limit);
        for (let idx = 0; idx < max; idx += 1) {
            const key = toKey(items[idx]);
            for (let charIndex = 0; charIndex < key.length; charIndex += 1) {
                hash ^= key.charCodeAt(charIndex);
                hash = Math.imul(hash, 16777619);
            }
        }
        return `${items.length}:${hash >>> 0}`;
    }

    broadcastNetworkSnapshots(connections, dangerousLocalPorts = [], listeningPorts = []) {
        if (!this.canRunMonitoring()) return;

        const networkSignature = this.fnv1aHash(connections, (entry) => `${entry.id}|${entry.state}|${entry.pid || ''}`);
        if (networkSignature !== this.lastNetworkSignature) {
            this.lastNetworkSignature = networkSignature;
            this.sendToRenderer('network-update', connections);
        }

        const exposureSignature = this.fnv1aHash(dangerousLocalPorts, (entry) => `${entry.id}|${entry.localPort}|${entry.boundToAllInterfaces ? 1 : 0}`);
        if (exposureSignature !== this.lastExposureSignature) {
            this.lastExposureSignature = exposureSignature;
            this.sendToRenderer('network-exposure-update', dangerousLocalPorts);
        }

        const listenersSignature = this.fnv1aHash(listeningPorts, (entry) => `${entry.id}|${entry.localPort}|${entry.boundToAllInterfaces ? 1 : 0}`);
        if (listenersSignature !== this.lastListenersSignature) {
            this.lastListenersSignature = listenersSignature;
            this.sendToRenderer('network-listeners-update', listeningPorts);
        }
    }

    start() {
        if (!this.networkMonitor) {
            const { NetworkMonitor } = this.getNetworkMonitorModule();
            this.networkMonitor = new NetworkMonitor({
                intervalMs: this.NETWORK_INTERVAL_MS,
                broadcastConnections: (c, d, l) => this.broadcastNetworkSnapshots(c, d, l)
            });
            this.networkMonitor.registerIpc(ipcMain);
        }
        this.networkMonitor.start();
        logger.info('[NetworkRadar] Monitoring started.');
    }

    stop() {
        if (this.networkMonitor) {
            this.networkMonitor.stop();
            logger.info('[NetworkRadar] Monitoring stopped.');
        }
    }

    async ipIntelLookup(ip) {
        const intel = this.getThreatIntel();
        return await intel.lookup(ip);
    }
}

module.exports = NetworkRadar;
