import { mountCanvas } from './canvas.js?v=field1';

const WIDTH = 720;
const PLAN_WIDTH = 400;
const HEIGHT = 340;
const PROBE_EVENT = 'physics-terrain-probe';
// The potential-terrain solver regularizes the field within 8 mm of a point charge.
const CHARGE_REGULARIZATION_M = .008;
const REFERENCE_CHARGE_C = 2e-6;
const COLORS = {
  surface: '#0a1828',
  neutral: [90, 171, 181],
  positive: [249, 154, 113],
  negative: [93, 199, 247],
  probe: '#fff0b2',
  label: '#c5dce9',
};
const LEVELS = [-1.35, -.92, -.65, -.45, -.31, -.20, -.12, -.065, -.026, 0, .026, .065, .12, .20, .31, .45, .65, .92, 1.35];
const GRID_STEP = 2;
const formatter = new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 4 });

function line(ctx, from, to, stroke, width = 1) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function mark(ctx, point, fill, radius) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function tint(signedStrength, opacity) {
  const target = signedStrength < 0 ? COLORS.negative : COLORS.positive;
  const strength = Math.min(1, Math.abs(signedStrength));
  const rgb = COLORS.neutral.map((component, index) =>
    Math.round(component + (target[index] - component) * strength),
  );
  return `rgba(${rgb.join(',')},${opacity})`;
}

function makeGrid(result, companion) {
  if (!result || !Array.isArray(result.terrain) || !result.bounds) return null;
  const size = Math.sqrt(result.terrain.length);
  if (!Number.isInteger(size) || size < 2) return null;
  const { xMin, xMax, yMin, yMax } = result.bounds;
  const domainWidth = xMax - xMin;
  const domainHeight = yMax - yMin;
  if (domainWidth <= 0 || domainHeight <= 0) return null;
  const scale = Math.min((companion ? PLAN_WIDTH - 12 : 226) / domainWidth, (companion ? HEIGHT - 16 : 224) / domainHeight);
  const mapWidth = domainWidth * scale;
  const mapHeight = domainHeight * scale;
  const map = {
    left: (companion ? PLAN_WIDTH / 2 : 580) - mapWidth / 2,
    top: (companion ? HEIGHT / 2 : 169) - mapHeight / 2,
    width: mapWidth,
    height: mapHeight,
  };
  const charge = Math.abs(result.charges?.[0]?.q ?? REFERENCE_CHARGE_C);
  const potentialExtent = Math.max(Math.abs(result.phiRange?.min ?? 0), Math.abs(result.phiRange?.max ?? 0));
  // Keep the same height and contour scales when changing charge alone.
  const reference = Math.max(1, potentialExtent * REFERENCE_CHARGE_C / (charge || REFERENCE_CHARGE_C));
  const project = (point, flat = false) => {
    const u = (point.x - xMin) / domainWidth - .5;
    const v = (point.y - yMin) / domainHeight - .5;
    const elevation = flat ? 0 : Math.tanh(point.phi / reference);
    return {
      x: 228 + u * 255 - v * 134,
      y: 168 + u * 64 + v * 110 - elevation * 106,
    };
  };
  const plan = point => ({ x: map.left + (point.x - xMin) * scale, y: map.top + map.height - (point.y - yMin) * scale });
  return { result, size, reference, bounds: result.bounds, map, project, plan };
}

function heading(ctx, title, x, compact) {
  ctx.fillStyle = COLORS.label;
  ctx.textAlign = 'center';
  ctx.font = `600 ${compact ? 20 : 16}px system-ui, sans-serif`;
  ctx.fillText(title, x, 31);
}

