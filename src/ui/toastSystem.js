export function mostrarToast(mensaje, tipo = 'system') {
	const container = document.getElementById('toast-container');
	if (!container) return;

	const toast = document.createElement('div');
	toast.className = `toast toast-${tipo}`;

	const wrapper = document.createElement('div');
	wrapper.className = 'toast-body';

	const iconDiv = document.createElement('span');
	if (tipo === 'success') iconDiv.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="var(--mac-green)"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
	else if (tipo === 'error') iconDiv.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="var(--mac-red)"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
	else iconDiv.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="var(--mac-blue)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';

	const textSpan = document.createElement('span');
	textSpan.textContent = mensaje; // textContent prevents XSS

	wrapper.appendChild(iconDiv);
	wrapper.appendChild(textSpan);
	toast.appendChild(wrapper);

	// Barra de progreso visual de auto-dismiss
	const progressBar = document.createElement('div');
	progressBar.className = 'toast-progress';
	toast.appendChild(progressBar);

	container.appendChild(toast);

	// Limitar a máximo 5 toasts visibles
	while (container.children.length > 5) {
		container.removeChild(container.firstElementChild);
	}

	setTimeout(() => {
		toast.classList.add('fadeOut');
		setTimeout(() => toast.remove(), 400);
	}, 3500);
}
