const os = require('os');
const { exec } = require('child_process');
const logger = require('../utils/logger');

class TelemetryManager {
    constructor(mainWindow, intervalMs = 2000) {
        this.mainWindow = mainWindow;
        this.intervalMs = intervalMs;
        this.timer = null;
        this.loopActive = false;
        this.lastSignature = '';
        this.lastCpuSample = null;
        this.lastCpuLoad = 0;
        this.telemetryCache = null;
        this.telemetryCacheTs = 0;
        this.telemetryPromise = null;
    }

    setMainWindow(win) {
        this.mainWindow = win;
    }

    getCpuSample() {
        const cpus = os.cpus();
        if (!Array.isArray(cpus) || cpus.length === 0) return null;

        let idle = 0;
        let total = 0;

        for (const cpu of cpus) {
            const times = cpu?.times || {};
            const user = Number(times.user) || 0;
            const nice = Number(times.nice) || 0;
            const sys = Number(times.sys) || 0;
            const irq = Number(times.irq) || 0;
            const idleTicks = Number(times.idle) || 0;
            idle += idleTicks;
            total += user + nice + sys + irq + idleTicks;
        }

        return { idle, total };
    }

    computeCpuLoad() {
        const current = this.getCpuSample();
        if (!current) return this.lastCpuLoad;

        if (!this.lastCpuSample) {
            this.lastCpuSample = current;
            return this.lastCpuLoad;
        }

        const idleDelta = current.idle - this.lastCpuSample.idle;
        const totalDelta = current.total - this.lastCpuSample.total;
        this.lastCpuSample = current;

        if (totalDelta <= 0) return this.lastCpuLoad;

        const usage = (1 - (idleDelta / totalDelta)) * 100;
        this.lastCpuLoad = Math.max(0, Math.min(100, Number(usage) || 0));
        return this.lastCpuLoad;
    }

    readPingMs() {
        return new Promise((resolve) => {
            exec(
                'chcp 65001 > nul && ping 8.8.8.8 -n 1 -w 1000',
                {
                    encoding: 'utf8',
                    windowsHide: true,
                    timeout: 2200,
                    maxBuffer: 128 * 1024
                },
                (error, stdout = '', stderr = '') => {
                    const output = `${stdout}\n${stderr}`;
                    const match = output.match(/(?:time|tiempo)\s*[=<]\s*(\d+)\s*ms/i);
                    if (match) {
                        resolve(Number.parseInt(match[1], 10));
                        return;
                    }

                    if (error) {
                        resolve(null);
                        return;
                    }

                    resolve(null);
                }
            );
        });
    }

    async getTelemetryData() {
        const now = Date.now();
        if (this.telemetryCache && (now - this.telemetryCacheTs) < 900) {
            return this.telemetryCache;
        }

        if (this.telemetryPromise) {
            return await this.telemetryPromise;
        }

        this.telemetryPromise = (async () => {
            const memTotal = Number(os.totalmem()) || 0;
            const memFree = Number(os.freemem()) || 0;
            const pingMs = await this.readPingMs();

            const payload = {
                cpuLoad: this.computeCpuLoad(),
                memUse: Math.max(0, memTotal - memFree),
                memTotal,
                netTx: 0,
                netRx: 0,
                pingMs: Number.isFinite(pingMs) ? pingMs : null
            };

            this.telemetryCache = payload;
            this.telemetryCacheTs = Date.now();
            return payload;
        })();

        try {
            return await this.telemetryPromise;
        } finally {
            this.telemetryPromise = null;
        }
    }

    async tick() {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        if (!this.mainWindow.isVisible() || this.mainWindow.isMinimized()) return;

        try {
            const payload = await this.getTelemetryData();
            const signature = `${Math.round(payload.cpuLoad)}|${Math.round(payload.memUse / 1024)}|${payload.pingMs ?? 'na'}`;

            if (signature === this.lastSignature) return;

            this.lastSignature = signature;
            this.mainWindow.webContents.send('telemetry-update', payload);
            this.mainWindow.webContents.send('telemetry:update', payload);
        } catch (error) {
            logger.warn(`[Telemetry] Tick error: ${error.message}`);
        }
    }

    async runLoop() {
        if (!this.loopActive) return;

        await this.tick();

        if (!this.loopActive) return;

        this.timer = setTimeout(() => {
            this.runLoop().catch((error) => {
                logger.warn(`[Telemetry] Loop error: ${error.message}`);
            });
        }, this.intervalMs);
    }

    async start() {
        if (this.loopActive) return;
        this.loopActive = true;
        logger.info('[Telemetry] Async loop started.');
        this.runLoop().catch((error) => {
            logger.warn(`[Telemetry] Start error: ${error.message}`);
        });
    }

    stop() {
        this.loopActive = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}

module.exports = TelemetryManager;