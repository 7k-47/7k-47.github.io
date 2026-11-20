import { mountCanvas } from './canvas.js';

const cases = [
  { title: '低于临界', shortTitle: '低于', ratio: 0.85, color: '#ffae92', rgb: '255, 174, 146' },
  { title: '恰好通过', shortTitle: '临界', ratio: 1, color: '#9bf4dc', rgb: '155, 244, 220' },
  { title: '高于临界', shortTitle: '高于', ratio: 1.15, color: '#a9c4ff', rgb: '169, 196, 255' },
];
export const defaultForceLimits = { min: 0, max: 30, step: 0.5, precision: 1 };
const epsilon = 1e-6;
const format = (value, places = 2) => Number(value.toFixed(places)).toString();
const tint = (entry, alpha) => `rgba(${entry.rgb}, ${alpha})`;

export function forceOptions(parameters, criticalForce, limits, solve) {
  const rounded = (value) => Number(value.toFixed(limits.precision));
  const settings = [];
  for (let index = 0; index <= Math.floor((limits.max - limits.min) / limits.step + epsilon); index++) {
    settings.push(rounded(limits.min + index * limits.step));
  }

  return cases.map((entry) => {
    const target = entry.ratio * criticalForce;
    const critical = entry.ratio === 1;
    const available = settings.filter((force) => {
      if (critical) return Math.abs(force - target) <= epsilon;
      if (entry.ratio < 1) return force < criticalForce - epsilon;
      return force > criticalForce + epsilon;
    });
    const appliedForce = available.reduce((best, value) => {
      if (best === null || Math.abs(value - target) < Math.abs(best - target)) return value;
      return best;
    }, null);
    const force = appliedForce ?? target;
    const withinRange = force >= limits.min - epsilon && force <= limits.max + epsilon;
    return {
      ...entry,
      force,
      appliedForce,
      result: withinRange && (critical || appliedForce !== null)
        ? solve({ ...parameters, initialSpeed: 0, appliedForce: force })
        : null,
    };
  });
}

export function endOnTrack(result) {
  if (!result) return null;
  if (result.speedAtM <= epsilon) return { angle: null, summary: '静止在 L' };
  const leaves = result.leaveAngleDeg != null && result.leaveAngleDeg < 180 - 1e-4;
  if (leaves) return { angle: result.leaveAngleDeg, summary: `${format(result.leaveAngleDeg, 1)}° 脱轨` };
  if (!result.reachesTop) return { angle: result.maxAngleDeg, summary: `到达 ${format(result.maxAngleDeg, 1)}°` };
  return { angle: 180, speed: result.pointQ.speed, normal: Math.max(0, result.pointQ.normalForce) };
}

