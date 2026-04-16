const DiskManager = require('../../src/main/systems/diskManager.js');

const dm = new DiskManager({ wiztree: ['c:/test/wiztree'], es: [] });
dm.runWizTreeExport = async () => {}; // mock
dm.parseRootFoldersFromCsv = async () => [
  { fullPath: 'C:\\Users', name: 'Users', sizeBytes: 1000 },
  { fullPath: 'C:\\Windows', name: 'Windows', sizeBytes: 2000 }
];
const payload = dm.buildCompactPayload('C:\\', [
  { fullPath: 'C:\\Users', name: 'Users', sizeBytes: 1000 },
  { fullPath: 'C:\\Windows', name: 'Windows', sizeBytes: 2000 }
]);
console.log('SYNC:', JSON.stringify(payload, null, 2));

dm.findExistingTool = () => 'mock.exe';

dm.ghostScanDisk({ send: () => {} }, 'C:\\')
  .then(res => console.log('ASYNC:', JSON.stringify(res, null, 2)))
  .catch(e => console.error(e));
