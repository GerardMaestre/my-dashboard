const fs = require('fs');
let text = fs.readFileSync('src/preload.js', 'utf8');
let pay = fs.readFileSync('payload.txt', 'utf8');
pay = pay.replace(/\$\$/g, '$');

const sIdx = text.indexOf('async function ghostUninstallApp(payload, force = false) {');
const eIdx = text.indexOf('function getScriptInfo(fileName) {');

if (sIdx !== -1 && eIdx !== -1) {
    text = text.substring(0, sIdx) + pay + '\n  ' + text.substring(eIdx);
    fs.writeFileSync('src/preload.js', text, 'utf8');
}
