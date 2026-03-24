function normalizeTreemapItems(items) {
	const list = Array.isArray(items) ? items : [];
	return list
		.map((item, idx) => {
			const sizeBytes = Math.max(0, Number(item && item.sizeBytes ? item.sizeBytes : 0));
			return {
				id: (item && item.id) || `disk-${idx}`,
				name: (item && item.name) || (item && item.fullPath) || 'item',
				fullPath: (item && item.fullPath) || '',
				sizeBytes,
				isDir: !!(item && item.isDir)
			};
		})
		.filter((item) => item.sizeBytes > 0)
		.sort((a, b) => b.sizeBytes - a.sizeBytes);
}

function buildTreemapDataset(items, width, height) {
	const normalized = normalizeTreemapItems(items);
	const total = normalized.reduce((acc, cur) => acc + cur.sizeBytes, 0) || 1;
	const totalArea = Math.max(1, width * height);
	const minArea = totalArea * 0.001;

	const visible = [];
	let tinySize = 0;

	for (const item of normalized) {
		const area = (item.sizeBytes / total) * totalArea;
		if (area < minArea) {
			tinySize += item.sizeBytes;
			continue;
		}
		visible.push({ ...item, area });
	}

	if (tinySize > 0) {
		visible.push({
			id: 'disk-others',
			name: 'Otros',
			fullPath: '',
			sizeBytes: tinySize,
			isDir: false,
			area: (tinySize / total) * totalArea,
			isAggregate: true
		});
	}

	return { visible, total };
}

function worstAspectRatio(row, sideLength) {
	if (!row.length || sideLength <= 0) return Number.POSITIVE_INFINITY;
	const areas = row.map((x) => x.area);
	const sum = areas.reduce((a, b) => a + b, 0);
	const max = Math.max(...areas);
	const min = Math.min(...areas);
	if (min <= 0) return Number.POSITIVE_INFINITY;
	const sideSquared = sideLength * sideLength;
	return Math.max((sideSquared * max) / (sum * sum), (sum * sum) / (sideSquared * min));
}

function layoutRow(row, rect, horizontal, outputRects) {
	const rowArea = row.reduce((acc, cur) => acc + cur.area, 0);
	if (rowArea <= 0) return rect;

	if (horizontal) {
		const rowHeight = rowArea / rect.w;
		let x = rect.x;
		for (const node of row) {
			const w = node.area / rowHeight;
			outputRects.push({ node, x, y: rect.y, w, h: rowHeight });
			x += w;
		}
		return { x: rect.x, y: rect.y + rowHeight, w: rect.w, h: Math.max(0, rect.h - rowHeight) };
	}

	const rowWidth = rowArea / rect.h;
	let y = rect.y;
	for (const node of row) {
		const h = node.area / rowWidth;
		outputRects.push({ node, x: rect.x, y, w: rowWidth, h });
		y += h;
	}
	return { x: rect.x + rowWidth, y: rect.y, w: Math.max(0, rect.w - rowWidth), h: rect.h };
}

function squarify(nodes, width, height) {
	const safeNodes = [...nodes].filter((n) => Number(n.area || 0) > 0).sort((a, b) => b.area - a.area);
	const rects = [];
	let x = 0;
	let y = 0;
	let w = Math.max(1, width);
	let h = Math.max(1, height);

	for (let i = 0; i < safeNodes.length; i++) {
		const node = safeNodes[i];
		const remainingArea = safeNodes.slice(i).reduce((acc, cur) => acc + cur.area, 0) || 1;
		if (w <= 1 || h <= 1) break;

		if (w >= h) {
			const cw = Math.max(1, (node.area / remainingArea) * w);
			rects.push({ node, x, y, w: Math.min(cw, w), h });
			x += cw;
			w = Math.max(0, w - cw);
		} else {
			const ch = Math.max(1, (node.area / remainingArea) * h);
			rects.push({ node, x, y, w, h: Math.min(ch, h) });
			y += ch;
			h = Math.max(0, h - ch);
		}
	}

	return rects.filter((r) => r.w > 0 && r.h > 0);
}

self.onmessage = function onMessage(event) {
	const { id, items, width, height } = event.data || {};
	try {
		const w = Math.max(1, Number(width || 1));
		const h = Math.max(1, Number(height || 1));
		const dataset = buildTreemapDataset(items, w, h);
		const rects = squarify(dataset.visible, w, h);
		self.postMessage({ id, rects, total: dataset.total });
	} catch (error) {
		self.postMessage({ id, error: String(error && error.message ? error.message : error) });
	}
};
