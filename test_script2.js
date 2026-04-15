const { spawn } = require('child_process');
const p = spawn('cmd.exe', ['/c', 'start', '""', 'cmd.exe', '/d', '/c', 'python', '-c', 'print(\"success\") & pause'], {
  windowsHide: true,
  detached: true,
  stdio: 'ignore'
});
p.unref();
console.log('started');
