const { spawn } = require('child_process');
const p = spawn('cmd.exe', ['/c', 'start', '""', 'cmd.exe', '/d', '/k', 'echo', 'Hello World'], {
  windowsHide: true,
  detached: true,
  stdio: 'ignore'
});
p.unref();
console.log('started');
