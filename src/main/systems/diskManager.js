const path = require('path');
const os = require('os');
const fs = require('fs');
const readline = require('readline');
const { execFile } = require('child_process');
const logger = require('../utils/logger');

class DiskManager {
    constructor(appDataNexus, toolCandidates) {
        this.appDataNexus = appDataNexus;
        this.toolCandidates = toolCandidates;
        this.diskScanCache = new Map();
        this.MAX_SCAN_CACHE_SIZE = 3;
        this.MAX_ITEMS = 30;
    }

    findExistingTool(paths) {
        for (const candidate of paths || []) {
            if (candidate && fs.existsSync(candidate)) return candidate;
        }
        return null;
    }

    normalizeRootPath(rootPath) {
        const rawRoot = String(rootPath || 'C:\\').trim() || 'C:\\';
        let resolved = path.win32.resolve(rawRoot);
        if (!resolved.endsWith('\\')) resolved += '\\';
        return path.win32.normalize(resolved);
    }

    normalizeItemLimit() {
        return this.MAX_ITEMS;
    }

    parseWizTreeLine(line) {
        if (!line || line.length < 5 || line[0] !== '"') return null;

        let idx = 1;
        let fullPath = '';
        while (idx < line.length) {
            const current = line[idx];
            if (current === '"') {
                if (line[idx + 1] === '"') {
                    fullPath += '"';
                    idx += 2;
                    continue;
                }
                break;
            }
            fullPath += current;
            idx += 1;
        }

        if (idx >= line.length) return null;

        const remaining = line.slice(idx + 1);
        const columns = remaining.startsWith(',')
            ? remaining.slice(1).split(',')
            : remaining.split(',');

        const sizeBytes = Number(columns[0]) || 0;
        const attributes = Number(columns[columns.length - 3]) || 0;
        const isDirectory = (attributes & 16) === 16;

        return {
            fullPath: fullPath.replace(/\\\\/g, '\\'),
            sizeBytes,
            isDirectory
        };
    }

    isImmediateChildFolder(fullPath, normalizedRoot) {
        const normalizedFullPath = path.win32.normalize(String(fullPath || '')).replace(/[\\/]+$/, '');
        const normalizedRootBase = normalizedRoot.replace(/[\\/]+$/, '');
        const rootPrefix = `${normalizedRootBase}\\`;

        if (!normalizedFullPath.toLowerCase().startsWith(rootPrefix.toLowerCase())) {
            return false;
        }

        const relative = normalizedFullPath.slice(rootPrefix.length);
        if (!relative) return false;
        return !relative.includes('\\');
    }

