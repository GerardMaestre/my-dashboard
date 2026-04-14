const DEFAULT_WATCHLIST_IPS = [
    '185.143.223.11',
    '45.9.148.108'
];

const DEFAULT_RISK_COUNTRIES = ['RU', 'KP', 'IR'];
const DEFAULT_ASN_KEYWORDS = ['bulletproof', 'malware'];
const DEFAULT_TRUSTED_PROVIDER_KEYWORDS = [
    'google',
    'microsoft',
    'cloudflare',
    'akamai',
    'amazon',
    'aws',
    'fastly',
    'apple',
    'meta',
    'facebook',
    'discord',
    'openai'
];

const RISKY_REMOTE_PORTS = new Set([23, 2323, 445, 3389, 4444, 5555, 5900, 6667, 31337]);

const STORAGE_RULES_KEY = 'horus_radar_threat_rules_v1';
const STORAGE_HISTORY_KEY = 'horus_radar_threat_history_v1';

const SUPPRESS_IP_MS = 15000;
const HISTORY_LIMIT = 500;
const SUSPICIOUS_BASE_RADIUS = 6.8;
const NORMAL_BASE_RADIUS = 3.4;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function toNumberPort(value) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeIp(rawIp) {
    let ip = String(rawIp || '').trim();
    if (!ip) return '';
    ip = ip.replace(/^\[/, '').replace(/]$/, '');
    ip = ip.replace(/^::ffff:/i, '');
    ip = ip.split('%')[0];
    return ip;
}

function isPrivateIpv4(ip) {
    const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;

    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    return false;
}

function isInternalIp(ip) {
    const normalized = normalizeIp(ip);
    if (!normalized) return true;
    if (normalized === '*' || normalized === '0.0.0.0' || normalized === '::') return true;
    if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') return true;

    if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) {
        return isPrivateIpv4(normalized);
    }

    if (/^(fc|fd|fe80)/i.test(normalized)) return true;
    return false;
}

function hashString(input) {
    let hash = 0;
    for (let idx = 0; idx < input.length; idx += 1) {
        hash = ((hash << 5) - hash) + input.charCodeAt(idx);
        hash |= 0;
    }
    return Math.abs(hash);
}

function escapeHtml(input) {
    return String(input || '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

function formatClock(timestampMs) {
    if (!timestampMs || Number.isNaN(timestampMs)) return '--:--:--';
    const date = new Date(timestampMs);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

function normalizeCountryCode(value) {
    const country = String(value || '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(country) ? country : '';
}

function parseDelimited(rawValue) {
    return String(rawValue || '')
        .split(/[\n,;]+/g)
        .map((item) => item.trim())
        .filter(Boolean);
}

function normalizeIpList(rawValue) {
    const values = Array.isArray(rawValue) ? rawValue : parseDelimited(rawValue);
    const normalized = values.map((item) => normalizeIp(item)).filter(Boolean);
    return Array.from(new Set(normalized));
}

function normalizeCountryList(rawValue) {
    const values = Array.isArray(rawValue) ? rawValue : parseDelimited(rawValue);
    const normalized = values.map((item) => normalizeCountryCode(item)).filter(Boolean);
    return Array.from(new Set(normalized));
}

function normalizeKeywordList(rawValue) {
    const values = Array.isArray(rawValue) ? rawValue : parseDelimited(rawValue);
    const normalized = values
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => item.length >= 3);
    return Array.from(new Set(normalized));
}

function buildRules(raw = null) {
    const watchlistIps = normalizeIpList(raw?.watchlistIps || DEFAULT_WATCHLIST_IPS);
    const riskCountries = normalizeCountryList(raw?.riskCountries || DEFAULT_RISK_COUNTRIES);
    const asnKeywords = normalizeKeywordList(raw?.asnKeywords || DEFAULT_ASN_KEYWORDS);
    const trustedProviderKeywords = normalizeKeywordList(raw?.trustedProviderKeywords || DEFAULT_TRUSTED_PROVIDER_KEYWORDS);

    return {
        watchlistIps,
        riskCountries,
        asnKeywords,
        trustedProviderKeywords,
        watchlistSet: new Set(watchlistIps),
        countrySet: new Set(riskCountries)
    };
}

function loadRulesFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_RULES_KEY);
        if (!raw) return buildRules();
        const parsed = JSON.parse(raw);
        return buildRules(parsed);
    } catch (_error) {
        return buildRules();
    }
}

