export function formatBytes(size, fractionDigits = 1) {
	const bytes = Number(size || 0);
	if (bytes <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let idx = 0;
	let value = bytes;
	while (value >= 1024 && idx < units.length - 1) {
		value /= 1024;
		idx += 1;
	}
	return `${value.toFixed(value >= 100 ? 0 : fractionDigits)} ${units[idx]}`;
}

export function safeText(v) {
	return String(v || '').replace(/[&<>"']/g, (ch) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;'
	}[ch]));
}

export function safeId(fileName) {
	return encodeURIComponent(fileName).replace(/[^a-z0-9]/gi, '_');
}

export function getElementId(fileName, prefix) {
	return `${prefix}-${safeId(fileName)}`;
}

export function getFileIconFromPath(filePath) {
	const lower = String(filePath || '').toLowerCase();
	if (lower.endsWith('.exe')) return '🧩';
	if (lower.endsWith('.pdf')) return '📕';
	if (lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z')) return '🗜️';
	if (lower.endsWith('.mp4') || lower.endsWith('.mkv') || lower.endsWith('.avi')) return '🎬';
	if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.flac')) return '🎵';
	if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp')) return '🖼️';
	if (lower.endsWith('.doc') || lower.endsWith('.docx')) return '📝';
	if (lower.endsWith('.xls') || lower.endsWith('.xlsx') || lower.endsWith('.csv')) return '📊';
	if (lower.endsWith('.js') || lower.endsWith('.ts') || lower.endsWith('.py') || lower.endsWith('.bat')) return '💻';
	return '📄';
}

export function getAppIcon(name) {
	const n = String(name || '').toLowerCase();
	if (n.includes('chrome')) return '🌐';
	if (n.includes('firefox')) return '🦊';
	if (n.includes('edge')) return '🔷';
	if (n.includes('discord')) return '🎮';
	if (n.includes('spotify')) return '🎧';
	if (n.includes('steam')) return '🎲';
	if (n.includes('nvidia')) return '🟩';
	if (n.includes('adobe')) return '🅰️';
	if (n.includes('microsoft')) return '🪟';
	if (n.includes('visual studio') || n.includes('vscode')) return '🧠';
	if (n.includes('java')) return '☕';
	if (n.includes('python')) return '🐍';
	return '🧩';
}

export function buildFileUrl(winPath) {
	const p = String(winPath || '').trim();
	if (!p) return '';
	const normalized = p.replace(/\\/g, '/');
	if (/^[a-zA-Z]:\//.test(normalized)) {
		return `file:///${encodeURI(normalized)}`;
	}
	return `file://${encodeURI(normalized)}`;
}

// Cache de rutas del sistema (se llena al arrancar)
let runtimeEnvCache = null;

export async function initRuntimePaths() {
	if (window.api && window.api.getRuntimePaths) {
		try {
			const paths = await window.api.getRuntimePaths();
			runtimeEnvCache = paths.env || {};
		} catch (e) {
			console.error('[HorusEngine] Error obteniendo runtime paths:', e);
		}
	}
}

export function extractIconPath(app) {
	let raw = String(app?.displayIcon || '').trim();

	if (!raw && app?.uninstallString) {
		const match = app.uninstallString.match(/([a-zA-Z]:\\[^"*,]+\.(exe|ico))/i);
		if (match) raw = match[1];
	}

	if (!raw && app?.installLocation) {
		raw = app.installLocation;
	}

	if (!raw) return '';

	raw = raw.replace(/,[\s\-]?\d+$/, '').trim();
	raw = raw.replace(/"/g, '');

	// Resolver variables de entorno dinámicamente
	const env = runtimeEnvCache || {};
	raw = raw.replace(/%ProgramFiles%/gi, env.PROGRAMFILES || 'C:\\Program Files')
		.replace(/%ProgramFiles\(x86\)%/gi, env.PROGRAMFILES_X86 || 'C:\\Program Files (x86)')
		.replace(/%AppData%/gi, env.APPDATA || '')
		.replace(/%LocalAppData%/gi, env.LOCALAPPDATA || '')
		.replace(/%SystemRoot%/gi, env.SYSTEMROOT || 'C:\\Windows')
		.replace(/%WinDir%/gi, env.WINDIR || 'C:\\Windows');

	return raw;
}

export function getAppIconMarkup(app, iconId) {
	const fallback = getAppIcon(app?.name || '');
	return `<span class="app-icon-fallback" id="${iconId}">${fallback}</span>`;
}

export async function loadRealAppIcon(app, iconId) {
	const displayIconPath = extractIconPath(app);
	if (!displayIconPath) return;

	if (displayIconPath.match(/\.(png|jpg|jpeg|webp|gif|ico)$/i)) {
		const src = buildFileUrl(displayIconPath);
		const el = document.getElementById(iconId);
		if (el) el.outerHTML = `<img class="app-icon-img" id="${iconId}" src="${src}" alt="icon" loading="lazy" onerror="this.outerHTML=''">`;
		return;
	}

	if (window.api && window.api.getFileIcon) {
		try {
			const base64 = await window.api.getFileIcon(displayIconPath);
			if (base64) {
				const el = document.getElementById(iconId);
				if (el) el.outerHTML = `<img class="app-icon-img" id="${iconId}" src="${base64}" alt="icon" loading="lazy">`;
			}
		} catch (e) { }
	}
}

export function obtenerInfoArchivo(fileName) {
	const lastDot = fileName.lastIndexOf('.');
	const ext = lastDot !== -1 ? fileName.slice(lastDot).toLowerCase() : '';
	if (ext === '.py') return { color: '#FFD60A', name: 'PY' };
	if (ext === '.bat' || ext === '.cmd') return { color: '#0A84FF', name: 'BAT' };
	if (ext === '.sh') return { color: '#30D158', name: 'SH' };
	return { color: '#8E8E93', name: 'BIN' };
}

export function escapeRegExp(string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightText(text, parts) {
	if (!parts || parts.length === 0) return document.createTextNode(text);

	const escapedParts = parts
		.map(p => String(p).trim())
		.filter(Boolean)
		.map(escapeRegExp);

	if (escapedParts.length === 0) return document.createTextNode(text);

	const regex = new RegExp(`(${escapedParts.join('|')})`, 'gi');
	const fragment = document.createDocumentFragment();
	let lastIndex = 0;
	let match = null;

	while ((match = regex.exec(text)) !== null) {
		const start = match.index;
		const matched = match[0];
		if (start > lastIndex) {
			fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
		}

		const span = document.createElement('span');
		span.style.color = '#FF9500';
		span.textContent = matched;
		fragment.appendChild(span);

		lastIndex = start + matched.length;
		if (matched.length === 0) regex.lastIndex++;
	}

	if (lastIndex < text.length) {
		fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
	}

	return fragment;
}
