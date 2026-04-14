export function initSpotlight(ejecutar) {
    const spotInput = document.getElementById('spotlight-input');
    const overlay = document.getElementById('spotlight-overlay');

    window.toggleSpotlight = () => {
        if (!overlay) return;
        if (overlay.style.display === 'flex') {
            overlay.style.display = 'none';
            overlay.style.opacity = '0';
        } else {
            overlay.style.display = 'flex';
            overlay.style.opacity = '1';
            if (spotInput) {
                spotInput.value = '';
                document.getElementById('spotlight-results').innerHTML = '';
                setTimeout(() => spotInput.focus(), 50);
            }
        }
    };

    if (spotInput) {
        spotInput.addEventListener('input', () => {
            const term = spotInput.value.toLowerCase().trim();
            const results = document.getElementById('spotlight-results');
            results.innerHTML = '';
            if (!term) return;

            const allItems = Array.from(document.querySelectorAll('.script-item'));
            const matches = allItems.filter(el => el.getAttribute('data-name').toLowerCase().includes(term));

            matches.slice(0, 5).forEach((match, idx) => {
                const fileName = match.getAttribute('data-name');
                const shortName = fileName.split('/').pop();
                const li = document.createElement('li');
                li.style.cssText = `padding:10px 15px; border-radius:8px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; margin-bottom:5px; background: ${idx === 0 ? 'rgba(10, 132, 255, 0.2)' : 'rgba(255,255,255,0.05)'}`;
                li.innerHTML = `<span><strong style="color:var(--mac-text); font-size:16px;">${shortName}</strong><br><span style="color:var(--mac-text-muted); font-size:12px;">${fileName}</span></span>
                <span style="font-size:11px; background:var(--mac-blue); padding:3px 8px; border-radius:4px;">${idx === 0 ? 'Enter para Ejecutar' : 'Run'}</span>`;
                
                li.onclick = () => { window.toggleSpotlight(); ejecutar(fileName); };
                results.appendChild(li);
            });
        });

        spotInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const results = document.getElementById('spotlight-results');
                if (results.firstChild) {
                    results.firstChild.click();
                }
            }
        });
    }
}
