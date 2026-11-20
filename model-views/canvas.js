const DRAWING_WIDTH = 720;
const DRAWING_HEIGHT = 340;

function fit(width, height) {
  const scale = Math.min(width / DRAWING_WIDTH, height / DRAWING_HEIGHT);
  return {
    scale,
    x: (width - DRAWING_WIDTH * scale) / 2,
    y: (height - DRAWING_HEIGHT * scale) / 2,
  };
}

export function mountCanvas(root, { label, draw }) {
  const viewport = document.createElement('div');
  viewport.className = 'physics-view-viewport';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  canvas.textContent = label;
  viewport.append(canvas);
  root.append(viewport);

  const context = canvas.getContext('2d');
  if (!context) {
    viewport.remove();
    throw new Error('二维画布不可用');
  }

  let snapshot;
  let animation = 0;

  function paint() {
    animation = 0;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!snapshot || !width || !height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const background = context.createRadialGradient(width * 0.5, height * 0.3, 8, width * 0.5, height * 0.3, Math.max(width, height) * 0.66);
    background.addColorStop(0, '#142c3d');
    background.addColorStop(1, '#091521');
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    const frame = fit(width, height);
    context.save();
    try {
      context.translate(frame.x, frame.y);
      context.scale(frame.scale, frame.scale);
      context.beginPath();
      context.rect(0, 0, DRAWING_WIDTH, DRAWING_HEIGHT);
      context.clip();
      context.lineCap = 'round';
      context.lineJoin = 'round';
      draw(context, snapshot, { width: DRAWING_WIDTH, height: DRAWING_HEIGHT, compact: width < 475 });
    } finally {
      context.restore();
    }
  }

  function redraw() {
    if (!animation) animation = requestAnimationFrame(paint);
  }

  const observer = new ResizeObserver(redraw);
  observer.observe(viewport);

  return {
    canvas,
    update(nextSnapshot) {
      snapshot = nextSnapshot;
      redraw();
    },
    redraw,
    getPoint(event) {
      const rect = canvas.getBoundingClientRect();
      const frame = fit(rect.width, rect.height);
      if (!frame.scale) return null;
      const x = (event.clientX - rect.left - frame.x) / frame.scale;
      const y = (event.clientY - rect.top - frame.y) / frame.scale;
      if (x < 0 || x > DRAWING_WIDTH || y < 0 || y > DRAWING_HEIGHT) return null;
      return { x, y };
    },
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(animation);
      viewport.remove();
    },
  };
}
