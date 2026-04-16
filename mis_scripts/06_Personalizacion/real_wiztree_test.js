const { DiskManager } = require('../../src/main/systems/diskManager.js'); // wait, it's const DiskManager
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const DiskManagerCls = require('../../src/main/systems/diskManager.js');
const dm = new DiskManagerCls({ wiztree: ['c:/Users/gerar/Desktop/mi-dashboard/mis_scripts/tools/WizTree/WizTree64.exe', 'C:/Program Files/WizTree/WizTree.exe', 'C:/Program Files (x86)/WizTree/WizTree.exe'], es: [] });

dm.toolCandidates = { wiztree: ['C:/Program Files/WizTree/WizTree64.exe', 'C:/Program Files/WizTree/WizTree.exe'] };
const exe = dm.findExistingTool(dm.toolCandidates.wiztree);
if (!exe) {
    console.log('Wiztree not found');
    process.exit(1);
}

const tmpPath = path.join(os.tmpdir(), 'wiztest-real-export.csv');
console.log('Running wiztree...');
execFile(exe, ['C:\\', '/export=' + tmpPath, '/exportencoding=UTF8', '/admin=1'], (err, stdout, stderr) => {
    if (err) {
        console.error('Error running wiztree', err);
    }
    const txt = fs.readFileSync(tmpPath, 'utf8');
    const lines = txt.split('\n').slice(0, 5);
    console.log('First 5 lines:');
    lines.forEach(l => console.log(l));
});
