const colors = ['#63e2ff', '#ffd37a', '#bda3ff', '#fb7185'];

export function classroomPlot(h, model) {
  if (!model?.series?.length) return null;
  return h('figure', {class: 'classroom-figure'}, [
    h('canvas', {
      width: model.compact ? 440 : 880, height: model.compact ? 238 : 300, role: 'img', 'aria-label': model.title,
      ref: canvas => { if (canvas) draw(canvas, model); },
    }),
    h('figcaption', null, model.title),
    h('div', {class: 'classroom-legend'}, model.series.map((series,index) =>
      h('span', {style: {color: colors[index % colors.length]}}, series.label))),
  ]);
}

function bounds(values) {
  const lower = Math.min(...values);
  const upper = Math.max(...values);
  return lower === upper ? [lower - 1, upper + 1] : [lower, upper];
}

export function draw(canvas, model) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const {width, height} = canvas;
  const safe = model.series.map(series => ({...series, points: series.points.map(point =>
    point && point.every(Number.isFinite) ? point : null)}));
  const all = safe.flatMap(series => series.points.filter(Boolean));
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#08131e';
  ctx.fillRect(0, 0, width, height);
  if (!all.length) return;
  const margin = {left: 78, right: 25, top: 32, bottom: 54};
  let [minX, maxX] = model.xBounds ?? bounds(all.map(point => point[0]));
  const [minY, maxY] = model.yBounds ?? bounds(all.map(point => point[1]));
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  if (model.equalScale) {
    const center = (minX + maxX) / 2;
    const halfWidth = (maxY - minY) * plotW / (2 * plotH);
    minX = center - halfWidth;
    maxX = center + halfWidth;
  }
  const X = value => margin.left + (value - minX) / (maxX - minX) * plotW;
  const Y = value => margin.top + (maxY - value) / (maxY - minY) * plotH;
  const rateLabel = value => value === 0 ? '0' : Math.abs(value) >= 1e4 || Math.abs(value) < 0.001
    ? value.toExponential(2) : Number(value.toPrecision(3)).toString();
  ctx.font = '14px system-ui';
  ctx.strokeStyle = '#23384c';
  ctx.fillStyle = '#adc2d4';
  for (let index = 0; index <= 5; index += 1) {
    const xx = minX + (maxX - minX) * index / 5;
    const yy = minY + (maxY - minY) * index / 5;
    ctx.beginPath();
    ctx.moveTo(X(xx), margin.top);
    ctx.lineTo(X(xx), height - margin.bottom);
    ctx.moveTo(margin.left, Y(yy));
    ctx.lineTo(width - margin.right, Y(yy));
    ctx.stroke();
    ctx.fillText(rateLabel(xx), X(xx) - 12, height - margin.bottom + 22);
    ctx.fillText(rateLabel(yy), 8, Y(yy) + 4);
  }
  ctx.fillText(model.yLabel ?? '', margin.left, 21);
  ctx.fillText(model.xLabel ?? '', width - margin.right - 120, height - 9);
  ctx.save();
  ctx.beginPath();
  ctx.rect(margin.left - 1, margin.top - 1, plotW + 2, plotH + 2);
  ctx.clip();
  safe.forEach((series, index) => {
    ctx.strokeStyle = colors[index % colors.length];
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = series.stroke ?? 2.5;
    ctx.setLineDash(series.dashed ? [7, 4] : []);
    if (!series.dots) {
      ctx.beginPath();
      let connected = false;
      for (const point of series.points) {
        if (!point) {connected = false; continue;}
        if (connected) ctx.lineTo(X(point[0]), Y(point[1]));
        else ctx.moveTo(X(point[0]), Y(point[1]));
        connected = true;
      }
      ctx.stroke();
    }
    if (series.dots) for (const point of series.points.filter(Boolean)) {
      ctx.beginPath();
      ctx.arc(X(point[0]), Y(point[1]), 4.5, 0, 2 * Math.PI);
      ctx.fill();
    }
    if (series.arrow && series.points.length >= 2) {
      const [start, tip] = series.points.slice(-2);
      const xx = X(tip[0]), yy = Y(tip[1]);
      const angle = Math.atan2(yy-Y(start[1]),xx-X(start[0]));
      ctx.beginPath();
      ctx.moveTo(xx,yy);
      ctx.lineTo(xx-12*Math.cos(angle-0.45),yy-12*Math.sin(angle-0.45));
      ctx.lineTo(xx-12*Math.cos(angle+0.45),yy-12*Math.sin(angle+0.45));
      ctx.closePath();
      ctx.fill();
    }
  });
  if (Number.isFinite(model.cursor)) {
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle='#f5f7fa';
    ctx.beginPath();
    ctx.moveTo(X(model.cursor), margin.top);
    ctx.lineTo(X(model.cursor), height-margin.bottom);
    ctx.stroke();
  }
  ctx.restore();
}

export function fitLine(points) {
  const n = points.length;
  if (n < 2) return null;
  const sums = points.reduce(([x,y,xx,xy],[a,b])=>[x+a,y+b,xx+a*a,xy+a*b],[0,0,0,0]);
  const [x,y,xx,xy]=sums;
  const divisor=n*xx-x*x;
  if (Math.abs(divisor) <= 1e-12) return null;
  const slope=(n*xy-x*y)/divisor;
  return {slope,intercept:(y-slope*x)/n};
}

export function nearest(rows, time, key = 't') {
  if (!rows?.length) return null;
  let left = 0;
  let right = rows.length-1;
  while(left<right){
    const middle=(left+right)>>1;
    if(rows[middle][key]<time)left=middle+1;
    else right=middle;
  }
  return left && Math.abs(rows[left-1][key]-time)<Math.abs(rows[left][key]-time) ? rows[left-1] : rows[left];
}
