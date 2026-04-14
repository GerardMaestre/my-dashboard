const { app } = require('electron');
const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this._initialized = false;
        this.logFile = null;
    }

    _ensureInit() {
        if (this._initialized) return;
        try {
            // app.getPath('userData') is reliable after app is in the process
            const userData = app.getPath('userData');
            const logDir = path.join(userData, 'logs');
            if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
            this.logFile = path.join(logDir, 'horus.log');
            this._initialized = true;
        } catch (e) {
            // Fallback during extreme early bootstrap
            console.error('Logger early init fail:', e.message);
        }
    }

    info(msg) { this._log('INFO', msg); }
    warn(msg) { this._log('WARN', msg); }
    error(msg) { this._log('ERROR', msg); }

    _log(level, msg) {
        this._ensureInit();
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] [${level}] ${msg}\n`;
        
        console.log(line.trim());
        if (this.logFile) {
            try {
                fs.appendFileSync(this.logFile, line);
            } catch (e) {
                console.error('Failed to write to log file', e);
            }
        }
    }
}

module.exports = new Logger();
