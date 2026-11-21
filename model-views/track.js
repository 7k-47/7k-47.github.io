const forces = [
  { key: 'gravity', label: '重力', color: '#ffbc69' },
  { key: 'normal', label: '支持力', color: '#66dce7' },
  { key: 'drive', label: '水平推力', color: '#80d7a4' },
  { key: 'net', label: '合力', color: '#bb9bff' },
];
export const trackForceColors = Object.fromEntries(forces.map(({ key, color }) => [key, color]));
const phases = { launch: '水平段', loop: '圆轨道', return: '沿轨返回', airborne: '离轨抛体', stationary: '静止' };

function direction([x, y]) {
  const degrees = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  const labels = ['向右', '右上', '向上', '左上', '向左', '左下', '向下', '右下'];
  return `${labels[Math.round(degrees / 45) % labels.length]} ${Math.round(degrees) % 360}°`;
}

function element(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text != null) result.textContent = text;
  return result;
}

export function createTrackView({ root, seek }) {
  const panel = element('div', 'track-companion');
  const readings = element('dl', 'track-readings');
  const fields = ['阶段', '时间', '速率', '轨道角度'].map(label => {
    const pair = element('div');
    const value = element('dd');
    pair.append(element('dt', '', label), value);
    readings.append(pair);
    return value;
  });

  const forceList = element('ul', 'track-forces');
  const values = forces.map(force => {
    const row = element('li', 'track-force');
    const swatch = element('span', 'track-force-legend');
    swatch.style.background = force.color;
    swatch.setAttribute('aria-hidden', 'true');
    const value = element('strong');
    const orientation = element('span', 'track-force-direction');
    row.append(swatch, element('span', '', force.label), value, orientation);
    forceList.append(row);
    return { value, orientation };
  });
  const basis = element('p', 'track-basis', '方向角以轨道平面向右为 0°，逆时针为正。');

  const timeline = element('div', 'track-timeline physics-view-controls');
  const label = element('label', '', '查看任一时刻');
  const range = element('input');
  range.type = 'range';
  range.min = '0';
  range.step = 'any';
  label.append(range);
  const back = element('button', '', '−0.05 s');
  const forward = element('button', '', '+0.05 s');
  back.type = forward.type = 'button';
  back.setAttribute('aria-label', '后退 0.05 秒');
  forward.setAttribute('aria-label', '前进 0.05 秒');
  timeline.append(label, back, forward);
  panel.append(readings, forceList, basis, timeline);
  root.append(panel);

  let duration = 0;
  let time = 0;
  function inspect(next) {
    if (Number.isFinite(next) && duration > 0) seek(Math.min(duration, Math.max(0, next)));
  }
  range.addEventListener('input', () => inspect(Number(range.value)));
  back.addEventListener('click', () => inspect(time - .05));
  forward.addEventListener('click', () => inspect(time + .05));

  return {
    update(snapshot) {
      const state = snapshot.motion;
      if (!state) return;
      duration = snapshot.result.duration;
      time = state.time;
      fields[0].textContent = phases[state.phase];
      fields[1].textContent = `${time.toFixed(3)} s`;
      fields[2].textContent = `${state.speed.toFixed(2)} m/s`;
      fields[3].textContent = state.angleDeg == null ? '—' : `${state.angleDeg.toFixed(1)}°`;
      forces.forEach(({ key }, index) => {
        const magnitude = Math.hypot(...state[key]);
        values[index].value.textContent = `${magnitude.toFixed(2)} N`;
        values[index].orientation.textContent = magnitude >= .005 ? direction(state[key]) : '—';
      });
      range.max = String(duration);
      range.value = String(time);
      range.setAttribute('aria-valuetext', `${time.toFixed(3)} 秒，共 ${duration.toFixed(3)} 秒`);
      range.disabled = duration <= 0;
      back.disabled = time <= 0;
      forward.disabled = time >= duration;
    },
    destroy() { panel.remove(); },
  };
}
