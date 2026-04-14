const https = require('https');

const IPV4_REGEX = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6_REGEX = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

function normalizeIp(rawIp) {
    return String(rawIp || '')
        .trim()
        .replace(/^\[/, '')
        .replace(/]$/, '')
        .replace(/^::ffff:/i, '')
        .split('%')[0];
}

function isValidIp(ip) {
    const normalized = normalizeIp(ip);
    if (!normalized) return false;
    if (normalized === '*' || normalized === '0.0.0.0' || normalized === '::') return false;
    if (normalized === '127.0.0.1' || normalized === '::1') return false;
    return IPV4_REGEX.test(normalized) || IPV6_REGEX.test(normalized);
}

function fetchIpIntel(ip) {
    return new Promise((resolve, reject) => {
        const url = `https://ipwho.is/${encodeURIComponent(ip)}`;
        const req = https.get(url, { timeout: 6000, headers: { Accept: 'application/json' } }, (response) => {
            let payload = '';

            response.on('data', (chunk) => {
                payload += chunk.toString('utf8');
            });

            response.on('end', () => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`ipwho.is respondio ${response.statusCode}`));
                    return;
                }

                try {
                    const parsed = JSON.parse(payload);
                    resolve(parsed);
                } catch (error) {
                    reject(new Error(`Respuesta JSON invalida en ipwho.is: ${error.message}`));
                }
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error('Timeout consultando ipwho.is'));
        });

        req.on('error', (error) => {
            reject(error);
        });
    });
}

class ThreatIntel {
    constructor({ cacheTtlMs = 25 * 60 * 1000, errorTtlMs = 4 * 60 * 1000, maxCacheEntries = 1500 } = {}) {
        this.cacheTtlMs = cacheTtlMs;
        this.errorTtlMs = errorTtlMs;
        this.maxCacheEntries = maxCacheEntries;
        this.cache = new Map();
        this.pendingLookups = new Map();
    }

    pruneCache() {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (!entry || entry.expiresAt <= now) {
                this.cache.delete(key);
            }
        }

        if (this.cache.size <= this.maxCacheEntries) {
            return;
        }

        const overflow = this.cache.size - this.maxCacheEntries;
        let removed = 0;
        for (const key of this.cache.keys()) {
            this.cache.delete(key);
            removed += 1;
            if (removed >= overflow) break;
        }
    }

    getCached(ip) {
        const normalized = normalizeIp(ip);
        const entry = this.cache.get(normalized);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            this.cache.delete(normalized);
            return null;
        }
        return entry.value;
    }

    setCached(ip, value, isError = false) {
        const normalized = normalizeIp(ip);
        if (!normalized) return;

        this.cache.set(normalized, {
            value,
            expiresAt: Date.now() + (isError ? this.errorTtlMs : this.cacheTtlMs)
        });

        if (this.cache.size > this.maxCacheEntries) {
            this.pruneCache();
        }
    }

    async lookupRemote(normalized) {
        try {
            const raw = await fetchIpIntel(normalized);

            if (!raw || raw.success === false) {
                const failResult = {
                    ok: false,
                    ip: normalized,
                    error: raw?.message || 'ipwho.is no devolvio datos validos'
                };
                this.setCached(normalized, failResult, true);
                return failResult;
            }

            const intel = {
                ok: true,
                ip: normalized,
                country: String(raw.country || '').trim(),
                countryCode: String(raw.country_code || '').trim().toUpperCase(),
                asn: String(raw.connection?.asn || '').trim(),
                isp: String(raw.connection?.isp || '').trim(),
                org: String(raw.connection?.org || '').trim(),
                source: 'ipwho.is',
                fetchedAt: Date.now()
            };

            this.setCached(normalized, intel, false);
            return intel;
        } catch (error) {
            const failResult = {
                ok: false,
                ip: normalized,
                error: error.message || 'Error desconocido consultando inteligencia de IP'
            };
            this.setCached(normalized, failResult, true);
            return failResult;
        }
    }

    async lookup(ip) {
        const normalized = normalizeIp(ip);
        this.pruneCache();

        if (!isValidIp(normalized)) {
            return {
                ok: false,
                ip: normalized,
                error: 'IP invalida para inteligencia de amenaza'
            };
        }

        const cached = this.getCached(normalized);
        if (cached) return cached;

        const inFlight = this.pendingLookups.get(normalized);
        if (inFlight) return inFlight;

        const promise = this.lookupRemote(normalized).finally(() => {
            this.pendingLookups.delete(normalized);
        });

        this.pendingLookups.set(normalized, promise);
        return promise;
    }
}

module.exports = {
    ThreatIntel,
    normalizeIp
};
