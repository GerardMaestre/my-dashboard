const fs = require('fs');
const text = fs.readFileSync('src/renderer.js', 'utf-8');

const utilsFuncs = ['formatBytes', 'getFileIconFromPath', 'getAppIcon', 'buildFileUrl', 'extractIconPath', 'safeText', 'safeId', 'getElementId', 'escapeRegExp'];
const utilBlocks = [];
let newText = text;

utilsFuncs.forEach(func => {
    let matchStr = 'function ' + func;
    let idx = newText.indexOf(matchStr);
    if(idx !== -1) {
        let braces = 0;
        let end = idx;
        let started = false;
        for(let i=idx; i<newText.length; i++){
            if(newText[i] === '{') { braces++; started=true; }
            else if(newText[i] === '}') { braces--; }
            if(started && braces === 0) { end = i+1; break; }
        }
        utilBlocks.push(newText.substring(idx, end));
        newText = newText.substring(0, idx) + newText.substring(end);
    }
});

fs.writeFileSync('src/utils.js', utilBlocks.join('\n\n') + '\n', 'utf-8');

const stateVars = ['let favoritesList', 'let autostartList', 'const autopilotTasks', 'const silentRuns', 'const ghostState'];
const stateBlocks = [];

stateVars.forEach(v => {
    let idx = newText.indexOf(v);
    if(idx !== -1) {
        let braces = 0;
        let brackets = 0;
        let end = idx;
        for(let i = idx; i < newText.length; i++){
            if(newText[i] === '{') braces++;
            else if(newText[i] === '}') braces--;
            else if(newText[i] === '[') brackets++;
            else if(newText[i] === ']') brackets--;
            else if(newText[i] === ';' && braces === 0 && brackets === 0) {
                end = i+1; break;
            }
        }
        stateBlocks.push(newText.substring(idx, end));
        newText = newText.substring(0, idx) + newText.substring(end);
    }
});

fs.writeFileSync('src/state.js', stateBlocks.join('\n\n') + '\n', 'utf-8');
fs.writeFileSync('src/renderer.js', newText, 'utf-8');
console.log('done fixing.');
