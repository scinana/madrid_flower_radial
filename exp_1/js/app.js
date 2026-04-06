let months = [];
let flowers = [];

const svg = document.getElementById('chart');
const tooltip = document.getElementById('tooltip');
const legend = document.getElementById('legend');
const infoCard = document.getElementById('infoCard');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const staticBtn = document.getElementById('staticBtn');
const statusNote = document.getElementById('statusNote');

const state = {
  selectedFlower: null,
  sweepMonth: 0,
  cycleMs: 14000,
  bandWidthMonths: 1.22,
  isPaused: false,
  isStatic: false,
  pauseStartedAt: null,
  elapsedBeforePause: 0,
  pauseElapsed: 0,
  hoveredFlowerId: null,
  hoveredMonthIndex: null
};

const width = 900;
const height = 760;
const cx = 390;
const cy = 392;
const maxR = 250;
const innerR = 64;
const revealRadius = maxR + 130;
const strongThreshold = 0.45;
const diameterBandThreshold = 0.55;
const sweepBandInner = maxR + 104;
const sweepBandOuter = maxR + 122;
const cursorWedgeWidthMonths = 1.22;
const cursorWedgeRadius = sweepBandInner - 6;

let startTime = performance.now();

async function loadData() {
  setStatus('Loading flower data…');

  try {
    const response = await fetch('./data/flowers.json');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while loading ./data/flowers.json`);
    }

    const data = await response.json();
    validateData(data);

    months = data.months;
    flowers = data.flowers;

    wireUi();
    renderLegend();
    updateInfoCard();
    renderChart();
    requestAnimationFrame(animate);

    setStatus(`Loaded ${flowers.length} flowers from data/flowers.json`);
  } catch (error) {
    console.error(error);
    setStatus('Could not load flower data. Check the JSON path and format.');
    infoCard.innerHTML = `
      <h2>Data failed to load</h2>
      <div class="small">The chart could not read <code>data/flowers.json</code>. This usually means the file path is wrong, the JSON format is invalid, or you opened the page directly from the filesystem instead of serving it through a local or hosted web server.</div>
    `;
  }
}

function setStatus(message) {
  statusNote.textContent = message;
}

function validateData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('flowers.json must contain a JSON object');
  }

  if (!Array.isArray(data.months) || data.months.length !== 12) {
    throw new Error('months must be an array with exactly 12 entries');
  }

  if (!Array.isArray(data.flowers) || data.flowers.length === 0) {
    throw new Error('flowers must be a non-empty array');
  }

  data.flowers.forEach((flower, index) => {
    if (!flower.id || !flower.name) {
      throw new Error(`flower at index ${index} is missing id or name`);
    }
    if (!Array.isArray(flower.profile) || flower.profile.length !== 12) {
      throw new Error(`flower "${flower.id}" must have a 12-value profile`);
    }
    flower.profile.forEach((value, monthIndex) => {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new Error(`flower "${flower.id}" has a non-numeric value at month index ${monthIndex}`);
      }
    });
  });
}

function wireUi() {
  pauseBtn.addEventListener('click', () => {
    const now = performance.now();
    if (!state.isPaused) {
      state.pauseElapsed = Math.max(0, now - startTime - state.elapsedBeforePause);
      state.isPaused = true;
      state.pauseStartedAt = now;
      pauseBtn.textContent = 'Resume';
    } else {
      state.isPaused = false;
      if (state.pauseStartedAt != null) {
        state.elapsedBeforePause += now - state.pauseStartedAt;
      }
      state.pauseStartedAt = null;
      state.pauseElapsed = 0;
      pauseBtn.textContent = 'Pause';
    }
    renderChart();
  });

  resetBtn.addEventListener('click', () => {
    startTime = performance.now();
    state.sweepMonth = 0;
    state.elapsedBeforePause = 0;
    state.pauseStartedAt = null;
    state.pauseElapsed = 0;
    state.isPaused = false;
    state.isStatic = false;
    pauseBtn.textContent = 'Pause';
    staticBtn.textContent = 'Static Graph';
    clearHover({ preserveSelected: false });
    renderChart();
  });

  staticBtn.addEventListener('click', () => {
    const now = performance.now();
    state.isStatic = !state.isStatic;

    if (state.isStatic) {
      staticBtn.textContent = 'Animated Graph';
      if (!state.isPaused) {
        state.pauseElapsed = Math.max(0, now - startTime - state.elapsedBeforePause);
        state.isPaused = true;
        state.pauseStartedAt = now;
        pauseBtn.textContent = 'Resume';
      }
    } else {
      staticBtn.textContent = 'Static Graph';
      if (state.pauseStartedAt != null) {
        state.elapsedBeforePause += now - state.pauseStartedAt;
      }
      state.isPaused = false;
      state.pauseStartedAt = null;
      state.pauseElapsed = 0;
      pauseBtn.textContent = 'Pause';
    }

    renderChart();
  });

  svg.addEventListener('mouseleave', () => {
    if (state.hoveredFlowerId !== null) {
      clearHover();
      renderChart();
    }
  });

  svg.addEventListener('mousemove', (e) => {
    const interactive = e.target && e.target.dataset && e.target.dataset.interactive === 'true';
    if (!interactive && state.hoveredFlowerId !== null) {
      clearHover();
      renderChart();
    }
  });
}

function polar(monthIndex, value, flowerIndex) {
  const angleBase = (-Math.PI / 2) + (monthIndex / 12) * (Math.PI * 2);
  const angleOffset = (flowerIndex - (flowers.length - 1) / 2) * 0.065;
  const angle = angleBase + angleOffset;
  const r = innerR + value * (maxR - innerR);
  return {
    x: cx + Math.cos(angle) * r,
    y: cy + Math.sin(angle) * r,
    angle,
    r
  };
}

function circlePoint(radius, monthFloat) {
  const angle = (-Math.PI / 2) + (monthFloat / 12) * Math.PI * 2;
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
    angle
  };
}

function monthArcPath(startMonthFloat, endMonthFloat, radiusInner, radiusOuter) {
  let start = startMonthFloat;
  let end = endMonthFloat;
  if (end < start) end += 12;
  const startAngle = (-Math.PI / 2) + (start / 12) * Math.PI * 2;
  const endAngle = (-Math.PI / 2) + (end / 12) * Math.PI * 2;
  const p1 = { x: cx + Math.cos(startAngle) * radiusOuter, y: cy + Math.sin(startAngle) * radiusOuter };
  const p2 = { x: cx + Math.cos(endAngle) * radiusOuter, y: cy + Math.sin(endAngle) * radiusOuter };
  const p3 = { x: cx + Math.cos(endAngle) * radiusInner, y: cy + Math.sin(endAngle) * radiusInner };
  const p4 = { x: cx + Math.cos(startAngle) * radiusInner, y: cy + Math.sin(startAngle) * radiusInner };
  const largeArc = (endAngle - startAngle) > Math.PI ? 1 : 0;
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${radiusOuter} ${radiusOuter} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)} A ${radiusInner} ${radiusInner} 0 ${largeArc} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)} Z`;
}

function revealSectorPath(monthFloat, radius = revealRadius) {
  let end = monthFloat;
  if (end <= 0.001) end = 0.001;
  const startAngle = -Math.PI / 2;
  const endAngle = (-Math.PI / 2) + (end / 12) * Math.PI * 2;
  const p1 = { x: cx + Math.cos(startAngle) * radius, y: cy + Math.sin(startAngle) * radius };
  const p2 = { x: cx + Math.cos(endAngle) * radius, y: cy + Math.sin(endAngle) * radius };
  const largeArc = (endAngle - startAngle) > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} Z`;
}

function fixedWedgePath(centerMonthFloat, widthMonths = cursorWedgeWidthMonths, radius = cursorWedgeRadius) {
  let start = centerMonthFloat - widthMonths / 2;
  let end = centerMonthFloat + widthMonths / 2;
  while (start < 0) {
    start += 12;
    end += 12;
  }
  const startAngle = (-Math.PI / 2) + (start / 12) * Math.PI * 2;
  const endAngle = (-Math.PI / 2) + (end / 12) * Math.PI * 2;
  const p1 = { x: cx + Math.cos(startAngle) * radius, y: cy + Math.sin(startAngle) * radius };
  const p2 = { x: cx + Math.cos(endAngle) * radius, y: cy + Math.sin(endAngle) * radius };
  const largeArc = (endAngle - startAngle) > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} Z`;
}

