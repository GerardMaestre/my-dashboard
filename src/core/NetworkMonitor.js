const { spawn } = require('child_process');
const net = require('net');

const NETSTAT_BINARY = 'netstat.exe';
const NETSTAT_ARGS = ['-ano'];
const FIREWALL_BINARY = 'netsh.exe';
const FIREWALL_ELEVATION_REGEX = /access is denied|requires elevation|elevaci[oó]n|denegado/i;

const DANGEROUS_PORTS = new Map([
  [21, 'FTP'],
  [22, 'SSH'],
  [23, 'Telnet'],
  [25, 'SMTP'],
  [53, 'DNS'],
  [80, 'HTTP'],
  [110, 'POP3'],
  [135, 'RPC'],
  [139, 'NetBIOS'],
  [443, 'HTTPS'],
  [445, 'SMB'],
  [1433, 'MSSQL'],
  [3306, 'MySQL'],
  [3389, 'RDP'],
  [5900, 'VNC'],
  [8080, 'HTTP-ALT']
]);

const IPV4_REGEX = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6_REGEX = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

function parseAddressToken(token) {
  const raw = String(token || '').trim();
  if (!raw || raw === '*:*') {
    return { ip: '*', port: '*' };
  }

  // netstat para IPv6 suele devolver formato [ip]:puerto
  const bracketMatch = raw.match(/^\[([^\]]+)]:(\d+|\*)$/);
  if (bracketMatch) {
    return { ip: bracketMatch[1], port: bracketMatch[2] };
  }

  const lastColon = raw.lastIndexOf(':');
  if (lastColon === -1) {
    return { ip: raw, port: '' };
  }

  return {
    ip: raw.slice(0, lastColon),
    port: raw.slice(lastColon + 1)
  };
}

function normalizeIpForFirewall(ip) {
  const normalized = String(ip || '').trim().replace(/^\[/, '').replace(/]$/, '');
  return normalized.split('%')[0];
}

function isBlockableIp(ip) {
  const normalized = normalizeIpForFirewall(ip);
  if (!normalized) return false;
  if (normalized === '*' || normalized === '0.0.0.0' || normalized === '::') return false;
  if (normalized === '127.0.0.1' || normalized === '::1') return false;
  return IPV4_REGEX.test(normalized) || IPV6_REGEX.test(normalized);
}

function parseNetstatOutput(stdout) {
  const lines = String(stdout || '').split(/\r?\n/);
  const parsed = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    const protocol = (parts[0] || '').toUpperCase();

    if (protocol !== 'TCP' && protocol !== 'UDP') {
      continue;
    }

    let localToken = '';
    let remoteToken = '';
    let state = '';
    let pidToken = '';

    if (protocol === 'TCP') {
      if (parts.length < 5) continue;
      localToken = parts[1];
      remoteToken = parts[2];
      state = parts[3];
      pidToken = parts[4];
    } else {
      if (parts.length < 4) continue;
      localToken = parts[1];
      remoteToken = parts[2];
      state = 'UNCONNECTED';
      pidToken = parts[3];
    }

    const local = parseAddressToken(localToken);
    const remote = parseAddressToken(remoteToken);

    parsed.push({
      id: `${protocol}-${local.ip}:${local.port}-${remote.ip}:${remote.port}-${pidToken}`,
      protocol,
      localIp: local.ip,
      localPort: local.port,
      remoteIp: remote.ip,
      remotePort: remote.port,
      state,
      pid: Number(pidToken) || null,
      timestamp: Date.now()
    });
  }

  return parsed;
}

function detectListeningPorts(connections = [], { dangerousOnly = false } = {}) {
  const results = [];
  const seen = new Set();

  for (const connection of connections) {
    const protocol = String(connection.protocol || '').toUpperCase();
    const state = String(connection.state || '').toUpperCase();
    const localPort = Number.parseInt(String(connection.localPort || ''), 10);
    const localIp = String(connection.localIp || '').trim();

    if (protocol !== 'TCP') continue;
    if (state !== 'LISTENING') continue;
    if (!Number.isFinite(localPort) || localPort <= 0) continue;
    if (dangerousOnly && !DANGEROUS_PORTS.has(localPort)) continue;

    const boundToAllInterfaces = localIp === '0.0.0.0' || localIp === '::' || localIp === '[::]';
    const loopbackOnly = localIp === '127.0.0.1' || localIp === '::1' || localIp === '[::1]';

    const id = `${protocol}-${localIp}-${localPort}`;
    if (seen.has(id)) continue;
    seen.add(id);

    results.push({
      id,
      protocol,
      localIp,
      localPort,
      service: DANGEROUS_PORTS.get(localPort) || 'CUSTOM',
      boundToAllInterfaces,
      loopbackOnly,
      externallyExposed: boundToAllInterfaces,
      timestamp: Date.now()
    });
  }

  return results;
}

function detectDangerousListeningPorts(connections = []) {
  return detectListeningPorts(connections, { dangerousOnly: true });
}

function probeLocalPort(port, timeoutMs = 260) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let finished = false;

    const finish = (isOpen) => {
      if (finished) return;
      finished = true;
      try { socket.destroy(); } catch (_) {}
      resolve(isOpen);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));

    try {
      socket.connect(port, '127.0.0.1');
    } catch (_) {
      finish(false);
    }
  });
}

