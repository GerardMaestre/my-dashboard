const SPARKLINE_POINTS = 28;
const MAX_CHART_DPR = 2;

function clampPercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric < 0) return 0;
    if (numeric > 100) return 100;
    return numeric;
}

export function createSparkline(canvasId, strokeStyle, fillStyle) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof canvas.getContext !== 'function') return null;

    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) return null;

    return {
        canvas,
        ctx,
        strokeStyle,
        fillStyle,
        data: Array(SPARKLINE_POINTS).fill(0)
    };
}

export function ensureSparklineResolution(chart) {
    const rect = chart.canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width || chart.canvas.clientWidth || 1));
    const cssHeight = Math.max(1, Math.round(rect.height || chart.canvas.clientHeight || 1));
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_CHART_DPR);
    const targetWidth = Math.max(1, Math.round(cssWidth * dpr));
    const targetHeight = Math.max(1, Math.round(cssHeight * dpr));

    if (chart.canvas.width !== targetWidth || chart.canvas.height !== targetHeight) {
        chart.canvas.width = targetWidth;
        chart.canvas.height = targetHeight;
    }

    chart.ctx.setTransform(1, 0, 0, 1, 0, 0);
    chart.ctx.scale(dpr, dpr);
    return { width: cssWidth, height: cssHeight };
}

export function drawSparkline(chart) {
    if (!chart) return;
    const { width, height } = ensureSparklineResolution(chart);
    const ctx = chart.ctx;

    const pad = 3;
    const chartWidth = Math.max(1, width - (pad * 2));
    const chartHeight = Math.max(1, height - (pad * 2));
    const stepX = chartWidth / Math.max(1, chart.data.length - 1);

    ctx.clearRect(0, 0, width, height);

    ctx.beginPath();
    for (let idx = 0; idx < chart.data.length; idx += 1) {
        const x = pad + (idx * stepX);
        const y = pad + ((100 - clampPercent(chart.data[idx])) / 100) * chartHeight;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }

    ctx.lineTo(pad + chartWidth, pad + chartHeight);
    ctx.lineTo(pad, pad + chartHeight);
    ctx.closePath();
    ctx.fillStyle = chart.fillStyle;
    ctx.fill();

    ctx.beginPath();
    for (let idx = 0; idx < chart.data.length; idx += 1) {
        const x = pad + (idx * stepX);
        const y = pad + ((100 - clampPercent(chart.data[idx])) / 100) * chartHeight;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }

    ctx.strokeStyle = chart.strokeStyle;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
}

export function pushSparklineValue(chart, value) {
    if (!chart) return;
    chart.data.shift();
    chart.data.push(clampPercent(value));
    drawSparkline(chart);
}
