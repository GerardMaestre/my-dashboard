const { execFile } = require('child_process');
const path = require('path');

const wiztreePath = 'C:\\Users\\gerar\\Desktop\\mi-dashboard\\my-app\\mis_scripts\\tools\\WizTree64.exe';
const driveLetter = 'C';
const tempCsv = path.join(process.env.APPDATA, 'HorusEngine', `wiztree-export-${driveLetter}.csv`);

console.log('Running with tempCsv:', tempCsv);

execFile(
    wiztreePath,
    [`${driveLetter}:\\`, `/export=${tempCsv}`],
    { windowsHide: false },
    (err, stdout, stderr) => {
        console.log('Err:', err);
        console.log('Stdout:', stdout);
        console.log('Stderr:', stderr);
    }
);
