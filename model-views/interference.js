import { mountCanvas } from './canvas.js';

const INK = '#e0f0f4';
const MUTED = '#8da8b7';
const RULER = '#ffcc83';
const TWO_PI = 2 * Math.PI;
const selectionListeners = new Set();
let preferredOrder = 0;

export function watchInterferenceSelection(listener) {
  selectionListeners.add(listener);
  listener(preferredOrder);
  return () => selectionListeners.delete(listener);
}

function selectInterferenceOrder(order) {
  if (preferredOrder === order) return;
  preferredOrder = order;
  for (const listener of selectionListeners) listener(order);
}

function layout(compact, companion) {
  if (companion) return { screen: 71, face: 235, curve: 406, curveEnd: 664, top: 69, bottom: 267 };
  return compact
    ? { source: 72, slit: 168, screen: 395, face: 91, curve: 573, curveEnd: 696, top: 69, bottom: 267 }
    : { source: 112, slit: 226, screen: 464, face: 67, curve: 601, curveEnd: 693, top: 69, bottom: 267 };
}

function line(ctx, x1, y1, x2, y2, color, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function label(ctx, text, x, y, { color = MUTED, size = 11, align = 'left', weight = 500 } = {}) {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  ctx.fillText(text, x, y);
}

function colorOf(result) {
  const { r, g, b } = result.color;
  return {
    light: (alpha) => `rgba(${r}, ${g}, ${b}, ${alpha})`,
    visible: (alpha) => `rgba(${Math.round(230 * .24 + r * .76)}, ${Math.round(245 * .24 + g * .76)}, ${Math.round(255 * .24 + b * .76)}, ${alpha})`,
  };
}

function sampledPeaks(profile) {
  const peaks = [];
  for (let index = 1; index < profile.length - 1; index += 1) {
    const before = profile[index - 1];
    const peak = profile[index];
    const after = profile[index + 1];
    if (peak.intensity < .04 || peak.intensity <= before.intensity || peak.intensity < after.intensity) continue;

    const curvature = before.intensity - 2 * peak.intensity + after.intensity;
    const offset = Math.max(-.5, Math.min(.5, (before.intensity - after.intensity) / (2 * curvature)));
    peaks.push({
      position: peak.yMm + offset * (after.yMm - peak.yMm),
      intensity: Math.min(1, peak.intensity - (before.intensity - after.intensity) * offset / 4),
    });
  }
  return peaks;
}

function fringePairs(result, profile) {
  if (result.observePath || result.slitWidth >= result.slitSeparation) return [];

  const peaks = sampledPeaks(profile);
  const matchingPeaks = new Map();
  const tolerance = result.fringeSpacingMm * .43;
  for (const fringe of result.brightPositions) {
    const peak = peaks.find(({ position }) => Math.abs(position - fringe.yMm) <= tolerance);
    if (peak) matchingPeaks.set(fringe.order, peak);
  }

  const pairs = [];
  for (const [order, first] of matchingPeaks) {
    const second = matchingPeaks.get(order + 1);
    if (second) pairs.push({ order, first, second, distance: second.position - first.position });
  }
  return pairs;
}

export function getInterferenceFringePairs(result) {
  return fringePairs(result, result.intensityProfile);
}

function prepare(result) {
  const profile = result.observePath ? result.singleSlitProfile : result.intensityProfile;
  const from = profile[0].yMm;
  const to = profile.at(-1).yMm;
  return { profile, from, to, colors: colorOf(result), pairs: fringePairs(result, profile) };
}

function screenY(position, geometry, data) {
  return geometry.bottom - (position - data.from) / (data.to - data.from) * (geometry.bottom - geometry.top);
}

function drawBackground(ctx, width, height, g, companion) {
  const glow = ctx.createRadialGradient(280, 154, 24, 280, 154, 410);
  glow.addColorStop(0, '#142738');
  glow.addColorStop(.7, '#0a1621');
  glow.addColorStop(1, '#060d16');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  if (companion) return;

  const bed = ctx.createLinearGradient(0, 279, 0, 298);
  bed.addColorStop(0, '#273f4e');
  bed.addColorStop(.18, '#15232e');
  bed.addColorStop(1, '#0a111a');
  ctx.fillStyle = bed;
  ctx.fillRect(25, 279, g.screen + g.face - 10, 19);
  line(ctx, 25, 279, g.screen + g.face + 15, 279, '#476478');
  for (let x = 39; x < g.screen + g.face; x += 12) {
    line(ctx, x, 283, x, 287 + (x % 5 === 0 ? 4 : 0), '#5c758550');
  }
}

function drawSource(ctx, g, middle, d, result) {
  const barrel = ctx.createLinearGradient(0, middle - 15, 0, middle + 15);
  barrel.addColorStop(0, '#4e6473');
  barrel.addColorStop(.18, '#263946');
  barrel.addColorStop(.72, '#0b1824');
  barrel.addColorStop(1, '#38505f');
  ctx.fillStyle = '#253b48';
  ctx.fillRect(g.source - 33, middle + 14, 10, 97);
  ctx.fillStyle = '#243947';
  ctx.fillRect(g.source - 49, 273, 42, 6);
  ctx.fillStyle = barrel;
  ctx.fillRect(g.source - 52, middle - 15, 47, 30);
  ctx.fillStyle = '#546d7e';
  ctx.fillRect(g.source - 6, middle - 14, 6, 28);
  ctx.fillStyle = '#101e2b';
  ctx.fillRect(g.source - 1, middle - 8, 5, 16);

  const beam = ctx.createLinearGradient(0, middle - 19, 0, middle + 19);
  beam.addColorStop(0, d.colors.light(0));
  beam.addColorStop(.5, d.colors.light(.19));
  beam.addColorStop(1, d.colors.light(0));
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(g.source + 4, middle - 3);
  ctx.lineTo(g.slit, middle - 20);
  ctx.lineTo(g.slit, middle + 20);
  ctx.lineTo(g.source + 4, middle + 3);
  ctx.closePath();
  ctx.fill();
  if (result.emitMode === 'wave') line(ctx, g.source + 3, middle, g.slit - 2, middle, d.colors.visible(.42));
  ctx.shadowColor = d.colors.visible(.9);
  ctx.shadowBlur = 14;
  line(ctx, g.source + 3, middle - 3, g.source + 3, middle + 3, d.colors.visible(.97), 4);
  ctx.shadowBlur = 0;
}

function drawWavefronts(ctx, g, middle, gap, colors, result, snapshot) {
  const width = g.screen - g.slit;
  const wavelength = result.wavelength * 1e9;
  const separation = 14 + (wavelength - 380) / 32;
  const progress = Number.isFinite(snapshot.progress) ? snapshot.progress : 0;
  const phase = progress * 9 * separation % separation;
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.source + 7, middle - 23, g.slit - g.source - 15, 46);
  ctx.clip();
  ctx.strokeStyle = colors.visible(.33);
  ctx.lineWidth = 1;
  for (let radius = 12 + phase; radius < g.slit - g.source; radius += separation) {
    ctx.beginPath();
    ctx.arc(g.source, middle, radius, -.42, .42);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(g.slit + 10, g.top + 1, width - 10, g.bottom - g.top - 2);
  ctx.clip();
  if (!result.observePath) ctx.globalCompositeOperation = 'screen';

  const paths = [[middle - gap, '102, 224, 233'], [middle + gap, '120, 160, 248']];
  for (const [slitY, tint] of paths) {
    const spread = result.observePath ? .61 : .98;
    for (let radius = 12 + phase; radius <= width * 1.36; radius += separation) {
      const blend = Math.max(0, 1 - radius / (width * 1.58));
      ctx.strokeStyle = `rgba(${tint}, ${.16 + blend * .39})`;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(g.slit + 4, slitY, radius, -spread, spread);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.setLineDash([5, 6]);
  line(ctx, g.slit + 10, middle, g.screen, middle, '#aeeced42');
  ctx.setLineDash([]);
}

function drawSlits(ctx, g, middle, gap, colors, observePath) {
  const panel = ctx.createLinearGradient(g.slit - 6, 0, g.slit + 9, 0);
  panel.addColorStop(0, '#586977');
  panel.addColorStop(.30, '#293f4f');
  panel.addColorStop(1, '#101c29');
  const slitWidth = 3;
  ctx.fillStyle = panel;
  ctx.fillRect(g.slit - 6, g.top + 17, 13, middle - gap - slitWidth - g.top - 17);
  ctx.fillRect(g.slit - 6, middle - gap + slitWidth, 13, 2 * (gap - slitWidth));
  ctx.fillRect(g.slit - 6, middle + gap + slitWidth, 13, g.bottom + 12 - (middle + gap + slitWidth));
  ctx.fillStyle = '#bacddd59';
  ctx.fillRect(g.slit - 6, g.top + 17, 13, 1);

  for (const x of [middle - gap, middle + gap]) {
    ctx.shadowColor = colors.visible(.9);
    ctx.shadowBlur = 11;
    line(ctx, g.slit - 5, x, g.slit + 7, x, colors.visible(.89), 2);
    ctx.shadowBlur = 0;
    if (observePath) {
      ctx.strokeStyle = RULER;
      ctx.lineWidth = 1.3;
      ctx.strokeRect(g.slit + 9, x - 6, 10, 12);
    }
  }
}

function photonCount(snapshot, result) {
  if (snapshot.runStatus === 'idle') return 0;
  const progress = snapshot.runStatus === 'finished' ? 1 : Math.max(0, Math.min(1, snapshot.progress || 0));
  return Math.floor(progress * result.photonHits.length);
}

function drawScreen(ctx, g, d, result, count, companion) {
  const height = g.bottom - g.top;
  ctx.beginPath();
  ctx.moveTo(g.screen + g.face + 4, g.top - 4);
  ctx.lineTo(g.screen + g.face + 11, g.top + 3);
  ctx.lineTo(g.screen + g.face + 11, g.bottom - 3);
  ctx.lineTo(g.screen + g.face + 4, g.bottom + 4);
  ctx.closePath();
  ctx.fillStyle = '#142a3d';
  ctx.fill();
  ctx.fillStyle = '#254253';
  ctx.fillRect(g.screen - 4, g.top - 4, g.face + 8, height + 8);
  ctx.fillStyle = '#040b14';
  ctx.fillRect(g.screen, g.top, g.face, height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.screen, g.top, g.face, height);
  ctx.clip();

  if (result.emitMode === 'photon') {
    for (let index = 0; index < count; index += 1) {
      const hit = result.photonHits[index];
      const x = g.screen + 2 + ((index * .61803398875) % 1) * (g.face - 4);
      const y = screenY(hit.y * 1000, g, d);
      ctx.fillStyle = hit.slit === 'A' ? '#8bf1e4a5' : hit.slit === 'B' ? '#ffd195a5' : d.colors.visible(.7);
      ctx.fillRect(x, y, 1.5, 1.45);
    }
  } else {
    const gradient = ctx.createLinearGradient(0, g.bottom, 0, g.top);
    const range = d.to - d.from;
    for (const point of d.profile) {
      gradient.addColorStop((point.yMm - d.from) / range, d.colors.visible(.84 * point.intensity ** .8));
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(g.screen, g.top, g.face, height);
    const edgeShade = ctx.createLinearGradient(g.screen, 0, g.screen + g.face, 0);
    edgeShade.addColorStop(0, '#07122277');
    edgeShade.addColorStop(.4, '#07122200');
    edgeShade.addColorStop(.7, '#07122200');
    edgeShade.addColorStop(1, '#07122277');
    ctx.fillStyle = edgeShade;
    ctx.fillRect(g.screen, g.top, g.face, height);
  }
  ctx.restore();
  if (!companion) line(ctx, g.screen + g.face + 4, g.bottom + 5, g.screen + g.face + 4, 279, '#476478', 2);
}

function drawIntensity(ctx, g, d, compact, companion) {
  const xSpan = g.curveEnd - g.curve;
  const textSize = companion ? 18 : compact ? 13 : 10;
  for (const step of [0, .5, 1]) {
    const x = g.curve + xSpan * step;
    line(ctx, x, g.top, x, g.bottom, step === 0 ? '#6c899a' : '#2b4357');
    label(ctx, String(step), x, g.bottom + (companion ? 18 : 13), { size: textSize, align: 'center' });
  }
  for (const position of [d.from, d.from / 2, 0, d.to / 2, d.to]) {
    const y = screenY(position, g, d);
    line(ctx, g.curve, y, g.curveEnd, y, position === 0 ? '#587184' : '#233949');
    const value = String(Number(position.toFixed(1)));
    label(ctx, value, g.curve - 7, y, { size: textSize, align: 'right' });
  }

  ctx.beginPath();
  ctx.moveTo(g.curve, g.bottom);
  for (const point of d.profile) ctx.lineTo(g.curve + xSpan * point.intensity, screenY(point.yMm, g, d));
  ctx.lineTo(g.curve, g.top);
  ctx.closePath();
  const fill = ctx.createLinearGradient(g.curve, 0, g.curveEnd, 0);
  fill.addColorStop(0, d.colors.visible(.04));
  fill.addColorStop(1, d.colors.visible(.2));
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.beginPath();
  for (let index = 0; index < d.profile.length; index += 1) {
    const point = d.profile[index];
    const x = g.curve + xSpan * point.intensity;
    const y = screenY(point.yMm, g, d);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineWidth = 1.65;
  ctx.strokeStyle = d.colors.visible(.97);
  ctx.stroke();
}

function formatDistance(distance) {
  return distance.toFixed(distance < 10 ? 2 : 1);
}

function drawRuler(ctx, g, d, pair) {
  const rulerX = g.screen + g.face + 12;
  const y1 = screenY(pair.first.position, g, d);
  const y2 = screenY(pair.second.position, g, d);
  const xSpan = g.curveEnd - g.curve;

  for (const peak of [pair.first, pair.second]) {
    const y = screenY(peak.position, g, d);
    const x = g.curve + xSpan * peak.intensity;
    ctx.setLineDash([3, 4]);
    line(ctx, g.screen + 2, y, x, y, '#ffcc838d');
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, 3.4, 0, TWO_PI);
    ctx.fillStyle = RULER;
    ctx.fill();
    line(ctx, rulerX - 5, y, rulerX + 5, y, RULER, 1.5);
  }
  line(ctx, rulerX, y1, rulerX, y2, RULER, 1.5);
}

function drawScene(ctx, snapshot, dimensions, d, pair, companion) {
  const { width, height, compact } = dimensions;
  const g = layout(compact, companion);
  drawBackground(ctx, width, height, g, companion);
  if (!d) {
    label(ctx, '等待实验数据', width / 2, height / 2, { color: INK, size: 16, align: 'center' });
    return;
  }

  const result = snapshot.result;
  const middle = (g.top + g.bottom) / 2;
  const gap = 8 + Math.min(13, result.slitSeparation * 13000);
  const count = result.emitMode === 'photon' ? photonCount(snapshot, result) : 0;
  const heading = { color: INK, size: companion ? 26 : compact ? 17 : 13, align: 'center', weight: 650 };
  const subtitle = { size: companion ? 18 : compact ? 13 : 10, align: 'center' };

  if (!companion) {
    line(ctx, g.source, middle, g.screen, middle, '#56768b39');
    drawSource(ctx, g, middle, d, result);
    if (result.emitMode === 'wave') drawWavefronts(ctx, g, middle, gap, d.colors, result, snapshot);
    drawSlits(ctx, g, middle, gap, d.colors, result.observePath);
    label(ctx, '光源', g.source - 24, 29, heading);
    label(ctx, `λ ${Math.round(result.wavelength * 1e9)} nm`, g.source - 24, 48, subtitle);
    label(ctx, '双缝', g.slit, 29, heading);
    label(ctx, `d ${(result.slitSeparation * 1e3).toFixed(2)} mm`, g.slit, 48, subtitle);
    label(ctx, `缝屏距离  L ${result.screenDistance.toFixed(2)} m`, g.slit + (g.screen - g.slit) / 2, 314, subtitle);
  }

  drawScreen(ctx, g, d, result, count, companion);
  drawIntensity(ctx, g, d, compact, companion);
  if (pair) drawRuler(ctx, g, d, pair);
  const titleY = companion ? 26 : 29;
  const subtitleY = companion ? 50 : 48;
  label(ctx, '观察屏', g.screen + g.face / 2, titleY, heading);
  label(ctx, result.emitMode === 'photon' ? `${count} / ${result.photonHits.length} 个光子` : '屏面亮度', g.screen + g.face / 2, subtitleY, subtitle);
  label(ctx, result.emitMode === 'photon' ? '理论相对光强' : '相对光强', (g.curve + g.curveEnd) / 2 - 9, titleY, heading);
  label(ctx, '屏上位置 y（mm）', (g.curve + g.curveEnd) / 2 - 9, subtitleY, subtitle);

  const status = result.observePath ? '单缝衍射剖面'
    : pair ? `Δy ≈ ${formatDistance(pair.distance)} mm`
      : result.emitMode === 'photon' ? '按模拟进度累积落点' : '当前无可测量的相邻明纹';
  label(ctx, status, g.screen + (g.curveEnd - g.screen) / 2, 314, {
    color: pair ? RULER : MUTED, align: 'center', size: companion ? 22 : compact ? 14 : 12, weight: 650,
  });
}

function pairLabel(order) {
  const name = (value) => value === 0 ? '中央' : `${value > 0 ? '+' : '−'}${Math.abs(value)} 级`;
  return `${name(order)}与${name(order + 1)}`;
}

function makeControls(root, setParameters) {
  const controls = document.createElement('div');
  controls.className = 'physics-view-controls';

  function button(text, patch) {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = text;
    control.setAttribute('aria-pressed', 'false');
    control.addEventListener('click', () => setParameters(patch()));
    controls.append(control);
    return control;
  }

  const waves = button('连续光波', () => ({ emitMode: 'wave' }));
  const photons = button('单光子', () => ({ emitMode: 'photon' }));
  const detector = button('路径探测', () => ({ observePath: detector.getAttribute('aria-pressed') === 'true' ? 'off' : 'on' }));
  const selector = document.createElement('select');
  selector.setAttribute('aria-label', '选择要测量的相邻明纹');
  const status = document.createElement('output');
  controls.append(selector, status);
  root.append(controls);
  return { controls, waves, photons, detector, selector, status };
}

export function createInterferenceView({ root, setParameters, companion = false }) {
  let snapshot;
  let data;
  let selectedOrder = preferredOrder;
  let measuredPair;
  const surface = mountCanvas(root, {
    label: companion ? '左侧为双缝实验的观察屏，右侧为同一屏面位置的相对光强。可点击相邻明纹之间或使用下方菜单测量。'
      : '双缝干涉实验，左侧从光源经过双缝到达观察屏，右侧是同一屏面位置的相对光强。可点击两个相邻明纹之间或使用下方菜单测量。',
    draw: (ctx, current, dimensions) => drawScene(ctx, current, dimensions, data, measuredPair, companion),
  });
  const { canvas, getPoint } = surface;
  const ui = makeControls(root, setParameters);

  function changeSelection(order) {
    selectedOrder = order;
    selectInterferenceOrder(order);
    if (snapshot) update(snapshot);
  }

  function chooseFromScreen(event) {
    if (!measuredPair) return;
    const point = getPoint(event);
    if (!point) return;
    const { x, y } = point;
    const g = layout(canvas.clientWidth < 475, companion);
    if (x < g.screen || x > g.curveEnd + 8 || y < g.top || y > g.bottom) return;

    const position = data.to - (y - g.top) / (g.bottom - g.top) * (data.to - data.from);
    const chosen = data.pairs.find(({ first, second }) => position >= first.position && position <= second.position);
    if (chosen) changeSelection(chosen.order);
  }

  ui.selector.addEventListener('change', () => changeSelection(Number(ui.selector.value)));
  canvas.addEventListener('click', chooseFromScreen);

  function update(next) {
    const result = next.result;
    if (snapshot?.result !== result) {
      data = result?.intensityProfile?.length > 1 ? prepare(result) : undefined;
      const options = data?.pairs.map(({ order }) => {
        const option = document.createElement('option');
        option.value = String(order);
        option.textContent = pairLabel(order);
        return option;
      }) ?? [];
      ui.selector.replaceChildren(...options);
      ui.waves.setAttribute('aria-pressed', String(result?.emitMode === 'wave'));
      ui.photons.setAttribute('aria-pressed', String(result?.emitMode === 'photon'));
      ui.detector.setAttribute('aria-pressed', String(result?.observePath === true));
    }
    snapshot = next;
    const canRead = !!data?.pairs.length && (result.emitMode === 'wave' || next.runStatus === 'finished');
    measuredPair = canRead ? data.pairs.find(({ order }) => order === selectedOrder)
      ?? data.pairs.find(({ order }) => order === 0)
      ?? data.pairs[0] : undefined;
    if (measuredPair) {
      selectedOrder = measuredPair.order;
      selectInterferenceOrder(selectedOrder);
      ui.selector.value = String(selectedOrder);
    }
    ui.selector.hidden = !canRead;
    ui.selector.disabled = !canRead;
    const note = measuredPair ? `相邻明纹 Δy ≈ ${formatDistance(measuredPair.distance)} mm`
      : result?.observePath ? '路径已探测，无法测量干涉条纹'
        : result?.emitMode === 'photon' && next.runStatus !== 'finished' ? '发射结束后可测量相邻明纹'
          : '当前采样内无可测量的相邻明纹';
    if (ui.status.textContent !== note) ui.status.textContent = note;
    surface.update(next);
  }

  return {
    update,
    destroy() {
      canvas.removeEventListener('click', chooseFromScreen);
      surface.destroy();
      ui.controls.remove();
    },
  };
}
