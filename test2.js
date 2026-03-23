const fs = require('fs');
const readline = require('readline');

console.log('Starting stream scan...');
const t0 = Date.now();

const csvPath = 'C:\\Users\\gerar\\AppData\\Roaming\\HorusEngine\\wiztree-export.csv';
const rl = readline.createInterface({
    input: fs.createReadStream(csvPath, { encoding: 'utf8' }),
    crlfDelay: Infinity
});

const itemsParse = [];
const extMap = new Map();
let totalFilesBytes = 0;
const normBase = 'c:\\program files\\';

let isFirstLine = true;
let i = 0;

rl.on('line', (line) => {
    if (isFirstLine) { isFirstLine = false; return; }
    
    const firstComma = line.indexOf('",');
    if (firstComma === -1) return;

    let fullPath = line.substring(1, firstComma).replace(/\\\\/g, '\\');
    const fullPathLower = fullPath.toLowerCase();

    const rest = line.substring(firstComma + 2);
    const cols = rest.split(',');
    const sizeBytes = Number(cols[0]) || 0;
    const attributes = Number(cols[cols.length - 3]) || 0;
    const isDir = (attributes & 16) !== 0;

    if (fullPath && sizeBytes > 0) {
        if (fullPathLower.startsWith(normBase) && fullPath.length > normBase.length) {
            const subPath = fullPath.substring(normBase.length);
            const slashIdx = subPath.indexOf('\\');
            if (slashIdx === -1 || slashIdx === subPath.length - 1) {
                itemsParse.push({ fullPath, sizeBytes, isDir });
            }
        }
    }
    i++;
});

rl.on('close', () => {
    console.log('Finished in', Date.now() - t0, 'ms');
    console.log('Success, itemsParse:', itemsParse.length, 'i (lines):', i);
});
