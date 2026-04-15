const si = require('systeminformation');
const logger = require('../utils/logger');

class TelemetryManager {
    constructor(mainWindow, intervalMs = 2000) {
        this.mainWindow = mainWindow;
        this.intervalMs = intervalMs;
        this.timer = null;
        this.lastSignature = '';
        this.tickInFlight = false;
    }

    setMainWindow(win) {
        this.mainWindow = win;
    }

    async start() {
        if (this.timer) return;
        this.timer = setInterval(() => this.tick(), this.intervalMs);
        this.tick().catch(() => {}); // First tick immediate, non-blocking
        logger.info('[Telemetry] Loop started.');
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async getTelemetryData() {
        const [cpu, mem, netStats] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.networkStats('*')
        ]);

        let tx = 0;
        let rx = 0;
        if (Array.isArray(netStats)) {
            for (const item of netStats) {
                tx += Number(item.tx_sec) || 0;
                rx += Number(item.rx_sec) || 0;
            }
        }

        return {
            cpuLoad: Number(cpu?.currentLoad) || 0,
            memUse: Number(mem?.active) || 0,
            memTotal: Number(mem?.total) || 0,
            netTx: tx,
            netRx: rx
        };
    }

    async tick() {
        if (this.tickInFlight) return;
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        if (!this.mainWindow.isVisible() || this.mainWindow.isMinimized()) return;

        this.tickInFlight = true;
        try {
            const payload = await this.getTelemetryData();

            const signature = `${Math.round(payload.cpuLoad)}|${Math.round(payload.memUse / 1024)}|${Math.round(payload.netTx / 1000)}`;
            if (signature !== this.lastSignature) {
                this.lastSignature = signature;
                this.mainWindow.webContents.send('telemetry-update', payload);
            }
        } catch (e) {
            console.error('[Telemetry] Tick error:', e.message);
        } finally {
            this.tickInFlight = false;
        }
    }
}

module.exports = TelemetryManager;