function paintSurface(ctx, grid) {
  const { result, size, reference, project } = grid;
  const getPoint = (column, row) => result.terrain[row * size + column];
  const edge = size - 1;
  const corners = [[0, 0], [edge, 0], [edge, edge], [0, edge]];
  for (let index = 0; index < corners.length; index++) {
    const from = project(getPoint(...corners[index]), true);
    const to = project(getPoint(...corners[(index + 1) % corners.length]), true);
    line(ctx, from, to, '#42647882', 1.35);
  }

  const cells = [];
  for (let row = 0; row < edge; row += GRID_STEP) {
    for (let column = 0; column < edge; column += GRID_STEP) {
      const right = Math.min(column + GRID_STEP, edge);
      const bottom = Math.min(row + GRID_STEP, edge);
      const vertices = [getPoint(column, row), getPoint(right, row), getPoint(right, bottom), getPoint(column, bottom)];
      const phi = vertices.reduce((sum, point) => sum + point.phi, 0) / vertices.length;
      cells.push({ depth: column * 64 + row * 110, phi, vertices: vertices.map(point => project(point)) });
    }
  }
  cells.sort((left, right) => left.depth - right.depth);
  ctx.lineJoin = 'round';
  for (const { phi, vertices } of cells) {
    const strength = Math.tanh(phi / reference);
    ctx.beginPath();
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (const point of vertices.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fillStyle = COLORS.surface;
    ctx.fill();
    ctx.fillStyle = tint(strength, .11 + .29 * Math.abs(strength));
    ctx.fill();
    ctx.strokeStyle = tint(strength, .30 + .56 * Math.abs(strength));
    ctx.lineWidth = .75;
    ctx.stroke();
  }
}

function contourCrossing(first, second, level) {
  if ((first.phi < level) === (second.phi < level)) return null;
  const fraction = (level - first.phi) / (second.phi - first.phi);
  return { x: first.x + (second.x - first.x) * fraction, y: first.y + (second.y - first.y) * fraction };
}

function paintContours(ctx, grid, compact) {
  const { result, size, reference, map, plan } = grid;
  const getPoint = (column, row) => result.terrain[row * size + column];
  const edge = size - 1;
  const cells = [];
  ctx.fillStyle = '#10141e';
  ctx.fillRect(map.left, map.top, map.width, map.height);
  for (let row = 0; row < edge; row++) {
    for (let column = 0; column < edge; column++) {
      const corners = [getPoint(column, row), getPoint(column + 1, row), getPoint(column + 1, row + 1), getPoint(column, row + 1)];
      const mean = corners.reduce((sum, point) => sum + point.phi, 0) / corners.length;
      const start = plan(corners[3]);
      const end = plan(corners[1]);
      const strength = Math.tanh(mean / reference);
      ctx.fillStyle = strength < 0
        ? `rgba(58, 149, 175, ${Math.min(.42, Math.abs(strength) ** .55 * .45)})`
        : `rgba(192, 77, 70, ${Math.min(.42, Math.abs(strength) ** .55 * .45)})`;
      ctx.fillRect(start.x, start.y, end.x - start.x + .2, end.y - start.y + .2);
      cells.push({ mean, corners });
    }
  }

  for (const ratio of LEVELS) {
    const level = ratio * reference;
    ctx.beginPath();
    for (const { mean, corners } of cells) {
      const crossings = corners.map((point, index) => contourCrossing(point, corners[(index + 1) % 4], level)).filter(Boolean);
      if (crossings.length < 2) continue;
      if (crossings.length === 4 && (mean < level) !== (corners[0].phi < level)) {
        crossings.push(crossings.shift());
      }
      for (let index = 0; index < crossings.length; index += 2) {
        const from = plan(crossings[index]);
        const to = plan(crossings[index + 1]);
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
      }
    }
    ctx.strokeStyle = ratio === 0 ? '#d2dbe2' : ratio > 0 ? '#e7a49a' : '#9acfdc';
    ctx.lineWidth = compact ? 1.25 : 1.1;
    ctx.stroke();
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(map.left, map.top, map.width, map.height);
  ctx.clip();
  for (const path of result.fieldLines ?? []) {
    const points = path.points;
    if (points.length < 3) continue;
    // The solver also traces back from negative charges. Keep each connecting arc once.
    if (!path.fromChargeId && result.charges.some(charge =>
      charge.q > 0 && Math.hypot(points[0].x - charge.x, points[0].y - charge.y) < .012)) continue;
    const start = plan(points[0]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (const point of points.slice(1)) {
      const vertex = plan(point);
      ctx.lineTo(vertex.x, vertex.y);
    }
    ctx.strokeStyle = '#f4d57e';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const middle = Math.floor(points.length * .47);
    const a = plan(points[middle]);
    const b = plan(points[middle + 1]);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
    ctx.beginPath();
    ctx.moveTo(4.8, 0);
    ctx.lineTo(-3.5, -2.9);
    ctx.lineTo(-3.5, 2.9);
    ctx.closePath();
    ctx.fillStyle = '#ffe397';
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  for (const charge of result.charges ?? []) {
    const point = plan(charge);
    const positive = charge.q > 0;
    mark(ctx, point, positive ? '#fac2aa' : '#ace7f4', 9);
    mark(ctx, point, positive ? '#a74641' : '#286d83', 7.8);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '750 17px system-ui, sans-serif';
    ctx.fillStyle = positive ? '#ffc0a0' : '#a3e6ff';
    ctx.fillText(positive ? '+' : '−', point.x, point.y);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.strokeStyle = '#5c849785';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(map.left, map.top, map.width, map.height);
}

function paintBackdrop(ctx, grid, compact, companion) {
  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, '#112638');
  background.addColorStop(.68, '#0a1827');
  background.addColorStop(1, '#08131f');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  if (!grid) {
    heading(ctx, '暂无可显示的电势数据', WIDTH / 2, compact);
    return;
  }
  if (!companion) {
    line(ctx, { x: 444, y: 16 }, { x: 444, y: 313 }, '#53758b5e');
    heading(ctx, '电势曲面示意', 227, compact);
    paintSurface(ctx, grid);
  }
  if (!companion) heading(ctx, '俯视图', 580, compact);
  paintContours(ctx, grid, compact);
}

function paintProbe(ctx, point, grid, compact, companion) {
  const surface = grid.project(point);
  const floor = grid.project(point, true);
  const map = grid.plan(point);
  if (!companion) {
    ctx.save();
    ctx.setLineDash([4, 5]);
    line(ctx, floor, surface, '#fff0b29c', 1.4);
    ctx.restore();
  }
  for (const center of companion ? [map] : [surface, map]) {
    const reach = compact ? 15 : 12;
    line(ctx, { x: center.x - reach, y: center.y }, { x: center.x + reach, y: center.y }, COLORS.probe, 1.1);
    line(ctx, { x: center.x, y: center.y - reach }, { x: center.x, y: center.y + reach }, COLORS.probe, 1.1);
    mark(ctx, center, COLORS.surface, compact ? 9 : 7.2);
    mark(ctx, center, COLORS.probe, compact ? 6.4 : 5);
  }
}

const DIRECTIONS = {
  ArrowLeft: { dx: -1, dy: 0, label: '向左移动探针', glyph: '←' },
  ArrowRight: { dx: 1, dy: 0, label: '向右移动探针', glyph: '→' },
  ArrowUp: { dx: 0, dy: 1, label: '向上移动探针', glyph: '↑' },
  ArrowDown: { dx: 0, dy: -1, label: '向下移动探针', glyph: '↓' },
};

function controlButton(parent, text, label) {
  const button = document.createElement('button');
  button.setAttribute('type', 'button');
  button.setAttribute('aria-label', label);
  button.textContent = text;
  parent.append(button);
  return button;
}

export function createTerrainView({ root, companion = false }) {
  let grid = null;
  let sourceResult = null;
  let paintedGrid;
  let paintedCompact;
  const probe = { column: null, row: null };
  const raster = document.createElement('canvas');
  const drawingWidth = companion ? PLAN_WIDTH : WIDTH;
  raster.width = drawingWidth * 2;
  raster.height = HEIGHT * 2;
  const rasterContext = raster.getContext('2d');
  rasterContext.scale(2, 2);
  const visualization = mountCanvas(root, {
    drawingWidth,
    label: companion
      ? '电势地形的俯视等势线。黄色标记和三维视图中的探针指向同一个位置。'
      : '电势地形。左边是电势曲面示意图，右边是俯视等势线。两个黄色标记指向同一个位置。',
    draw(ctx, _snapshot, { compact }) {
      if (grid !== paintedGrid || compact !== paintedCompact) {
        paintBackdrop(rasterContext, grid, compact, companion);
        paintedGrid = grid;
        paintedCompact = compact;
      }
      ctx.drawImage(raster, 0, 0, drawingWidth, HEIGHT);
      const point = currentPoint();
      if (point) paintProbe(ctx, point, grid, compact, companion);
    },
  });
  const { canvas } = visualization;

  const controls = document.createElement('div');
  controls.className = 'physics-view-controls';
  const movement = document.createElement('div');
  movement.setAttribute('role', 'group');
  movement.setAttribute('aria-label', '探针位置');
  movement.className = 'physics-terrain-movement';
  Object.assign(movement.style, { display: 'flex', flexWrap: 'wrap', gap: '3px' });
  const readings = document.createElement('output');
  readings.setAttribute('aria-live', 'polite');
  readings.setAttribute('aria-atomic', 'true');
  readings.className = 'physics-terrain-reading';
  const legend = document.createElement('p');
  legend.className = 'physics-terrain-legend';
  legend.style.margin = '0';
  legend.textContent = '红线为正等势线，蓝线为负等势线。金色箭头沿电场方向，指向电势降低的一侧。点击图面可移动探针。';
  controls.append(movement, readings, legend);
  root.append(controls);

  const buttons = Object.values(DIRECTIONS).map(direction => {
    const button = controlButton(movement, direction.glyph, direction.label);
    button.addEventListener('click', () => move(direction.dx, direction.dy));
    return button;
  });
  const reset = controlButton(movement, '重置探针', '重置探针位置');
  reset.addEventListener('click', () => {
    if (grid) changeProbe(...defaultProbe());
  });
  buttons.push(reset);

  function currentPoint() {
    return grid && probe.column !== null && probe.row !== null
      ? grid.result.terrain[probe.row * grid.size + probe.column]
      : null;
  }

  function refreshReadings() {
    const point = currentPoint();
    let text = '探针等待求解结果';
    if (point) {
      const position = `探针 (${formatter.format(point.x * 100)}, ${formatter.format(point.y * 100)}) cm`;
      const clipped = grid.result.charges?.some(charge => Math.hypot(point.x - charge.x, point.y - charge.y) <= CHARGE_REGULARIZATION_M);
      text = clipped
        ? `${position} · 点电荷附近为计算截断区，读数从略`
        : `${position} · 电势 ${formatter.format(point.phi)} V · 场强 ${formatter.format(point.eMag)} V/m`;
      window.dispatchEvent(new CustomEvent(PROBE_EVENT, { detail: { x: point.x, y: point.y } }));
    }
    if (readings.textContent !== text) readings.textContent = text;
    for (const button of buttons) button.disabled = !point;
  }

  function changeProbe(column, row) {
    if (!grid) return;
    probe.column = Math.max(0, Math.min(grid.size - 1, column));
    probe.row = Math.max(0, Math.min(grid.size - 1, row));
    refreshReadings();
    visualization.redraw();
  }

  function move(dx, dy) {
    if (currentPoint()) changeProbe(probe.column + dx, probe.row + dy);
  }

  function defaultProbe() {
    const center = Math.floor(grid.size / 2);
    const column = grid.result.charges?.length === 1 ? Math.min(grid.size - 1, center + 6) : center;
    return [column, center];
  }

  function handleKeys(event) {
    if (!grid || !Object.hasOwn(DIRECTIONS, event.key)) return;
    event.preventDefault();
    const { dx, dy } = DIRECTIONS[event.key];
    const step = event.shiftKey ? 4 : 1;
    move(dx * step, dy * step);
  }

  function handleMapClick(event) {
    if (!grid) return;
    const point = visualization.getPoint(event);
    if (!point) return;
    const { x, y } = point;
    const { left, top, width, height } = grid.map;
    if (x < left || x > left + width || y < top || y > top + height) return;
    const edge = grid.size - 1;
    changeProbe(Math.round((x - left) / width * edge), Math.round((1 - (y - top) / height) * edge));
  }

  if (canvas) {
    canvas.tabIndex = 0;
    canvas.addEventListener('click', handleMapClick);
    canvas.addEventListener('keydown', handleKeys);
  }
  movement.addEventListener('keydown', handleKeys);
  refreshReadings();

  return {
    update(snapshot) {
      if (sourceResult !== snapshot.result) {
        sourceResult = snapshot.result;
        grid = makeGrid(snapshot.result, companion);
        if (grid) {
          const [column, row] = defaultProbe();
          probe.column = Math.min(grid.size - 1, probe.column ?? column);
          probe.row = Math.min(grid.size - 1, probe.row ?? row);
        }
        refreshReadings();
      }
      visualization.update(snapshot);
    },
    destroy() {
      canvas?.removeEventListener('click', handleMapClick);
      canvas?.removeEventListener('keydown', handleKeys);
      movement.removeEventListener('keydown', handleKeys);
      visualization.destroy();
      controls.remove();
    },
  };
}
