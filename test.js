const fs = require('fs');

try {
    console.log('Loading CSV...');
    const buf = fs.readFileSync('C:\\Users\\gerar\\AppData\\Roaming\\HorusEngine\\wiztree-export.csv');
    console.log('Loaded buffer size:', buf.length);
    const csvRaw = buf.toString('utf8');
    console.log('Parsed string length:', csvRaw.length);

    const itemsParse = [];
    const extMap = new Map();
    let totalFilesBytes = 0;
    const normBase = 'c:\\program files\\';

    let startIndex = csvRaw.indexOf('\n') + 1;
    let i = 0;
    
    console.log('Starting scan...');
    const t0 = Date.now();
    
    while (startIndex > 0 && startIndex < csvRaw.length) {
        let lineEnd = csvRaw.indexOf('\n', startIndex);
        if (lineEnd === -1) lineEnd = csvRaw.length;
        
        const firstComma = csvRaw.indexOf('",', startIndex);
        if (firstComma !== -1 && firstComma < lineEnd) {
            let fullPath = csvRaw.substring(startIndex + 1, firstComma).replace(/\\\\/g, '\\');
            const fullPathLower = fullPath.toLowerCase();

            const restStart = firstComma + 2;
            const nextComma = csvRaw.indexOf(',', restStart);
            const sizeBytes = Number(csvRaw.substring(restStart, nextComma !== -1 && nextComma < lineEnd ? nextComma : lineEnd)) || 0;

            let attrsEnd = lineEnd;
            if (csvRaw[attrsEnd - 1] === '\r') attrsEnd--;

            let commaCount = 0;
            let lastAttrComma = attrsEnd;
            for (let k = attrsEnd - 1; k >= restStart; k--) {
                if (csvRaw[k] === ',') {
                    commaCount++;
                    if (commaCount === 2) {
                        lastAttrComma = k;
                    } else if (commaCount === 3) {
                        const attributes = Number(csvRaw.substring(k + 1, lastAttrComma)) || 0;
                        const isDir = (attributes & 16) !== 0;

                        if (fullPath && sizeBytes > 0) {
                            if (fullPathLower.startsWith(normBase) && fullPath.length > normBase.length) {
                                const subPath = fullPath.substring(normBase.length);
                                const slashIdx = subPath.indexOf('\\');
                                if (slashIdx === -1 || slashIdx === subPath.length - 1) {
                                    itemsParse.push({ id: `wiz-${i}`, fullPath, sizeBytes, isDir });
                                }
                            }
                            
                            if (!isDir) {
                                totalFilesBytes += sizeBytes;
                                const idxDot = fullPath.lastIndexOf('.');
                                const idxSlash = fullPath.lastIndexOf('\\');
                                if (idxDot > idxSlash) {
                                    const ext = fullPath.substring(idxDot).toLowerCase();
                                    extMap.set(ext, (extMap.get(ext) || 0) + sizeBytes);
                                } else {
                                    extMap.set('otros', (extMap.get('otros') || 0) + sizeBytes);
                                }
                            }
                        }
                        break;
                    }
                }
            }
        }
        startIndex = lineEnd + 1;
        i++;
    }
    console.log('Finished in', Date.now() - t0, 'ms');
    console.log('Success, itemsParse:', itemsParse.length, 'i (lines):', i);
} catch (e) {
    console.error('Fatal error:', e);
}
