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
        this.snapshotDir = path.join(this.appDataNexus, 'scan-snapshots');
        this.MAX_SNAPSHOT_FILES = 8;
        this.DEFAULT_PREVIEW_ITEMS = 1200;
        this.MAX_PREVIEW_ITEMS = 5000;
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

    normalizeItemLimit(limitValue) {
        const parsed = Number.parseInt(limitValue, 10);
        if (!Number.isFinite(parsed)) return this.DEFAULT_PREVIEW_ITEMS;
        return Math.max(50, Math.min(this.MAX_PREVIEW_ITEMS, parsed));
    }

    buildPreviewPayload(scanResult, options = {}) {
        const totalItems = Array.isArray(scanResult?.items) ? scanResult.items.length : 0;
        const maxItems = this.normalizeItemLimit(options?.maxItems);
        const previewItems = totalItems > 0 ? scanResult.items.slice(0, maxItems) : [];
        const snapshotPath = this.persistScanSnapshot(scanResult?.root || '', scanResult?.items || []);

        return {
            engine: scanResult?.engine || 'wiztree',
            root: scanResult?.root || '',
            items: previewItems,
            totalItems,
            itemsTruncated: totalItems > previewItems.length,
            snapshotPath,
            extensions: Array.isArray(scanResult?.extensions) ? scanResult.extensions : [],
            totalSize: Number(scanResult?.totalSize) || 0
        };
    }

    persistScanSnapshot(root, items) {
        try {
            this.ensureDir(this.snapshotDir);
            const safeRoot = String(root || 'scan')
                .replace(/[:\\/]+/g, '_')
                .replace(/[^a-zA-Z0-9_-]+/g, '')
                .slice(0, 40) || 'scan';
            const fileName = `wiz-${safeRoot}-${Date.now()}.json`;
            const fullPath = path.join(this.snapshotDir, fileName);
            fs.writeFileSync(fullPath, JSON.stringify({ createdAt: Date.now(), items: Array.isArray(items) ? items : [] }), 'utf8');
            this.pruneOldSnapshots();
            return fullPath;
        } catch (error) {
            logger.warn(`[DiskManager] No se pudo persistir snapshot de disco: ${error.message}`);
            return '';
        }
    }

    pruneOldSnapshots() {
        try {
            if (!fs.existsSync(this.snapshotDir)) return;
            const files = fs.readdirSync(this.snapshotDir)
                .filter((name) => name.toLowerCase().endsWith('.json'))
                .map((name) => {
                    const fullPath = path.join(this.snapshotDir, name);
                    let mtimeMs = 0;
                    try {
                        mtimeMs = fs.statSync(fullPath).mtimeMs || 0;
                    } catch (_error) {
                        mtimeMs = 0;
                    }
                    return { fullPath, mtimeMs };
                })
                .sort((a, b) => b.mtimeMs - a.mtimeMs);

            if (files.length <= this.MAX_SNAPSHOT_FILES) return;

            for (let index = this.MAX_SNAPSHOT_FILES; index < files.length; index += 1) {
                try {
                    fs.unlinkSync(files[index].fullPath);
                } catch (_error) {
                    // noop
                }
            }
        } catch (_error) {
            // noop
        }
    }

    readDiskSnapshotPage(snapshotPath, offset = 0, limit = this.DEFAULT_PREVIEW_ITEMS) {
        try {
            const resolvedSnapshotDir = path.resolve(this.snapshotDir);
            const resolvedPath = path.resolve(String(snapshotPath || ''));
            const normalizedDir = `${resolvedSnapshotDir}${path.sep}`.toLowerCase();
            const normalizedPath = resolvedPath.toLowerCase();

            if (!normalizedPath.startsWith(normalizedDir)) {
                return { items: [], totalItems: 0, offset: 0, limit: 0, hasMore: false, error: 'Invalid snapshot path' };
            }

            if (!fs.existsSync(resolvedPath)) {
                return { items: [], totalItems: 0, offset: 0, limit: 0, hasMore: false, error: 'Snapshot not found' };
            }

            const raw = fs.readFileSync(resolvedPath, 'utf8');
            const parsed = JSON.parse(raw);
            const allItems = Array.isArray(parsed?.items) ? parsed.items : [];
            const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
            const safeLimit = this.normalizeItemLimit(limit);
            const pageItems = allItems.slice(safeOffset, safeOffset + safeLimit);

            return {
                items: pageItems,
                totalItems: allItems.length,
                offset: safeOffset,
                limit: safeLimit,
                hasMore: (safeOffset + pageItems.length) < allItems.length
            };
        } catch (error) {
            logger.warn(`[DiskManager] No se pudo leer snapshot paginado: ${error.message}`);
            return { items: [], totalItems: 0, offset: 0, limit: 0, hasMore: false, error: error.message };
        }
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
        const safeRoot = String(rootPath || 'C:\\');
        const normRoot = path.normalize(safeRoot).toLowerCase();
        if (!options?.forceFresh && this.diskScanCache.has(normRoot)) {
            logger.info(`[DiskManager] Returning cached scan for ${normRoot}`);
            const cached = this.diskScanCache.get(normRoot);
            const requestedLimit = this.normalizeItemLimit(options?.maxItems);

            if (cached?.snapshotPath && requestedLimit !== (cached.items?.length || 0)) {
                const page = this.readDiskSnapshotPage(cached.snapshotPath, 0, requestedLimit);
                if (Array.isArray(page?.items) && page.items.length > 0) {
                    return {
                        ...cached,
                        items: page.items,
                        itemsTruncated: !!page.hasMore
                    };
                }
            }

            return cached;
        }

        const wiztreeExe = this.findExistingTool(this.toolCandidates.wiztree);
        if (!wiztreeExe) {
            logger.error(`[DiskManager] WizTree not found`);
            return { error: 'WizTree not found' };
        }

        const driveLetter = safeRoot.substring(0, 1).toUpperCase();
        const tempCsv = path.join(this.appDataNexus, `export-${driveLetter}.csv`);
        this.ensureDir(this.appDataNexus);

        logger.info(`[DiskManager] Starting WizTree scan for ${driveLetter}:`);
        sender.send('disk-progress', { phase: 'scan', percent: 10 });
        
        await new Promise(r => execFile(wiztreeExe, [`${driveLetter}:\\`, `/export=${tempCsv}`, '/admin=0'], { windowsHide: true }, r));

        sender.send('disk-progress', { phase: 'parsing', percent: 50 });
        
        const parsedResult = await this.parseWizTreeCSV(tempCsv, normRoot, sender);
        const result = this.buildPreviewPayload(parsedResult, options);
        
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
        let lastProgressTs = Date.now();

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
            if (i % 50000 === 0) {
                const now = Date.now();
                if (now - lastProgressTs >= 350) {
                    sender.send('disk-progress', { phase: 'parsing', percent: 50 + (i / 200000) * 40 });
                    lastProgressTs = now;
                }
            }
        }

        const extensions = Array.from(extMap.entries())
            .map(([ext, size]) => ({ ext, sizeBytes: size, percent: (size * 100 / (totalSize || 1)).toFixed(1) }))
            .sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 50);

        return { engine: 'wiztree', root: normRoot, items, extensions, totalSize };
    }

    async scanGlobalFilesChunked(sender) {
        const CHUNK_SIZE = 600;
        const YIELD_EVERY = 1500;
        const queue = ['C:\\'];
        const chunk = [];
        let emitted = 0;

        while (queue.length > 0) {
            const dir = queue.pop();
            let entries = [];

            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch (_error) {
                continue;
            }

            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                chunk.push(full);

                if (entry.isDirectory()) {
                    const lower = full.toLowerCase();
                    if (!lower.includes('\\windows') && !lower.includes('\\node_modules')) {
                        queue.push(full);
                    }
                }

                if (chunk.length >= CHUNK_SIZE) {
                    sender.send('scan-chunk', chunk.splice(0, CHUNK_SIZE));
                }

                emitted += 1;
                if (emitted % YIELD_EVERY === 0) {
                    if (chunk.length > 0) {
                        sender.send('scan-chunk', chunk.splice(0, chunk.length));
                    }
                    sender.send('scan-progress', emitted);
                    await new Promise((resolve) => setImmediate(resolve));
                }
            }
        }

        if (chunk.length > 0) {
            sender.send('scan-chunk', chunk);
        }

        sender.send('scan-progress', emitted);
        return { done: true };
    }

    resetCache() {
        this.diskScanCache.clear();
    }
}

module.exports = DiskManager;
