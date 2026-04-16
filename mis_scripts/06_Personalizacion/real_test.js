const DiskManager = require('../../src/main/systems/diskManager.js');
const dm = new DiskManager({ wiztree: ['c:/test/wiztree'], es: [] });
const csvPath = 'c:\\Users\\gerar\\Desktop\\mi-dashboard\\my-app\\mis_scripts\\06_Personalizacion\\wiztest.csv';

dm.parseRootFoldersFromCsv(csvPath, 'C:\\', { send: () => {} })
  .then(res => console.log('Parsed items:', res))
  .catch(e => console.error(e));
