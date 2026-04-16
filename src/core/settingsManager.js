const SETTINGS_STORAGE_KEY = 'nexus_settings_v1';
const MAX_ARGS_LENGTH = 260;

const DEFAULT_SETTINGS = Object.freeze({
    globalTerminalMode: 'external',
    scriptArgs: '',
    nativeNotifications: true,
    remoteHost: ''
});

let cachedSettings = null;
let controlsBound = false;
let settingsPersistTimer = null;

function normalizeTerminalMode(value) {
    return String(value || '').trim().toLowerCase() === 'internal' ? 'internal' : 'external';
}

function normalizeScriptArgs(value) {
    return String(value ?? '')
        .replace(/[\u0000-\u001f]/g, ' ')
        .trim()
        .slice(0, MAX_ARGS_LENGTH);
}

function normalizeBoolean(value, fallback = true) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return fallback;
}

function normalizeRemoteHost(value) {
    const normalized = String(value ?? '')
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/+$/, '')
        .slice(0, 120);

    return normalized;
}

function normalizeSettings(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};

    return {
        globalTerminalMode: normalizeTerminalMode(source.globalTerminalMode || source.terminalMode || DEFAULT_SETTINGS.globalTerminalMode),
        scriptArgs: normalizeScriptArgs(source.scriptArgs || source.defaultArgs || DEFAULT_SETTINGS.scriptArgs),
        nativeNotifications: normalizeBoolean(source.nativeNotifications, DEFAULT_SETTINGS.nativeNotifications),
        remoteHost: normalizeRemoteHost(source.remoteHost || source.mobileHost || source.horusRemoteHost || DEFAULT_SETTINGS.remoteHost)
    };
}

function persistSettings(nextSettings) {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
        localStorage.setItem('horus_remote_host', nextSettings.remoteHost || '');
    } catch (error) {
        console.error('[HorusEngine] Could not persist settings:', error);
    }
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) {
            cachedSettings = { ...DEFAULT_SETTINGS };
            persistSettings(cachedSettings);
            return;
        }

        const parsed = JSON.parse(raw);
        cachedSettings = normalizeSettings(parsed);
        persistSettings(cachedSettings);
    } catch (error) {
        console.error('[HorusEngine] Failed to load settings, restoring defaults:', error);
        cachedSettings = { ...DEFAULT_SETTINGS };
        persistSettings(cachedSettings);
    }
}

function dispatchSettingsChanged() {
    window.dispatchEvent(new CustomEvent('horus-settings-changed', {
        detail: { ...cachedSettings }
    }));
}

function applySettingsToControls() {
    const settings = getSettings();

    const modeSelect = document.getElementById('global-terminal-mode');
    if (modeSelect) {
        modeSelect.value = settings.globalTerminalMode;
    }

    const argsInput = document.getElementById('script-args');
    if (argsInput && document.activeElement !== argsInput) {
        argsInput.value = settings.scriptArgs;
    }

    const notifToggle = document.getElementById('native-notifications-enabled');
    if (notifToggle) {
        notifToggle.checked = !!settings.nativeNotifications;
    }

    const remoteHostInput = document.getElementById('remote-host-input');
    if (remoteHostInput && document.activeElement !== remoteHostInput) {
        remoteHostInput.value = settings.remoteHost;
    }
}

function bindSettingsControlHandlers() {
    if (controlsBound) return;

    const argsInput = document.getElementById('script-args');
    if (argsInput) {
        argsInput.addEventListener('input', () => {
            if (settingsPersistTimer) clearTimeout(settingsPersistTimer);
            settingsPersistTimer = setTimeout(() => {
                updateSettings({ scriptArgs: argsInput.value });
            }, 180);
        });
    }

    const notifToggle = document.getElementById('native-notifications-enabled');
    if (notifToggle) {
        notifToggle.addEventListener('change', () => {
            updateSettings({ nativeNotifications: !!notifToggle.checked });
        });
    }

    const remoteHostInput = document.getElementById('remote-host-input');
    if (remoteHostInput) {
        remoteHostInput.addEventListener('input', () => {
            if (settingsPersistTimer) clearTimeout(settingsPersistTimer);
            settingsPersistTimer = setTimeout(() => {
                updateSettings({ remoteHost: remoteHostInput.value });
            }, 180);
        });
    }

    controlsBound = true;
}

export function getSettings() {
    if (!cachedSettings) loadSettings();
    return { ...cachedSettings };
}

export function updateSettings(patch = {}) {
    const prev = getSettings();
    const merged = normalizeSettings({ ...prev, ...patch });
    const changed = JSON.stringify(prev) !== JSON.stringify(merged);

    if (!changed) return { ...merged };

    cachedSettings = merged;
    persistSettings(cachedSettings);
    dispatchSettingsChanged();
    return { ...cachedSettings };
}

export function getGlobalTerminalMode() {
    return getSettings().globalTerminalMode;
}

export function getScriptArgs() {
    return getSettings().scriptArgs;
}

export function isNativeNotificationsEnabled() {
    return !!getSettings().nativeNotifications;
}

export function getRemoteHost() {
    return getSettings().remoteHost;
}

export function changeGlobalTerminalMode() {
    const modeSelect = document.getElementById('global-terminal-mode');
    const nextMode = normalizeTerminalMode(modeSelect ? modeSelect.value : getGlobalTerminalMode());

    if (modeSelect) modeSelect.value = nextMode;
    updateSettings({ globalTerminalMode: nextMode });
    return nextMode;
}

export function initSettingsControls() {
    getSettings();
    applySettingsToControls();
    bindSettingsControlHandlers();
}

export function refreshSettingsControls() {
    applySettingsToControls();
}