function saveRulesToStorage(rules) {
    const serializable = {
        watchlistIps: rules.watchlistIps,
        riskCountries: rules.riskCountries,
        asnKeywords: rules.asnKeywords,
        trustedProviderKeywords: rules.trustedProviderKeywords
    };
    localStorage.setItem(STORAGE_RULES_KEY, JSON.stringify(serializable));
}

function loadHistoryFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_HISTORY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
        return [];
    }
}

function saveHistoryToStorage(history) {
    localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
}

function csvEscape(value) {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
}

function exportHistoryCsv(rows) {
    const header = [
        'timestamp',
        'ip',
        'port',
        'protocol',
        'reason',
        'country',
        'asn',
        'isp',
        'firewall_status',
        'rule_name'
    ];

    const lines = [header.join(',')];
    for (const row of rows) {
        lines.push([
            csvEscape(row.timestamp),
            csvEscape(row.ip),
            csvEscape(row.port),
            csvEscape(row.protocol),
            csvEscape(row.reason),
            csvEscape(row.country),
            csvEscape(row.asn),
            csvEscape(row.isp),
            csvEscape(row.firewallStatus),
            csvEscape(row.ruleName)
        ].join(','));
    }

    const csvContent = `\uFEFF${lines.join('\n')}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const day = new Date().toISOString().slice(0, 10);
    anchor.download = `radar_threat_history_${day}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
}

function createLayoutSeed(nodeId, suspicious) {
    const hash = hashString(nodeId);
    const angle = (hash % 360) * (Math.PI / 180);
    const rawBand = suspicious
        ? 0.52 + (((hash >> 7) % 38) / 100)
        : 0.16 + (((hash >> 6) % 66) / 100);
    const radiusFactor = clamp(rawBand, 0.12, 0.95);

    return { angle, radiusFactor };
}