    async parseRootFoldersFromCsv(csvPath, normalizedRoot, sender) {
        const folderMap = new Map();
        const stream = fs.createReadStream(csvPath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

        let isHeader = true;
        let lineCount = 0;
        let lastProgressTs = Date.now();

        for await (const line of rl) {
            if (isHeader) {
                isHeader = false;
                continue;
            }

            lineCount += 1;
            const parsed = this.parseWizTreeLine(line);
            if (!parsed || !parsed.isDirectory) continue;

            if (!this.isImmediateChildFolder(parsed.fullPath, normalizedRoot)) continue;

            const normalizedPath = path.win32.normalize(parsed.fullPath).replace(/[\\/]+$/, '');
            const previous = folderMap.get(normalizedPath);
            if (!previous || parsed.sizeBytes > previous.sizeBytes) {
                folderMap.set(normalizedPath, {
                    fullPath: normalizedPath,
                    name: path.win32.basename(normalizedPath) || normalizedPath,
                    sizeBytes: Number(parsed.sizeBytes) || 0,
                    isDir: true,
                    depth: 1
                });
            }

            if (lineCount % 40000 === 0) {
                const now = Date.now();
                if (now - lastProgressTs >= 300) {
                    sender.send('disk-progress', { phase: 'parsing', percent: 55 + Math.min(35, Math.round(lineCount / 120000)) });
                    lastProgressTs = now;
                }
            }
        }

        return Array.from(folderMap.values()).sort((a, b) => b.sizeBytes - a.sizeBytes);
    }

    async runWizTreeExport(wiztreeExe, normalizedRoot, csvPath) {
        return await new Promise((resolve, reject) => {
            const args = [
                normalizedRoot,
                `/export=${csvPath}`,
                '/exportencoding=UTF8',
                '/admin=0'
            ];

            execFile(
                wiztreeExe,
                args,
                {
                    windowsHide: true,
                    timeout: 180000,
                    maxBuffer: 1024 * 1024
                },
                (error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                }
            );
        });
    }

    buildCompactPayload(normalizedRoot, allRootFolders) {
        const topFolders = allRootFolders.slice(0, this.normalizeItemLimit());
        const maxSize = Math.max(1, ...topFolders.map((item) => Number(item.sizeBytes) || 0));
        const totalSize = topFolders.reduce((sum, item) => sum + (Number(item.sizeBytes) || 0), 0);

        const items = topFolders.map((item, index) => {
            const sizeBytes = Number(item.sizeBytes) || 0;
            const percent = (sizeBytes / maxSize) * 100;
            return {
                id: `wiz-root-${index}`,
                fullPath: item.fullPath,
                name: item.name,
                sizeBytes,
                isDir: true,
                depth: 1,
                percent: Number(percent.toFixed(2))
            };
        });

        return {
            engine: 'wiztree',
            root: normalizedRoot,
            items,
            totalItems: items.length,
            itemsTruncated: false,
            snapshotPath: '',
            extensions: [],
            totalSize
        };
    }

    cacheResult(cacheKey, payload) {
        if (this.diskScanCache.size >= this.MAX_SCAN_CACHE_SIZE) {
            const first = this.diskScanCache.keys().next().value;
            this.diskScanCache.delete(first);
        }
        this.diskScanCache.set(cacheKey, payload);
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

                return stdout
                    .split(/\r?\n/)
                    .filter(Boolean)
                    .map((filePath, index) => ({
                        id: `es-${index}`,
                        name: path.basename(filePath),
                        fullPath: filePath
                    }));
            } catch (error) {
                logger.error(`[DiskManager] Everything search failed: ${error.message}`);
            }
        }

        return [];
    }

    async ghostScanDisk(sender, rootPath, options = {}) {
        const normalizedRoot = this.normalizeRootPath(rootPath);
        const cacheKey = normalizedRoot.toLowerCase();

        if (!options.forceFresh && this.diskScanCache.has(cacheKey)) {
            sender.send('disk-progress', { phase: 'cached', percent: 100 });
            return this.diskScanCache.get(cacheKey);
        }

        const wiztreeExe = this.findExistingTool(this.toolCandidates.wiztree);
        if (!wiztreeExe) {
            logger.error('[DiskManager] WizTree not found');
            return { error: 'WizTree not found' };
        }

        const tmpCsvPath = path.join(os.tmpdir(), `horus-wiztree-${Date.now()}-${process.pid}.csv`);

        try {
            sender.send('disk-progress', { phase: 'scan', percent: 10 });
            await this.runWizTreeExport(wiztreeExe, normalizedRoot, tmpCsvPath);

            sender.send('disk-progress', { phase: 'parsing', percent: 50 });
            const allRootFolders = await this.parseRootFoldersFromCsv(tmpCsvPath, normalizedRoot, sender);

            sender.send('disk-progress', { phase: 'finalize', percent: 92 });
            const payload = this.buildCompactPayload(normalizedRoot, allRootFolders);
            this.cacheResult(cacheKey, payload);

            sender.send('disk-progress', { phase: 'done', percent: 100 });
            return payload;
        } catch (error) {
            logger.error(`[DiskManager] WizTree scan failed: ${error.message}`);
            return { error: error.message };
        } finally {
            fs.promises.unlink(tmpCsvPath).catch(() => {});
        }
    }

    readDiskSnapshotPage(_snapshotPath, offset = 0, limit = 1200) {
        const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
        const safeLimit = Math.max(1, Number.parseInt(limit, 10) || 1200);

        return {
            items: [],
            totalItems: 0,
            offset: safeOffset,
            limit: safeLimit,
            hasMore: false,
            error: 'Snapshot paging disabled in compact disk mode'
        };
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