async function scanDangerousLocalPorts(listeningSnapshot = []) {
  const listeningByPort = new Map();
  for (const entry of listeningSnapshot) {
    const key = Number(entry.localPort);
    if (!listeningByPort.has(key)) listeningByPort.set(key, []);
    listeningByPort.get(key).push(entry);
  }

  const ports = Array.from(DANGEROUS_PORTS.keys());
  const checks = await Promise.all(ports.map(async (port) => ({
    port,
    open: await probeLocalPort(port)
  })));

  const now = Date.now();
  return checks
    .filter((item) => item.open)
    .map((item) => {
      const listeners = listeningByPort.get(item.port) || [];
      const boundToAllInterfaces = listeners.some((entry) => entry.boundToAllInterfaces || entry.externallyExposed);

      return {
        id: `LOCAL-${item.port}`,
        protocol: 'TCP',
        localIp: '127.0.0.1',
        localPort: item.port,
        service: DANGEROUS_PORTS.get(item.port),
        listeners: listeners.map((entry) => entry.localIp),
        boundToAllInterfaces,
        externallyExposed: boundToAllInterfaces,
        timestamp: now
      };
    });
}

function runCommand(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      shell: false
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

class NetworkMonitor {
  constructor({ intervalMs = 3000, broadcastConnections = () => {}, logger = console } = {}) {
    this.intervalMs = intervalMs;
    this.broadcastConnections = broadcastConnections;
    this.logger = logger;
    this.timerRef = null;
    this.isScanning = false;
    this.ipcRegistered = false;
  }

  start() {
    if (this.timerRef) return;

    // Primer barrido inmediato para no esperar al primer intervalo.
    this.scanActiveConnections();

    this.timerRef = setInterval(() => {
      this.scanActiveConnections();
    }, this.intervalMs);
  }

  stop() {
    if (!this.timerRef) return;
    clearInterval(this.timerRef);
    this.timerRef = null;
  }

  async scanActiveConnections() {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      const { exitCode, stdout, stderr } = await runCommand(NETSTAT_BINARY, NETSTAT_ARGS);
      if (exitCode !== 0) {
        this.logger.error('[NetworkMonitor] netstat fallo:', (stderr || '').trim() || `exitCode=${exitCode}`);
        return;
      }

      const connections = parseNetstatOutput(stdout);
      const listeningSnapshot = detectListeningPorts(connections);
      const dangerousListeningSnapshot = listeningSnapshot.filter((entry) => DANGEROUS_PORTS.has(Number(entry.localPort)));
      const dangerousLocalPorts = await scanDangerousLocalPorts(dangerousListeningSnapshot);
      this.broadcastConnections(connections, dangerousLocalPorts, listeningSnapshot);
    } catch (error) {
      this.logger.error('[NetworkMonitor] Error escaneando conexiones:', error.message);
    } finally {
      this.isScanning = false;
    }
  }

  async bloquearIP(ip) {
    const cleanIp = normalizeIpForFirewall(ip);
    if (!isBlockableIp(cleanIp)) {
      const invalidIpError = new Error(`IP no valida para bloqueo: ${ip}`);
      invalidIpError.code = 'INVALID_IP';
      throw invalidIpError;
    }

    const ruleName = `Bloqueo_Dashboard_${cleanIp}`;
    const args = [
      'advfirewall',
      'firewall',
      'add',
      'rule',
      `name=${ruleName}`,
      'dir=in',
      'action=block',
      `remoteip=${cleanIp}`
    ];

    const { exitCode, stdout, stderr } = await runCommand(FIREWALL_BINARY, args);
    const output = `${stdout || ''}\n${stderr || ''}`.trim();

    if (exitCode !== 0) {
      const firewallError = new Error(
        output || `No se pudo crear la regla de firewall para ${cleanIp} (exitCode=${exitCode})`
      );
      firewallError.code = FIREWALL_ELEVATION_REGEX.test(output) ? 'ELEVATION_REQUIRED' : 'FIREWALL_ERROR';
      firewallError.details = output;
      throw firewallError;
    }

    return {
      ok: true,
      ip: cleanIp,
      ruleName,
      message: output || `Regla creada para ${cleanIp}`
    };
  }

  registerIpc(ipcMain) {
    if (!ipcMain || typeof ipcMain.handle !== 'function') {
      throw new Error('ipcMain invalido para registrar canales de red');
    }

    if (this.ipcRegistered) return;

    // Evitar duplicados al recargar en desarrollo.
    ipcMain.removeHandler('block-ip');

    ipcMain.handle('block-ip', async (_event, ip) => {
      try {
        return await this.bloquearIP(ip);
      } catch (error) {
        return {
          ok: false,
          code: error.code || 'UNKNOWN_ERROR',
          error: error.message,
          details: error.details || ''
        };
      }
    });

    this.ipcRegistered = true;
  }
}

module.exports = {
  NetworkMonitor,
  parseNetstatOutput,
  detectListeningPorts,
  detectDangerousListeningPorts,
  scanDangerousLocalPorts
};
