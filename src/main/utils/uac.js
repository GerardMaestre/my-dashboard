const { execSync, spawn } = require('child_process');
const { app } = require('electron');
const logger = require('./logger');

function isAdmin() {
    try {
        // net session error code 0 if admin, otherwise 1
        execSync('net session', { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

function requestElevation() {
    if (process.platform !== 'win32') return;

    logger.warn('Horus Engine: Admin privileges required. Attempting elevation...');

    // We use a PowerShell script to relaunch with 'RunAs' verb
    const exe = process.execPath;
    const args = process.argv.slice(1).map(arg => `"${arg}"`).join(' ');
    
    const command = `Start-Process "${exe}" -ArgumentList ${args} -Verb RunAs`;
    
    try {
        spawn('powershell.exe', ['-Command', command], {
            detached: true,
            stdio: 'ignore'
        }).unref();
        
        app.quit();
    } catch (e) {
        logger.error(`Failed to request elevation: ${e.message}`);
    }
}

module.exports = { isAdmin, requestElevation };
