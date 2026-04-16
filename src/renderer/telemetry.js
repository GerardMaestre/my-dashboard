import '../../node_modules/chart.js/dist/chart.umd.js';

const ChartCtor = globalThis.Chart;

const SPARKLINE_POINTS = 28;

function clampPercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric < 0) return 0;
    if (numeric > 100) return 100;
    return numeric;
}

export function createSparkline(canvasId, strokeStyle, fillStyle) {
    if (typeof ChartCtor !== 'function') {
        console.error('Chart.js UMD did not initialize correctly.');
        return null;
    }

    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof canvas.getContext !== 'function') return null;

    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) return null;

    const data = Array(SPARKLINE_POINTS).fill(0);
    const labels = Array.from({ length: SPARKLINE_POINTS }, (_value, index) => index + 1);

    const chart = new ChartCtor(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data,
                borderColor: strokeStyle,
                backgroundColor: fillStyle,
                fill: true,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 0,
                tension: 0.35
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            normalized: true,
            parsing: false,
            events: [],
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            scales: {
                x: {
                    display: false,
                    grid: { display: false },
                    border: { display: false }
                },
                y: {
                    display: false,
                    min: 0,
                    max: 100,
                    grid: { display: false },
                    border: { display: false }
                }
            }
        }
    });

    return {
        canvas,
        chart,
        strokeStyle,
        fillStyle,
        data
    };
}

export function ensureSparklineResolution(chart) {
    if (!chart || !chart.chart) return { width: 0, height: 0 };
    chart.chart.resize();
    const rect = chart.canvas.getBoundingClientRect();
    return {
        width: Math.max(1, Math.round(rect.width || chart.canvas.clientWidth || 1)),
        height: Math.max(1, Math.round(rect.height || chart.canvas.clientHeight || 1))
    };
}

export function drawSparkline(chart) {
    if (!chart) return;
    ensureSparklineResolution(chart);
    chart.chart.update('none');
}

export function pushSparklineValue(chart, value) {
    if (!chart) return;
    chart.data.shift();
    chart.data.push(clampPercent(value));
    chart.chart.data.datasets[0].data = chart.data;
    drawSparkline(chart);
}