function strongSeasonSegments(profile, threshold = strongThreshold) {
  const active = profile
    .map((v, i) => ({ v, i }))
    .filter(d => d.v > threshold)
    .map(d => d.i)
    .sort((a, b) => a - b);
  if (!active.length) return [];

  const segments = [];
  let segStart = active[0];
  let prev = active[0];
  for (let i = 1; i < active.length; i++) {
    const cur = active[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    segments.push({ start: segStart, end: prev });
    segStart = cur;
    prev = cur;
  }
  segments.push({ start: segStart, end: prev });

  if (segments.length > 1 && segments[0].start === 0 && segments[segments.length - 1].end === 11) {
    const first = segments.shift();
    const last = segments.pop();
    segments.unshift({ start: last.start, end: first.end + 12 });
  }
  return segments;
}

function pathForFlower(flower, index) {
  const pts = flower.profile.map((v, i) => polar(i, v, index));
  let d = '';
  pts.forEach((p, i) => {
    if (i === 0) d += `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    else {
      const prev = pts[i - 1];
      const mx = (prev.x + p.x) / 2;
      const my = (prev.y + p.y) / 2;
      d += ` Q ${prev.x.toFixed(2)} ${prev.y.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
    }
  });
  const first = pts[0];
  const last = pts[pts.length - 1];
  const mx = (last.x + first.x) / 2;
  const my = (last.y + first.y) / 2;
  d += ` Q ${last.x.toFixed(2)} ${last.y.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
  d += ` T ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  return d;
}

function flowerSeason(profile) {
  const strong = profile.map((v, i) => ({ v, i })).filter(d => d.v >= strongThreshold).map(d => months[d.i]);
  return strong.length ? `${strong[0]}–${strong[strong.length - 1]}` : 'Brief / scattered';
}

function peakMonth(profile) {
  const max = Math.max(...profile);
  return months[profile.findIndex(v => v === max)];
}

function renderLegend() {
  legend.innerHTML = '';
  flowers.forEach(flower => {
    const item = document.createElement('button');
    item.className = 'legend-item';
    const selected = state.selectedFlower === flower.id;
    if (state.selectedFlower && !selected) item.classList.add('dimmed');
    item.innerHTML = `<span class="swatch" style="background:${flower.color}"></span><span>${flower.emoji} ${flower.name}</span>`;
    item.onclick = () => {
      state.selectedFlower = state.selectedFlower === flower.id ? null : flower.id;
      updateInfoCard();
      renderLegend();
      renderChart();
    };
    legend.appendChild(item);
  });
}

function updateInfoCard(flower = null) {
  if (!flower) {
    infoCard.innerHTML = `
      <h2>All flowers</h2>
      <div class="small">Hover a bloom dot or click a legend item to inspect a flower’s peak month, visible bloom window, and suggested Madrid location.</div>
      <div class="meta">
        <div class="meta-row"><div class="label">Peak</div><div>—</div></div>
        <div class="meta-row"><div class="label">Season</div><div>—</div></div>
        <div class="meta-row"><div class="label">Location</div><div>—</div></div>
      </div>`;
    return;
  }
  infoCard.innerHTML = `
    <h2>${flower.emoji} ${flower.name}</h2>
    <div class="small">${flower.note}</div>
    <div class="meta">
      <div class="meta-row"><div class="label">Peak</div><div>${peakMonth(flower.profile)}</div></div>
      <div class="meta-row"><div class="label">Season</div><div>${flowerSeason(flower.profile)}</div></div>
      <div class="meta-row"><div class="label">Location</div><div>${flower.location}</div></div>
      <div class="meta-row"><div class="label">Bloom range</div><div>${flower.profile.map(v => Math.round(v * 100)).join(' · ')}%</div></div>
    </div>`;
}

function showTooltip(event, html) {
  tooltip.innerHTML = html;
  tooltip.classList.add('visible');
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY - 8}px`;
}

function hideTooltip() {
  tooltip.classList.remove('visible');
}

function clearHover({ preserveSelected = true } = {}) {
  state.hoveredFlowerId = null;
  state.hoveredMonthIndex = null;
  hideTooltip();
  if (preserveSelected && state.selectedFlower) {
    const f = flowers.find(x => x.id === state.selectedFlower);
    updateInfoCard(f);
  } else {
    updateInfoCard();
  }
}

function renderChart() {
  if (!flowers.length || !months.length) return;

  svg.innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', width);
  bg.setAttribute('height', height);
  bg.setAttribute('fill', 'transparent');
  svg.appendChild(bg);
  bg.addEventListener('mousemove', () => {
    if (state.hoveredFlowerId !== null) {
      clearHover();
      renderChart();
    }
  });
  bg.addEventListener('mouseleave', () => {
    if (state.hoveredFlowerId !== null) {
      clearHover();
      renderChart();
    }
  });

  const defs = document.createElementNS(ns, 'defs');
  const clip = document.createElementNS(ns, 'clipPath');
  clip.setAttribute('id', 'revealClip');
  const clipShape = document.createElementNS(ns, 'path');
  clipShape.setAttribute('id', 'revealSector');
  const revealLeadMonth = state.isStatic ? 12 : state.sweepMonth + cursorWedgeWidthMonths / 2;
  clipShape.setAttribute('d', revealSectorPath(revealLeadMonth));
  clip.appendChild(clipShape);
  defs.appendChild(clip);
  svg.appendChild(defs);

  [0.25, 0.5, 0.75, 1].forEach(level => {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', innerR + level * (maxR - innerR));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', '#c9bbb0');
    circle.setAttribute('stroke-width', '1');
    circle.setAttribute('stroke-dasharray', '1 8');
    circle.setAttribute('stroke-linecap', 'round');
    svg.appendChild(circle);
  });

  months.forEach((month, i) => {
    const a = (-Math.PI / 2) + (i / 12) * Math.PI * 2;
    const x2 = cx + Math.cos(a) * (maxR + 22);
    const y2 = cy + Math.sin(a) * (maxR + 22);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', cx);
    line.setAttribute('y1', cy);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', '#f1e7df');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);

    const tx = cx + Math.cos(a) * (maxR + 44);
    const ty = cy + Math.sin(a) * (maxR + 44);
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', tx);
    label.setAttribute('y', ty);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    label.setAttribute('font-size', '16');
    label.setAttribute('font-weight', i % 3 === 0 ? '700' : '500');
    label.setAttribute('fill', i % 3 === 0 ? '#8f6d79' : '#9b8f88');
    label.textContent = month;
    svg.appendChild(label);
  });

  const scaleAxisX = cx;
  const scaleAxisY1 = cy + innerR;
  const scaleAxisY2 = cy + maxR;
  const scaleLine = document.createElementNS(ns, 'line');
  scaleLine.setAttribute('x1', scaleAxisX);
  scaleLine.setAttribute('y1', scaleAxisY1);
  scaleLine.setAttribute('x2', scaleAxisX);
  scaleLine.setAttribute('y2', scaleAxisY2);
  scaleLine.setAttribute('stroke', '#d9c9bf');
  scaleLine.setAttribute('stroke-width', '1.5');
  svg.appendChild(scaleLine);

  [0, 25, 50, 75, 100].forEach(tick => {
    const r = innerR + (tick / 100) * (maxR - innerR);
    const y = cy + r;
    const tickLine = document.createElementNS(ns, 'line');
    tickLine.setAttribute('x1', scaleAxisX - 7);
    tickLine.setAttribute('y1', y);
    tickLine.setAttribute('x2', scaleAxisX + 7);
    tickLine.setAttribute('y2', y);
    tickLine.setAttribute('stroke', '#d9c9bf');
    tickLine.setAttribute('stroke-width', '1.5');
    svg.appendChild(tickLine);

    const tickLabel = document.createElementNS(ns, 'text');
    tickLabel.setAttribute('x', scaleAxisX + 15);
    tickLabel.setAttribute('y', y + 4);
    tickLabel.setAttribute('font-size', '12');
    tickLabel.setAttribute('fill', '#9a8f89');
    tickLabel.textContent = tick;
    svg.appendChild(tickLabel);
  });

  const scaleLabel = document.createElementNS(ns, 'text');
  scaleLabel.setAttribute('x', scaleAxisX + 48);
  scaleLabel.setAttribute('y', cy + maxR + 22);
  scaleLabel.setAttribute('font-size', '12');
  scaleLabel.setAttribute('fill', '#9a8f89');
  scaleLabel.textContent = 'Bloom intensity (%)';
  svg.appendChild(scaleLabel);

  const revealGroup = document.createElementNS(ns, 'g');
  if (!state.isStatic) {
    revealGroup.setAttribute('clip-path', 'url(#revealClip)');
  }
  svg.appendChild(revealGroup);

  flowers.forEach((flower, flowerIndex) => {
    const strongSegments = strongSeasonSegments(flower.profile, diameterBandThreshold);
    if (strongSegments.length) {
      const bandInner = maxR + 36 + flowerIndex * 16;
      const bandOuter = bandInner + 14;
      strongSegments.forEach(seg => {
        const band = document.createElementNS(ns, 'path');
        band.setAttribute('d', monthArcPath(seg.start - 0.08, seg.end + 1.08, bandInner, bandOuter));
        band.setAttribute('fill', flower.color);
        band.setAttribute('fill-opacity', (!state.selectedFlower || state.selectedFlower === flower.id) ? '0.72' : '0.14');
        band.setAttribute('stroke', '#fffdf9');
        band.setAttribute('stroke-width', '1.2');
        revealGroup.appendChild(band);
      });
    }

    const selected = !state.selectedFlower || state.selectedFlower === flower.id;
    const group = document.createElementNS(ns, 'g');
    group.setAttribute('opacity', selected ? '1' : '0.16');
    revealGroup.appendChild(group);

    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', pathForFlower(flower, flowerIndex));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', flower.color);
    path.setAttribute('stroke-width', selected ? '4.8' : '3');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('opacity', selected ? '0.7' : '0.34');
    group.appendChild(path);

    const peak = Math.max(...flower.profile);

    flower.profile.forEach((value, monthIndex) => {
      if (value < strongThreshold) return;
      const p = polar(monthIndex, value, flowerIndex);
      const dot = document.createElementNS(ns, 'circle');
      const size = 4 + value * 12 + (value === peak ? 3 : 0);
      dot.setAttribute('cx', p.x);
      dot.setAttribute('cy', p.y);
      dot.setAttribute('r', size);
      dot.setAttribute('fill', flower.color);
      dot.setAttribute('fill-opacity', selected ? Math.max(0.42, value) : 0.28);
      dot.setAttribute('stroke', '#fffdf9');
      dot.setAttribute('stroke-width', value > 0.65 ? '2' : '1.2');
      dot.style.cursor = 'pointer';
      dot.dataset.interactive = 'true';

      if (value === peak) {
        const peakLabel = document.createElementNS(ns, 'text');
        peakLabel.setAttribute('x', p.x);
        peakLabel.setAttribute('y', p.y + 1);
        peakLabel.setAttribute('text-anchor', 'middle');
        peakLabel.setAttribute('dominant-baseline', 'middle');
        peakLabel.setAttribute('font-size', size + 7);
        peakLabel.textContent = flower.emoji;
        const labelVisible = state.hoveredFlowerId === flower.id;
        peakLabel.setAttribute('opacity', labelVisible ? (selected ? '0.96' : '0.24') : '0');
        peakLabel.style.pointerEvents = 'none';
        group.appendChild(peakLabel);
      }

      const tooltipHtml = `<strong>${flower.emoji} ${flower.name}</strong><br>${months[monthIndex]}<br>Bloom: ${Math.round(value * 100)}%<br><span style="opacity:.8">${flower.location}</span>`;

      const activateHover = (e) => {
        state.hoveredFlowerId = flower.id;
        state.hoveredMonthIndex = monthIndex;
        updateInfoCard(flower);
        showTooltip(e, tooltipHtml);
        renderChart();
      };

      dot.addEventListener('mouseenter', activateHover);
      dot.addEventListener('mousemove', (e) => {
        if (state.hoveredFlowerId !== flower.id || state.hoveredMonthIndex !== monthIndex) {
          state.hoveredFlowerId = flower.id;
          state.hoveredMonthIndex = monthIndex;
          renderChart();
        }
        showTooltip(e, tooltipHtml);
      });
      dot.addEventListener('mouseleave', () => {
        clearHover();
        renderChart();
      });
      dot.addEventListener('click', () => {
        state.selectedFlower = flower.id;
        clearHover();
        renderLegend();
        renderChart();
        updateInfoCard(flower);
      });
      group.appendChild(dot);
    });
  });

  if (!state.isStatic) {
    const cursorWedge = document.createElementNS(ns, 'path');
    cursorWedge.setAttribute('d', fixedWedgePath(state.sweepMonth, cursorWedgeWidthMonths, cursorWedgeRadius));
    cursorWedge.setAttribute('fill', '#bdb8b1');
    cursorWedge.setAttribute('fill-opacity', '0.12');
    cursorWedge.setAttribute('stroke', 'none');
    svg.appendChild(cursorWedge);

    const headLeadMonth = state.sweepMonth + cursorWedgeWidthMonths / 2;
    const headBar = document.createElementNS(ns, 'path');
    headBar.setAttribute('d', monthArcPath(headLeadMonth - 0.14, headLeadMonth - 0.02, sweepBandOuter + 0.5, sweepBandOuter + 6.5));
    headBar.setAttribute('fill', '#9b948d');
    headBar.setAttribute('fill-opacity', '0.98');
    headBar.setAttribute('stroke', '#fffdf9');
    headBar.setAttribute('stroke-width', '1.4');
    svg.appendChild(headBar);

    const headOuter = circlePoint(sweepBandOuter + 3, headLeadMonth);
    const head = document.createElementNS(ns, 'circle');
    head.setAttribute('cx', headOuter.x);
    head.setAttribute('cy', headOuter.y);
    head.setAttribute('r', '5.5');
    head.setAttribute('fill', '#8f8983');
    head.setAttribute('stroke', '#fffdf9');
    head.setAttribute('stroke-width', '2');
    svg.appendChild(head);
  }

  const core = document.createElementNS(ns, 'circle');
  core.setAttribute('cx', cx);
  core.setAttribute('cy', cy);
  core.setAttribute('r', innerR - 10);
  core.setAttribute('fill', '#f6eee8');
  core.setAttribute('stroke', '#eedfd2');
  core.setAttribute('stroke-width', '1');
  svg.appendChild(core);

  const centerText = document.createElementNS(ns, 'text');
  centerText.setAttribute('x', cx);
  centerText.setAttribute('y', cy - 4);
  centerText.setAttribute('text-anchor', 'middle');
  centerText.setAttribute('font-size', '16');
  centerText.setAttribute('font-weight', '700');
  centerText.setAttribute('fill', '#7a6b65');
  centerText.textContent = 'Bloom';
  svg.appendChild(centerText);

  const centerSub = document.createElementNS(ns, 'text');
  centerSub.setAttribute('x', cx);
  centerSub.setAttribute('y', cy + 18);
  centerSub.setAttribute('text-anchor', 'middle');
  centerSub.setAttribute('font-size', '12');
  centerSub.setAttribute('fill', '#9a8f89');
  centerSub.textContent = 'intensity';
  svg.appendChild(centerSub);
}

function animate(timestamp) {
  if (!state.isStatic) {
    const effectiveElapsed = state.isPaused
      ? state.pauseElapsed
      : Math.max(0, timestamp - startTime - state.elapsedBeforePause);
    const elapsed = effectiveElapsed % state.cycleMs;
    state.sweepMonth = (elapsed / state.cycleMs) * 12;
  }
  renderChart();
  requestAnimationFrame(animate);
}

loadData();
