export function windowControl(action) {
    if (window.api && window.api.windowControl) {
	    window.api.windowControl(action);
    }
}

export function openSettings() {
	const modal = document.getElementById('settings-modal');
	if (modal) modal.classList.add('active');
}

export function closeSettings() {
	const modal = document.getElementById('settings-modal');
	if (modal) modal.classList.remove('active');
}

export function initTheme() {
    const savedTheme = localStorage.getItem('nexus_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    if (document.getElementById('theme-selector')) {
        document.getElementById('theme-selector').value = savedTheme;
    }
}

export function changeTheme() {
	const theme = document.getElementById('theme-selector').value;
	document.documentElement.setAttribute('data-theme', theme);
	localStorage.setItem('nexus_theme', theme);
}