function segment(ctx, points, stroke, lineWidth = 1) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function marker(ctx, x, y, radius, fill, stroke) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function label(ctx, value, x, y, size, color, bold = false) {
  ctx.font = `${bold ? 600 : 400} ${size}px system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(value, x, y);
}

function drawPanel(ctx, entry, index, active, compact) {
  const left = 16 + index * 231;
  const panelWidth = 226;
  const center = left + 117;
  const middle = 169;
  const radius = 72;
  const top = middle - radius;
  const bottom = middle + radius;
  const pointAt = (angle) => [
    center + radius * Math.sin(angle * Math.PI / 180),
    middle + radius * Math.cos(angle * Math.PI / 180),
  ];
  const railTo = (angle) => Array.from({ length: 61 }, (_, step) => pointAt(angle * step / 60));
  const outcome = endOnTrack(entry.result);

  const background = ctx.createLinearGradient(left, 5, left + panelWidth, 334);
  background.addColorStop(0, tint(entry, active ? 0.16 : 0.08));
  background.addColorStop(1, tint(entry, 0.025));
  ctx.beginPath();
  ctx.roundRect(left, 7, panelWidth, 326, 14);
  ctx.fillStyle = background;
  ctx.fill();
  ctx.strokeStyle = tint(entry, active ? 0.75 : 0.2);
  ctx.lineWidth = active ? 1.7 : 1;
  ctx.stroke();

  label(ctx, compact ? entry.shortTitle : entry.title, left + panelWidth / 2, 38, compact ? 29 : 25, entry.color, true);
  label(ctx, `F ${format(entry.force, 3)} N`, left + panelWidth / 2, 67, compact ? 23 : 19, '#e2edf5');

  ctx.save();
  ctx.setLineDash([4, 6]);
  segment(ctx, [[left + 44, top], [center, top], [center, bottom]], '#a2b8d755');
  ctx.restore();
  for (let i = 0; i < 6; i++) {
    const x = left + 44 + i * 28;
    segment(ctx, [[x, bottom + 7], [x - 22, bottom + 19]], '#b4cde32c');
  }
  segment(ctx, [[left + 20, bottom + 19], [left + 204, bottom + 19]], '#b4cde32c');
  segment(ctx, [[left + 30, bottom], ...railTo(180)], '#6e98b14a', 8);
  segment(ctx, [[left + 30, bottom], ...railTo(180)], '#99bee16e', 2);
  marker(ctx, center, top, 4, '#9fb4c5');
  if (!compact) {
    label(ctx, 'L', left + 30, bottom - 12, 16, '#b3c8db');
    label(ctx, 'M', center, bottom - 13, 16, '#b3c8db');
    label(ctx, 'Q', center - 12, top - 8, 18, '#d5e7f7', true);
  }
  if (outcome) {
    if (outcome.angle !== null) {
      const trail = [[left + 30, bottom], ...railTo(outcome.angle)];
      segment(ctx, trail, tint(entry, 0.22), 11);
      segment(ctx, trail, entry.color, 3);
    }
    const [x, y] = outcome.angle === null ? [left + 30, bottom] : pointAt(outcome.angle);
    marker(ctx, x, y, 15, tint(entry, 0.16));
    marker(ctx, x, y, 7, entry.color, '#f2faff');
    if (!outcome.summary) {
      segment(ctx, [[x - 12, y], [x - 42, y], [x - 36, y - 5]], entry.color, 1.5);
      segment(ctx, [[x - 42, y], [x - 36, y + 5]], entry.color, 1.5);
    }
  }

  const bottomLine = outcome?.summary ?? (outcome ? `vQ ${format(outcome.speed)} m/s` : '超出范围');
  const detail = outcome && !outcome.summary
    ? `NQ ${format(outcome.normal)} N`
    : outcome ? '未贴轨到达 Q' : '当前条件不可用';
  label(ctx, bottomLine, left + panelWidth / 2, 283, compact ? 22 : 19, entry.color, true);
  if (!compact || outcome && !outcome.summary) {
    label(ctx, detail, left + panelWidth / 2, 311, compact ? 22 : 17, '#adc5d9');
  }
}

export function createTrackView({ root, solve, setParameters, controlsOnly = false }) {
  let entries = [];
  let recentKey;
  let lastStatus;
  let currentResult;
  let currentIndex = -1;
  let locked = false;
  const canvas = controlsOnly ? null : mountCanvas(root, {
    label: '相同半径的三条轨道比较恒力低于、等于与高于临界值时的结果',
    draw(ctx, snapshot, { compact }) {
      entries.forEach((entry, index) => drawPanel(ctx, entry, index, currentIndex === index, compact));
    },
  });
  const controls = document.createElement('div');
  controls.className = 'physics-view-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', '半圆轨道临界条件对照');
  const status = document.createElement('span');
  status.setAttribute('aria-live', 'polite');
  const buttons = cases.map((entry, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = entry.title;
    button.disabled = true;
    if (controlsOnly) {
      button.style.borderInlineStartColor = entry.color;
      button.style.borderInlineStartWidth = '3px';
    }
    button.addEventListener('click', () => {
      const appliedForce = entries[index]?.appliedForce;
      if (appliedForce != null && !locked) setParameters({ initialSpeed: 0, appliedForce });
    });
    controls.append(button);
    return button;
  });
  controls.append(status);
  root.append(controls);

  function update(snapshot) {
    const { result, parameters, runStatus } = snapshot;
    if (!result || !Number.isFinite(result.requiredForce)) return;
    if (result === currentResult && runStatus === lastStatus) return;
    currentResult = result;
    lastStatus = runStatus;
    const definition = snapshot.paramDefs?.find((param) => param.key === 'appliedForce');
    const limits = definition?.step > 0 ? definition : defaultForceLimits;
    const key = [result.requiredForce, result.radius, result.g, result.massKg, result.horizontalLength,
      limits.min, limits.max, limits.step, limits.precision].join('/');
    if (key !== recentKey) {
      entries = forceOptions(parameters, result.requiredForce, limits, solve);
      recentKey = key;
    }
    locked = runStatus === 'running' || runStatus === 'paused';
    currentIndex = entries.findIndex((entry) =>
      entry.appliedForce !== null && Math.abs(entry.appliedForce - result.appliedForce) <= epsilon &&
      Math.abs(result.initialSpeed) <= epsilon,
    );
    buttons.forEach((button, index) => {
      const entry = entries[index];
      const selected = currentIndex === index;
      const end = endOnTrack(entry.result);
      button.disabled = locked || entry.appliedForce === null || selected;
      button.setAttribute('aria-pressed', String(selected));
      const action = selected ? '当前实验' : entry.appliedForce === null
        ? (entry.result ? '临界值不在输入刻度上' : `${entry.title}不可用`)
        : `应用 ${format(entry.appliedForce)} N`;
      const detail = end?.summary ?? (end ? `Q 点速度 ${format(end.speed)} m/s，支持力 ${format(end.normal)} N` : '超出可设范围');
      if (controlsOnly) {
        const heading = document.createElement('strong');
        heading.textContent = `${entry.shortTitle} · ${format(entry.force, 3)} N`;
        const value = document.createElement('span');
        value.style.display = 'block';
        value.textContent = end?.summary ?? (end ? `${format(end.speed)} m/s · ${format(end.normal)} N` : '超出可设范围');
        button.replaceChildren(heading, value);
        button.style.opacity = selected ? '1' : '';
        button.title = `${action}，${detail}`;
      } else {
        button.textContent = selected ? `当前 · ${entry.title}` : action;
      }
      button.setAttribute('aria-label', `${entry.title}，${action}，${detail}`);
    });
    const current = endOnTrack(result);
    const outcome = current.summary ?? `Q 点 ${format(current.speed)} m/s，支持力 ${format(current.normal)} N`;
    const playing = locked ? '。结束当前运行后可应用对照条件' : '';
    status.textContent = `对照固定初速度为 0。当前实验 F ${format(result.appliedForce)} N，v₀ ${format(result.initialSpeed)} m/s，${outcome}${playing}。`;
    canvas?.update(snapshot);
  }

  return {
    update,
    destroy() {
      canvas?.destroy();
      controls.remove();
    },
  };
}