export function initRadarSystem({
    containerId = 'network-radar',
    statusId = 'network-radar-status',
    modalId = 'network-node-modal',
    rulesButtonId = 'network-radar-rules-btn',
    exportButtonId = 'network-radar-export-btn',
    rulesModalId = 'network-radar-rules-modal',
    rulesIpsId = 'network-rules-ips',
    rulesCountriesId = 'network-rules-countries',
    rulesAsnId = 'network-rules-asn',
    rulesSaveId = 'network-rules-save',
    rulesCancelId = 'network-rules-cancel',
    onNotify = () => {},
    onLog = () => {}
} = {}) {
    const d3 = window.d3;
    const container = document.getElementById(containerId);
    const statusEl = document.getElementById(statusId);
    const modalEl = document.getElementById(modalId);

    const rulesBtn = document.getElementById(rulesButtonId);
    const exportBtn = document.getElementById(exportButtonId);
    const rulesModalEl = document.getElementById(rulesModalId);
    const rulesIpsEl = document.getElementById(rulesIpsId);
    const rulesCountriesEl = document.getElementById(rulesCountriesId);
    const rulesAsnEl = document.getElementById(rulesAsnId);
    const rulesSaveEl = document.getElementById(rulesSaveId);
    const rulesCancelEl = document.getElementById(rulesCancelId);

    if (!container || !statusEl || !modalEl) {
        return { destroy: () => {} };
    }

    if (!d3) {
        statusEl.textContent = 'Radar offline: D3 no cargado';
        onNotify('Radar de red no disponible (D3 no cargado)', 'error');
        return { destroy: () => {} };
    }

    let rules = loadRulesFromStorage();
    let threatHistory = loadHistoryFromStorage();

    const ipIntelCache = new Map();
    const pendingIntelLookups = new Set();

    const svg = d3.select(container).append('svg').attr('class', 'network-radar-svg');
    const defs = svg.append('defs');
    const sweepGradientId = `radar-sweep-${Date.now()}`;

    const sweepGradient = defs.append('linearGradient')
        .attr('id', sweepGradientId)
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '100%')
        .attr('y2', '0%');

    sweepGradient.append('stop').attr('offset', '0%').attr('stop-color', 'rgba(82, 232, 255, 0.05)');
    sweepGradient.append('stop').attr('offset', '70%').attr('stop-color', 'rgba(82, 232, 255, 0.4)');
    sweepGradient.append('stop').attr('offset', '100%').attr('stop-color', 'rgba(82, 232, 255, 0.96)');

    const radarLayer = svg.append('g').attr('class', 'radar-background-layer');
    const fxLayer = svg.append('g').attr('class', 'radar-fx-layer');
    const nodesLayer = svg.append('g').attr('class', 'radar-nodes-layer');
    const listenersLayer = svg.append('g').attr('class', 'radar-listeners-layer');
    const sweepLayer = svg.append('g').attr('class', 'radar-sweep-layer');

    const sweepCone = sweepLayer.append('path').attr('class', 'radar-sweep-cone');
    const sweepLine = sweepLayer.append('line')
        .attr('class', 'radar-sweep-line')
        .attr('stroke', `url(#${sweepGradientId})`)
        .attr('stroke-width', 2.2)
        .attr('stroke-linecap', 'round');

    let width = 0;
    let height = 0;
    let centerX = 0;
    let centerY = 0;
    let radarRadius = 0;
    let sweepAngle = 0;
    let sweepPausedUntil = 0;
    let rafId = null;

    let latestConnections = [];
    let latestExposureSnapshot = [];
    let latestListenersSnapshot = [];
    let latestNodes = [];
    let lastUpdateAt = 0;
    const layoutCache = new Map();
    const suppressedIps = new Map();
    let activeThreat = null;

    function updateStatusText(activeCount = 0, suspiciousCount = 0, customText = '') {
        if (customText) {
            statusEl.textContent = customText;
            return;
        }
        const dangerousListening = latestExposureSnapshot.length;
        const globallyBound = latestExposureSnapshot.filter((entry) => entry.boundToAllInterfaces || entry.externallyExposed).length;
        const exposurePreview = dangerousListening > 0
            ? ` | Puertos script: ${latestExposureSnapshot.slice(0, 3).map((entry) => `${entry.localPort}/${entry.service}${(entry.boundToAllInterfaces || entry.externallyExposed) ? '!' : ''}`).join(', ')}`
            : ' | Puertos script: ninguno';

        const listenersCount = latestListenersSnapshot.length;
        const loopbackOnly = latestListenersSnapshot.filter((entry) => entry.loopbackOnly).length;
        const listenersPreview = listenersCount > 0
            ? latestListenersSnapshot
                .slice()
                .sort((a, b) => Number(a.localPort) - Number(b.localPort))
                .slice(0, 5)
                .map((entry) => `${entry.localPort}${entry.loopbackOnly ? '@lo' : ''}${entry.boundToAllInterfaces ? '!' : ''}`)
                .join(', ')
            : 'ninguno';

        statusEl.textContent = `${activeCount} conexiones activas | ${suspiciousCount} amenazas potenciales | ${threatHistory.length} neutralizadas | Listeners locales: ${listenersCount} (${loopbackOnly} loopback) [${listenersPreview}] | Script puertos abiertos: ${dangerousListening} (${globallyBound} en escucha global)${exposurePreview} | Tick ${formatClock(lastUpdateAt)}`;
    }

    function setExposureSnapshot(exposures = []) {
        latestExposureSnapshot = Array.isArray(exposures) ? exposures : [];
        lastUpdateAt = Date.now();
        updateStatusText(
            latestNodes.length,
            latestNodes.filter((node) => node.suspicious).length
        );
    }

    function setListenersSnapshot(listeners = []) {
        latestListenersSnapshot = Array.isArray(listeners) ? listeners : [];
        lastUpdateAt = Date.now();
        updateStatusText(
            latestNodes.length,
            latestNodes.filter((node) => node.suspicious).length
        );
    }

    function pruneSuppressed(now) {
        for (const [ip, expiresAt] of suppressedIps.entries()) {
            if (expiresAt <= now) suppressedIps.delete(ip);
        }
    }

    function appendHistory(row) {
        threatHistory.unshift(row);
        if (threatHistory.length > HISTORY_LIMIT) {
            threatHistory = threatHistory.slice(0, HISTORY_LIMIT);
        }
        saveHistoryToStorage(threatHistory);
    }

    function hideTacticalModal() {
        activeThreat = null;
        modalEl.classList.add('hidden');
        modalEl.innerHTML = '';
    }

    function showRulesModal() {
        if (!rulesModalEl) return;
        if (rulesIpsEl) rulesIpsEl.value = rules.watchlistIps.join('\n');
        if (rulesCountriesEl) rulesCountriesEl.value = rules.riskCountries.join(', ');
        if (rulesAsnEl) rulesAsnEl.value = rules.asnKeywords.join(', ');
        rulesModalEl.classList.remove('hidden');
    }

    function hideRulesModal() {
        if (!rulesModalEl) return;
        rulesModalEl.classList.add('hidden');
    }

    function saveRulesFromModal() {
        const nextRules = buildRules({
            watchlistIps: rulesIpsEl ? rulesIpsEl.value : rules.watchlistIps,
            riskCountries: rulesCountriesEl ? rulesCountriesEl.value : rules.riskCountries,
            asnKeywords: rulesAsnEl ? rulesAsnEl.value : rules.asnKeywords
        });

        rules = nextRules;
        saveRulesToStorage(rules);
        hideRulesModal();

        onNotify('Reglas de deteccion actualizadas', 'success');
        onLog('[Radar] Reglas avanzadas actualizadas (IP, pais, ASN)', 'system');

        if (latestConnections.length > 0) {
            renderNodes(latestConnections);
        }
    }

    function queueIntelLookup(ip) {
        const normalized = normalizeIp(ip);
        if (!normalized) return;
        if (isInternalIp(normalized)) return;
        if (!window.api || typeof window.api.lookupIpIntel !== 'function') return;
        if (ipIntelCache.has(normalized)) return;
        if (pendingIntelLookups.has(normalized)) return;

        pendingIntelLookups.add(normalized);
        window.api.lookupIpIntel(normalized)
            .then((result) => {
                if (result && typeof result === 'object') {
                    ipIntelCache.set(normalized, result);
                } else {
                    ipIntelCache.set(normalized, { ok: false, ip: normalized, error: 'Respuesta vacia de intel' });
                }
            })
            .catch((error) => {
                ipIntelCache.set(normalized, { ok: false, ip: normalized, error: error.message || String(error) });
            })
            .finally(() => {
                pendingIntelLookups.delete(normalized);
                if (latestConnections.length > 0) renderNodes(latestConnections);
            });
    }

    function buildBackground() {
        const rings = [0.2, 0.4, 0.6, 0.8, 1];
        radarLayer.selectAll('circle.radar-ring')
            .data(rings)
            .join('circle')
            .attr('class', 'radar-ring')
            .attr('cx', centerX)
            .attr('cy', centerY)
            .attr('r', (ratio) => ratio * radarRadius);

        const crosshairData = [
            { x1: centerX - radarRadius, y1: centerY, x2: centerX + radarRadius, y2: centerY },
            { x1: centerX, y1: centerY - radarRadius, x2: centerX, y2: centerY + radarRadius },
            {
                x1: centerX - (radarRadius * 0.71),
                y1: centerY - (radarRadius * 0.71),
                x2: centerX + (radarRadius * 0.71),
                y2: centerY + (radarRadius * 0.71)
            },
            {
                x1: centerX - (radarRadius * 0.71),
                y1: centerY + (radarRadius * 0.71),
                x2: centerX + (radarRadius * 0.71),
                y2: centerY - (radarRadius * 0.71)
            }
        ];

        radarLayer.selectAll('line.radar-crosshair')
            .data(crosshairData)
            .join('line')
            .attr('class', 'radar-crosshair')
            .attr('x1', (line) => line.x1)
            .attr('y1', (line) => line.y1)
            .attr('x2', (line) => line.x2)
            .attr('y2', (line) => line.y2);

        radarLayer.selectAll('circle.radar-core')
            .data([1])
            .join('circle')
            .attr('class', 'radar-core')
            .attr('cx', centerX)
            .attr('cy', centerY)
            .attr('r', Math.max(4, radarRadius * 0.018));
    }

    function updateSweepGeometry() {
        const coneWidth = Math.PI / 16;
        const startX = centerX + Math.cos(-coneWidth) * radarRadius;
        const startY = centerY + Math.sin(-coneWidth) * radarRadius;
        const endX = centerX + Math.cos(coneWidth) * radarRadius;
        const endY = centerY + Math.sin(coneWidth) * radarRadius;
        const path = `M ${centerX} ${centerY} L ${startX} ${startY} A ${radarRadius} ${radarRadius} 0 0 1 ${endX} ${endY} Z`;

        sweepCone.attr('d', path);
        sweepLine
            .attr('x1', centerX)
            .attr('y1', centerY)
            .attr('x2', centerX + radarRadius)
            .attr('y2', centerY);
    }

    function assessThreat(connection, intel) {
        const reasons = [];
        const remoteIp = normalizeIp(connection.remoteIp);
        const remotePort = toNumberPort(connection.remotePort);
        const state = String(connection.state || '').toUpperCase();

        const watchlistHit = rules.watchlistSet.has(remoteIp);
        const isExternal = !isInternalIp(remoteIp);
        const highRiskRemotePort = remotePort !== null && RISKY_REMOTE_PORTS.has(remotePort);
        const activeState = state === 'ESTABLISHED' || state === 'SYN_SENT' || state === 'SYN_RECEIVED';

        if (watchlistHit) {
            reasons.push('ip_watchlist');
        }

        if (isExternal && activeState && highRiskRemotePort) {
            reasons.push('puerto_remoto_alto_riesgo');
        }

        let providerText = '';
        let trustedProvider = false;

        if (intel && intel.ok) {
            const countryCode = normalizeCountryCode(intel.countryCode);
            providerText = `${intel.asn || ''} ${intel.isp || ''} ${intel.org || ''}`.toLowerCase();

            trustedProvider = rules.trustedProviderKeywords.some((keyword) => providerText.includes(keyword));

            if (countryCode && rules.countrySet.has(countryCode)) {
                reasons.push(`pais_riesgo_${countryCode}`);
            }

            for (const keyword of rules.asnKeywords) {
                if (providerText.includes(keyword)) {
                    reasons.push(`asn_keyword_${keyword}`);
                    break;
                }
            }
        }

        // Si no hay intel y no está en watchlist ni en puerto crítico, priorizamos no alertar.
        if ((!intel || !intel.ok) && !watchlistHit && !highRiskRemotePort) {
            return {
                suspicious: false,
                reasons: [],
                trustedProvider: false
            };
        }

        // Proveedores ampliamente confiables no se marcan como amenaza salvo que estén en watchlist.
        if (trustedProvider && !watchlistHit) {
            return {
                suspicious: false,
                reasons: [],
                trustedProvider: true
            };
        }

        return {
            suspicious: reasons.length > 0,
            reasons,
            trustedProvider
        };
    }

    function computeNodeView(connections) {
        const now = Date.now();
        pruneSuppressed(now);

        return connections
            .filter((connection) => String(connection.remoteIp || '').trim() && String(connection.remoteIp).trim() !== '*')
            .filter((connection) => {
                const protocol = String(connection.protocol || '').toUpperCase();
                const state = String(connection.state || '').toUpperCase();
                const remotePort = String(connection.remotePort || '').trim();

                if (protocol === 'TCP') {
                    return state === 'ESTABLISHED' || state === 'SYN_SENT' || state === 'SYN_RECEIVED';
                }

                if (protocol === 'UDP') {
                    return remotePort !== '' && remotePort !== '*' && remotePort !== '0';
                }

                return false;
            })
            .filter((connection) => {
                const remoteIp = normalizeIp(connection.remoteIp);
                const suppressUntil = suppressedIps.get(remoteIp);
                return !suppressUntil || suppressUntil <= now;
            })
            .map((connection) => {
                const remoteIp = normalizeIp(connection.remoteIp);
                queueIntelLookup(remoteIp);

                const intel = ipIntelCache.get(remoteIp) || null;
                const threat = assessThreat(connection, intel);

                const id = String(connection.id || `${connection.protocol}-${connection.localPort}-${connection.remoteIp}-${connection.remotePort}`);
                if (!layoutCache.has(id)) {
                    layoutCache.set(id, createLayoutSeed(id, threat.suspicious));
                }

                const layout = layoutCache.get(id);
                if (threat.suspicious && layout.radiusFactor < 0.52) {
                    const hash = hashString(id);
                    layout.radiusFactor = 0.52 + (((hash >> 4) % 40) / 100);
                }

                const x = centerX + Math.cos(layout.angle) * radarRadius * layout.radiusFactor;
                const y = centerY + Math.sin(layout.angle) * radarRadius * layout.radiusFactor;

                return {
                    ...connection,
                    id,
                    intel,
                    suspicious: threat.suspicious,
                    reasons: threat.reasons,
                    trustedProvider: threat.trustedProvider,
                    reasonSummary: threat.reasons.join(' | '),
                    remoteIp,
                    x,
                    y,
                    radius: threat.suspicious ? SUSPICIOUS_BASE_RADIUS : NORMAL_BASE_RADIUS
                };
            });
    }

    function animateSuspiciousNode(circle, baseRadius) {
        circle.interrupt('pulse');

        const pulseLoop = () => {
            circle
                .transition('pulse')
                .duration(520)
                .attr('r', baseRadius + 2.4)
                .style('opacity', 1)
                .transition('pulse')
                .duration(560)
                .attr('r', baseRadius)
                .style('opacity', 0.78)
                .on('end', pulseLoop);
        };

        pulseLoop();
    }

    function renderNodes(connections) {
        latestConnections = Array.isArray(connections) ? connections : [];
        latestNodes = computeNodeView(latestConnections);
        lastUpdateAt = Date.now();

        const suspiciousCount = latestNodes.filter((node) => node.suspicious).length;
        updateStatusText(latestNodes.length, suspiciousCount);

        const join = nodesLayer.selectAll('circle.radar-node').data(latestNodes, (node) => node.id);

        join.exit()
            .each(function interruptPulse() {
                d3.select(this).interrupt('pulse');
            })
            .transition()
            .duration(260)
            .attr('r', 0)
            .style('opacity', 0)
            .remove();

        const entered = join.enter()
            .append('circle')
            .attr('class', (node) => `radar-node ${node.suspicious ? 'radar-node-suspicious' : 'radar-node-normal'}`)
            .attr('cx', (node) => node.x)
            .attr('cy', (node) => node.y)
            .attr('r', 0)
            .style('opacity', 0)
            .on('click', (event, node) => {
                event.stopPropagation();
                if (!node.suspicious) return;
                showTacticalModal(node);
            });

        const merged = entered.merge(join);

        merged
            .attr('class', (node) => `radar-node ${node.suspicious ? 'radar-node-suspicious' : 'radar-node-normal'}`)
            .transition()
            .duration(420)
            .attr('cx', (node) => node.x)
            .attr('cy', (node) => node.y)
            .attr('r', (node) => node.radius)
            .style('opacity', (node) => node.suspicious ? 0.85 : 0.48);

        merged.each(function assignPulse(node) {
            const circle = d3.select(this);
            if (node.suspicious) {
                if (this.dataset.pulsing !== 'true') {
                    this.dataset.pulsing = 'true';
                    animateSuspiciousNode(circle, node.radius);
                }
            } else {
                this.dataset.pulsing = 'false';
                circle.interrupt('pulse').attr('r', node.radius).style('opacity', 0.48);
            }
        });

        renderListenerNodes();
    }

    function renderListenerNodes() {
        const listeners = latestListenersSnapshot;
        const join = listenersLayer.selectAll('circle.radar-listener-node').data(listeners, (entry) => entry.id);

        join.exit()
            .transition()
            .duration(180)
            .attr('r', 0)
            .style('opacity', 0)
            .remove();

        const entered = join.enter()
            .append('circle')
            .attr('class', (entry) => `radar-listener-node ${entry.boundToAllInterfaces ? 'radar-listener-node-global' : 'radar-listener-node-loopback'}`)
            .attr('r', 0)
            .style('opacity', 0)
            .on('click', (event, entry) => {
                event.stopPropagation();
                const scope = entry.boundToAllInterfaces ? 'global' : (entry.loopbackOnly ? 'loopback' : 'local');
                onNotify(`Listener detectado: ${entry.localIp}:${entry.localPort} (${scope})`, 'system');
            });

        entered.append('title');

        const merged = entered.merge(join)
            .attr('class', (entry) => `radar-listener-node ${entry.boundToAllInterfaces ? 'radar-listener-node-global' : 'radar-listener-node-loopback'}`)
            .attr('cx', (entry) => {
                const seed = hashString(`listener-${entry.localIp}-${entry.localPort}`);
                const angle = (seed % 360) * (Math.PI / 180);
                const baseRadius = entry.boundToAllInterfaces
                    ? 0.34
                    : (entry.loopbackOnly ? 0.16 : 0.24);
                const jitter = ((seed >> 5) % 10) / 100;
                return centerX + Math.cos(angle) * radarRadius * (baseRadius + jitter);
            })
            .attr('cy', (entry) => {
                const seed = hashString(`listener-${entry.localIp}-${entry.localPort}`);
                const angle = (seed % 360) * (Math.PI / 180);
                const baseRadius = entry.boundToAllInterfaces
                    ? 0.34
                    : (entry.loopbackOnly ? 0.16 : 0.24);
                const jitter = ((seed >> 5) % 10) / 100;
                return centerY + Math.sin(angle) * radarRadius * (baseRadius + jitter);
            });

        merged.select('title').text((entry) => {
            const scope = entry.boundToAllInterfaces ? 'global' : (entry.loopbackOnly ? 'loopback' : 'local');
            return `LISTEN ${entry.localIp}:${entry.localPort} (${scope})`;
        });

        merged
            .transition()
            .duration(260)
            .attr('r', (entry) => entry.boundToAllInterfaces ? 4.8 : 3.4)
            .style('opacity', (entry) => entry.boundToAllInterfaces ? 0.92 : 0.72);
    }

    function showNeutralizationFx(node) {
        const xMark = fxLayer.append('g')
            .attr('class', 'radar-x-mark')
            .attr('transform', `translate(${node.x}, ${node.y})`)
            .style('opacity', 1);

        xMark.append('line')
            .attr('x1', -8)
            .attr('y1', -8)
            .attr('x2', 8)
            .attr('y2', 8);

        xMark.append('line')
            .attr('x1', -8)
            .attr('y1', 8)
            .attr('x2', 8)
            .attr('y2', -8);

        xMark.transition()
            .duration(450)
            .style('opacity', 0)
            .remove();
    }

    function removeNodeImmediately(nodeId) {
        const circle = nodesLayer.selectAll('circle.radar-node').filter((node) => node.id === nodeId);
        circle.interrupt('pulse')
            .transition()
            .duration(190)
            .attr('r', 0)
            .style('opacity', 0)
            .remove();

        latestNodes = latestNodes.filter((node) => node.id !== nodeId);
        updateStatusText(
            latestNodes.length,
            latestNodes.filter((node) => node.suspicious).length
        );
    }

    function pauseSweepFor(ms = 2400) {
        sweepPausedUntil = performance.now() + ms;
    }

    async function neutralizeThreat(node) {
        const remoteIp = normalizeIp(node.remoteIp);
        if (!remoteIp) return;

        suppressedIps.set(remoteIp, Date.now() + SUPPRESS_IP_MS);
        showNeutralizationFx(node);
        removeNodeImmediately(node.id);
        hideTacticalModal();
        onNotify('Amenaza Neutralizada', 'success');
        onLog(`[Radar] Amenaza neutralizada: ${remoteIp}:${node.remotePort}`, 'system');

        const historyRow = {
            timestamp: new Date().toISOString(),
            ip: remoteIp,
            port: String(node.remotePort || ''),
            protocol: String(node.protocol || ''),
            reason: node.reasonSummary || 'manual',
            country: node.intel?.countryCode || '',
            asn: node.intel?.asn || '',
            isp: node.intel?.isp || '',
            firewallStatus: 'pending',
            ruleName: ''
        };

        if (!window.api || typeof window.api.blockIP !== 'function') {
            historyRow.firewallStatus = 'api_unavailable';
            appendHistory(historyRow);
            onNotify('No se pudo sincronizar con Firewall (API no disponible)', 'error');
            return;
        }

        try {
            const response = await window.api.blockIP(remoteIp);
            if (!response || !response.ok) {
                if (response && response.code === 'ELEVATION_REQUIRED') {
                    historyRow.firewallStatus = 'elevation_required';
                    appendHistory(historyRow);
                    onNotify('Firewall requiere ejecutar la app como administrador', 'error');
                    onLog('[Radar] Bloqueo firewall rechazado: privilegios insuficientes', 'error');
                    return;
                }

                const reason = response?.error || 'No fue posible agregar la regla de firewall';
                historyRow.firewallStatus = 'failed';
                historyRow.ruleName = String(response?.ruleName || '');
                appendHistory(historyRow);
                onNotify(`Fallo al bloquear IP en firewall: ${reason}`, 'error');
                onLog(`[Radar] Error de firewall: ${reason}`, 'error');
                return;
            }

            historyRow.firewallStatus = 'blocked';
            historyRow.ruleName = String(response.ruleName || '');
            appendHistory(historyRow);
            onLog(`[Radar] Regla aplicada: ${response.ruleName || 'Bloqueo_Dashboard'}`, 'system');
        } catch (error) {
            historyRow.firewallStatus = 'exception';
            appendHistory(historyRow);
            onNotify(`Error ejecutando bloqueo: ${error.message || error}`, 'error');
            onLog(`[Radar] Excepcion en bloqueo: ${error.message || error}`, 'error');
        }

        updateStatusText(
            latestNodes.length,
            latestNodes.filter((candidate) => candidate.suspicious).length
        );
    }

    function showTacticalModal(node) {
        activeThreat = node;
        pauseSweepFor(3000);

        const intelRow = node.intel && node.intel.ok
            ? `<span>Pais/ASN</span><span>${escapeHtml(node.intel.countryCode || '--')} / ${escapeHtml(node.intel.asn || '--')}</span>`
            : '';
        const reasonRow = node.reasonSummary
            ? `<span>Motivo</span><span>${escapeHtml(node.reasonSummary)}</span>`
            : '<span>Motivo</span><span>manual</span>';

        modalEl.classList.remove('hidden');
        modalEl.innerHTML = `
            <div class="network-node-modal-card">
                <div class="network-node-modal-title">OBJETIVO SOSPECHOSO</div>
                <div class="network-node-modal-grid">
                    <span>IP</span><span>${escapeHtml(node.remoteIp)}</span>
                    <span>Puerto</span><span>${escapeHtml(node.remotePort)}</span>
                    <span>Protocolo</span><span>${escapeHtml(node.protocol)}</span>
                    ${intelRow}
                    ${reasonRow}
                </div>
                <button type="button" class="network-node-destroy-btn">[ DESTRUIR CONEXION ]</button>
            </div>
        `;

        const safeX = clamp(node.x, 130, Math.max(130, width - 130));
        const safeY = clamp(node.y - 14, 76, Math.max(76, height - 60));
        modalEl.style.left = `${safeX}px`;
        modalEl.style.top = `${safeY}px`;

        const destroyBtn = modalEl.querySelector('.network-node-destroy-btn');
        if (destroyBtn) {
            destroyBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                neutralizeThreat(node);
            }, { once: true });
        }
    }

    function onResize() {
        const rect = container.getBoundingClientRect();
        width = Math.max(320, rect.width || 0);
        height = Math.max(220, rect.height || 0);
        centerX = width / 2;
        centerY = height / 2;
        radarRadius = Math.min(width, height) * 0.45;

        svg.attr('viewBox', `0 0 ${width} ${height}`);
        buildBackground();
        updateSweepGeometry();
        renderListenerNodes();

        if (latestConnections.length > 0) {
            renderNodes(latestConnections);
        }
    }

    function animateSweep() {
        const now = performance.now();
        if (now > sweepPausedUntil) {
            sweepAngle = (sweepAngle + 0.65) % 360;
        }

        sweepLayer.attr('transform', `rotate(${sweepAngle}, ${centerX}, ${centerY})`);
        rafId = window.requestAnimationFrame(animateSweep);
    }

    const resizeObserver = new ResizeObserver(() => onResize());
    resizeObserver.observe(container);

    const offNetworkUpdate = window.api && typeof window.api.onNetworkUpdate === 'function'
        ? window.api.onNetworkUpdate((connections) => {
            renderNodes(Array.isArray(connections) ? connections : []);
        })
        : null;

    const offNetworkExposureUpdate = window.api && typeof window.api.onNetworkExposureUpdate === 'function'
        ? window.api.onNetworkExposureUpdate((exposures) => {
            setExposureSnapshot(exposures);
        })
        : null;

    const offNetworkListenersUpdate = window.api && typeof window.api.onNetworkListenersUpdate === 'function'
        ? window.api.onNetworkListenersUpdate((listeners) => {
            setListenersSnapshot(listeners);
            renderListenerNodes();
        })
        : null;

    if (!offNetworkUpdate) {
        updateStatusText(0, 0, 'Radar en espera: canal IPC network-update no disponible');
    } else {
        updateStatusText(0, 0, 'Radar activo: esperando telemetria de red');
    }

    if (rulesBtn) {
        rulesBtn.addEventListener('click', () => {
            showRulesModal();
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (threatHistory.length === 0) {
                onNotify('No hay amenazas neutralizadas para exportar', 'system');
                return;
            }
            exportHistoryCsv(threatHistory);
            onNotify(`Historial exportado (${threatHistory.length} eventos)`, 'success');
        });
    }

    if (rulesSaveEl) {
        rulesSaveEl.addEventListener('click', () => {
            saveRulesFromModal();
        });
    }

    if (rulesCancelEl) {
        rulesCancelEl.addEventListener('click', () => {
            hideRulesModal();
        });
    }

    if (rulesModalEl) {
        rulesModalEl.addEventListener('click', (event) => {
            if (event.target === rulesModalEl) hideRulesModal();
        });
    }

    svg.on('click', () => {
        if (activeThreat) hideTacticalModal();
    });

    container.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hideTacticalModal();
            hideRulesModal();
        }
    });

    onResize();
    animateSweep();

    return {
        destroy() {
            if (rafId) cancelAnimationFrame(rafId);
            resizeObserver.disconnect();
            if (typeof offNetworkUpdate === 'function') offNetworkUpdate();
            if (typeof offNetworkExposureUpdate === 'function') offNetworkExposureUpdate();
            if (typeof offNetworkListenersUpdate === 'function') offNetworkListenersUpdate();
            hideTacticalModal();
            hideRulesModal();
            svg.remove();
        }
    };
}
