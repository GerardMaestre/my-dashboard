const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const logger = require('../utils/logger');

class DiskManager {
    constructor(appDataNexus, toolCandidates) {
        this.appDataNexus = appDataNexus;
        this.toolCandidates = toolCandidates;
        this.diskScanCache = new Map();
        this.MAX_SCAN_CACHE_SIZE = 3;
    }

    ensureDir(dirPath) {
        try {
            if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
            return true;
        } catch (error) {
            logger.error(`[DiskManager] No se pudo crear ${dirPath}: ${error.message}`);
            return false;
        }
    }

    findExistingTool(paths) {
        for (const candidate of paths) {
            if (fs.existsSync(candidate)) return candidate;
        }
        return null;
    }

    async ghostSearchFiles(query, limit = 120) {
        const esPath = this.findExistingTool(this.toolCandidates.es);
        if (esPath) {
            try {
                const { stdout } = await new Promise((resolve, reject) => {
                    execFile(esPath, ['-n', String(limit), query], { windowsHide: true }, (err, out) => {
                        if (err && !out) reject(err);
                        else resolve({ stdout: out || '' });
                    });
                });
                return stdout.split(/\r?\n/).filter(Boolean).map((f, i) => ({ id: `es-${i}`, name: path.basename(f), fullPath: f }));
            } catch (e) {
                logger.error(`[DiskManager] Everything search failed: ${e.message}`);
            }
        }
        return [];
    }

    async ghostScanDisk(sender, rootPath, options) {
        const normRoot = path.normalize(rootPath).toLowerCase();
        if (!options?.forceFresh && this.diskScanCache.has(normRoot)) {
            logger.info(`[DiskManager] Returning cached scan for ${normRoot}`);
            return this.diskScanCache.get(normRoot);
        }

        const wiztreeExe = this.findExistingTool(this.toolCandidates.wiztree);
        if (!wiztreeExe) {
            logger.error(`[DiskManager] WizTree not found`);
            return { error: 'WizTree not found' };
        }

        const driveLetter = rootPath.substring(0, 1).toUpperCase();
        const tempCsv = path.join(this.appDataNexus, `export-${driveLetter}.csv`);
        this.ensureDir(this.appDataNexus);

        logger.info(`[DiskManager] Starting WizTree scan for ${driveLetter}:`);
        sender.send('disk-progress', { phase: 'scan', percent: 10 });
        
        await new Promise(r => execFile(wiztreeExe, [`${driveLetter}:\\`, `/export=${tempCsv}`, '/admin=0'], { windowsHide: true }, r));

        sender.send('disk-progress', { phase: 'parsing', percent: 50 });
        
        const result = await this.parseWizTreeCSV(tempCsv, normRoot, sender);
        
        if (this.diskScanCache.size >= this.MAX_SCAN_CACHE_SIZE) {
            const first = this.diskScanCache.keys().next().value;
            this.diskScanCache.delete(first);
        }
        this.diskScanCache.set(normRoot, result);
        return result;
    }

    async parseWizTreeCSV(filePath, normRoot, sender) {
        const readline = require('readline');
        const items = [];
        const extMap = new Map();
        let totalSize = 0;
        
        const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        let isFirst = true;
        let i = 0;

        for await (const line of rl) {
            if (isFirst) { isFirst = false; continue; }
            const firstComma = line.indexOf('",');
            if (firstComma === -1) continue;

            const fullPath = line.substring(1, firstComma).replace(/\\\\/g, '\\');
            const rest = line.substring(firstComma + 2).split(',');
            const sizeBytes = Number(rest[0]) || 0;
            const attributes = Number(rest[rest.length - 3]) || 0;
            const isDir = (attributes & 16) !== 0;

            if (fullPath.toLowerCase().startsWith(normRoot)) {
                const depth = (fullPath.split('\\').length) - (normRoot.split('\\').length) + 1;
                
                // FILTRADO AGRESIVO (Optimization requested)
                if (isDir || depth <= 2 || sizeBytes > 5 * 1024 * 1024) {
                    if (depth <= 5) {
                        items.push({ id: `wiz-${i}`, fullPath, name: path.basename(fullPath), sizeBytes, isDir, depth });
                    }
                }
            }

            if (!isDir) {
                totalSize += sizeBytes;
                const ext = path.extname(fullPath).toLowerCase() || 'otros';
                extMap.set(ext, (extMap.get(ext) || 0) + sizeBytes);
            }
            i++;
            if (i % 50000 === 0) sender.send('disk-progress', { phase: 'parsing', percent: 50 + (i/200000)*40 });
        }

        const extensions = Array.from(extMap.entries())
            .map(([ext, size]) => ({ ext, sizeBytes: size, percent: (size * 100 / (totalSize || 1)).toFixed(1) }))
            .sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 50);

        return { engine: 'wiztree', items, extensions, totalSize };
    }

    async scanGlobalFilesChunked(sender) {
        const results = [];
        const walk = (dir) => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for(const e of entries) {
                    const full = path.join(dir, e.name);
                    results.push(full);
                    if(results.length >= 2000) {
                        sender.send('scan-chunk', results.splice(0, 2000));
                    }
                    if(e.isDirectory() && !full.includes('Windows') && !full.includes('node_modules')) {
                        walk(full);
                    }
                }
            } catch(e) {}
        };
        try { walk('C:\\'); } catch(e) {}
        sender.send('scan-chunk', results);
        return { done: true };
    }

    resetCache() {
        this.diskScanCache.clear();
    }
}

module.exports = DiskManager;
