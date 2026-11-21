const PROBE_EVENT = 'physics-terrain-probe';
const REFERENCE_CHARGE_C = 2e-6;
const SURFACE_HEIGHT = .34;
const SURFACE_LIFT = .002;
const CONTOUR_LEVELS = [-.72, -.43, -.22, -.09, 0, .09, .22, .43, .72];
const PROBE_COLOR = 0xe5cc91;

function getTerrain(result) {
  if (!result?.terrain?.length || !result.bounds) return null;
  const size = Math.sqrt(result.terrain.length);
  const { xMin, xMax, yMin, yMax } = result.bounds;
  const width = xMax - xMin;
  const depth = yMax - yMin;
  if (!Number.isInteger(size) || size < 2 || width <= 0 || depth <= 0) return null;
  const charge = Math.abs(result.charges?.[0]?.q ?? REFERENCE_CHARGE_C) || REFERENCE_CHARGE_C;
  const maximum = Math.max(Math.abs(result.phiRange?.min ?? 0), Math.abs(result.phiRange?.max ?? 0));
  const reference = Math.max(1, maximum * REFERENCE_CHARGE_C / charge);
  const aspectScale = Math.max(width, depth);
  const point = (column, row) => result.terrain[row * size + column];
  const strength = phi => Math.tanh(phi / reference);
  const project = ({ x, y, phi }, lift = 0) => [
    (x - xMin - width / 2) / aspectScale,
    strength(phi) * SURFACE_HEIGHT + lift,
    (y - yMin - depth / 2) / aspectScale,
  ];
  const nearest = ({ x, y }) => {
    const edge = size - 1;
    const column = Math.max(0, Math.min(edge, Math.round((x - xMin) / width * edge)));
    const row = Math.max(0, Math.min(edge, Math.round((y - yMin) / depth * edge)));
    return point(column, row);
  };
  const sample = ({ x, y }) => {
    const edge = size - 1;
    const column = Math.max(0, Math.min(edge, (x - xMin) / width * edge));
    const row = Math.max(0, Math.min(edge, (y - yMin) / depth * edge));
    const left = Math.floor(column);
    const bottom = Math.floor(row);
    const right = Math.min(edge, left + 1);
    const top = Math.min(edge, bottom + 1);
    const u = column - left;
    const v = row - bottom;
    const bottomPhi = point(left, bottom).phi * (1 - u) + point(right, bottom).phi * u;
    const topPhi = point(left, top).phi * (1 - u) + point(right, top).phi * u;
    return { x, y, phi: bottomPhi * (1 - v) + topPhi * v };
  };
  const contains = ({ x, y }) => x >= xMin && x <= xMax && y >= yMin && y <= yMax;
  const center = Math.floor(size / 2);
  const defaultPoint = point(result.charges?.length === 1 ? Math.min(size - 1, center + 6) : center, center);
  return { result, size, reference, point, project, strength, nearest, sample, contains, defaultPoint };
}

function disposeObjects(group) {
  const geometries = new Set();
  const materials = new Set();
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  group.clear();
}

function segments(three, positions, options, colors) {
  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
  if (colors) geometry.setAttribute('color', new three.Float32BufferAttribute(colors, 3));
  const material = new three.LineBasicMaterial({ toneMapped: false, ...options, vertexColors: Boolean(colors) });
  return new three.LineSegments(geometry, material);
}

function addSurface(three, group, terrain) {
  const { result, size, point, project, strength } = terrain;
  const positions = [];
  const colors = [];
  const indices = [];
  const neutral = new three.Color(0x475b64);
  const positive = new three.Color(0xb19077);
  const negative = new three.Color(0x41798f);
  const color = new three.Color();
  for (const sample of result.terrain) {
    const signed = strength(sample.phi);
    positions.push(...project(sample));
    color.copy(neutral).lerp(signed < 0 ? negative : positive, Math.abs(signed));
    colors.push(color.r, color.g, color.b);
  }
  for (let row = 0; row < size - 1; row++) {
    for (let column = 0; column < size - 1; column++) {
      const first = row * size + column;
      indices.push(first, first + size, first + 1, first + 1, first + size, first + size + 1);
    }
  }
  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new three.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const surface = new three.Mesh(geometry, new three.MeshStandardMaterial({
    vertexColors: true,
    metalness: .15,
    roughness: .74,
    side: three.DoubleSide,
  }));
  surface.name = 'potential-signed-mesh';
  group.add(surface);

  const wire = [];
  const wireColors = [];
  const addVertex = sample => {
    wire.push(...project(sample, SURFACE_LIFT));
    const signed = strength(sample.phi);
    color.copy(neutral).lerp(signed < 0 ? negative : positive, .25 + .75 * Math.abs(signed));
    wireColors.push(color.r, color.g, color.b);
  };
  for (let axis = 0; axis < size; axis += 4) {
    for (let index = 0; index < size - 1; index++) {
      addVertex(point(axis, index));
      addVertex(point(axis, index + 1));
      addVertex(point(index, axis));
      addVertex(point(index + 1, axis));
    }
  }
  group.add(segments(three, wire, { transparent: true, opacity: .20, depthWrite: false }, wireColors));
}

function contourPoint(first, second, phi) {
  const portion = (phi - first.phi) / (second.phi - first.phi);
  return { x: first.x + (second.x - first.x) * portion, y: first.y + (second.y - first.y) * portion, phi };
}

function addContours(three, group, terrain) {
  const { point, project, size, reference } = terrain;
  for (const level of CONTOUR_LEVELS) {
    const phi = level * reference;
    const positions = [];
    for (let row = 0; row < size - 1; row++) {
      for (let column = 0; column < size - 1; column++) {
        const corners = [point(column, row), point(column + 1, row), point(column + 1, row + 1), point(column, row + 1)];
        const crossings = [];
        corners.forEach((first, index) => {
          const second = corners[(index + 1) % 4];
          if ((first.phi < phi) !== (second.phi < phi)) crossings.push(contourPoint(first, second, phi));
        });
        if (crossings.length === 4) {
          const mean = corners.reduce((sum, value) => sum + value.phi, 0) / 4;
          if ((mean < phi) !== (corners[0].phi < phi)) crossings.push(crossings.shift());
        }
        for (const crossing of crossings) positions.push(...project(crossing, level === 0 ? .005 : .0035));
      }
    }
    if (!positions.length) continue;
    const line = segments(three, positions, {
      color: level === 0 ? 0xd3dbd7 : level > 0 ? 0xc6ae98 : 0x9cbdcc,
      transparent: true,
      opacity: level === 0 ? .82 : .35,
      depthWrite: false,
    });
    if (level === 0) line.name = 'potential-zero-contour';
    group.add(line);
  }
}

function addFieldLines(three, group, terrain) {
  const positions = [];
  for (const { points } of terrain.result.fieldLines ?? []) {
    for (let index = 1; index < points.length; index++) {
      const first = points[index - 1];
      const second = points[index];
      if (!terrain.contains(first) || !terrain.contains(second)) continue;
      positions.push(...terrain.project(terrain.sample(first), .014), ...terrain.project(terrain.sample(second), .014));
    }
  }
  if (positions.length) group.add(segments(three, positions, { color: 0x8aafa9, transparent: true, opacity: .14, depthWrite: false }));
}

function addCharges(three, group, terrain) {
  for (const charge of terrain.result.charges ?? []) {
    const [x, y, z] = terrain.project(terrain.sample(charge), .013);
    const color = charge.q < 0 ? 0x719ba9 : 0xbd9b80;
    const pin = new three.Mesh(new three.SphereGeometry(.012, 18, 12), new three.MeshStandardMaterial({
      color, metalness: .40, roughness: .42,
    }));
    pin.position.set(x, y, z);
    group.add(pin);
  }
}

function addParticleTrack(three, group, terrain) {
  const positions = [];
  const points = terrain.result.particleTrack ?? [];
  for (let index = 1; index < points.length; index++) {
    const first = points[index - 1];
    const second = points[index];
    if (terrain.contains(first) && terrain.contains(second)) {
      positions.push(...terrain.project(terrain.sample(first), .021), ...terrain.project(terrain.sample(second), .021));
    }
  }
  if (positions.length) group.add(segments(three, positions, { color: 0xf6f0a3, transparent: true, opacity: .58, depthWrite: false }));
}

function makeProbe(three, group) {
  const geometry = new three.SphereGeometry(.011, 20, 14);
  const material = new three.MeshBasicMaterial({ color: PROBE_COLOR, toneMapped: false });
  const pin = new three.Mesh(geometry, material);
  const cross = segments(three, new Float32Array(18), { color: PROBE_COLOR, transparent: true, opacity: .88, depthWrite: false });
  cross.frustumCulled = false;
  group.add(cross, pin);

  return (terrain, location) => {
    group.visible = Boolean(terrain && location);
    if (!group.visible) return;
    const [x, height, z] = terrain.project(location);
    const y = height + .021;
    const spread = .034;
    pin.position.set(x, y, z);
    const points = cross.geometry.getAttribute('position');
    points.setXYZ(0, x - spread, y, z);
    points.setXYZ(1, x + spread, y, z);
    points.setXYZ(2, x, y, z - spread);
    points.setXYZ(3, x, y, z + spread);
    points.setXYZ(4, x, .002, z);
    points.setXYZ(5, x, y, z);
    points.needsUpdate = true;
  };
}

export function mountTerrainThree({ scene, three, model }) {
  const root = new three.Group();
  const surfaces = new three.Group();
  const probe = new three.Group();
  root.name = 'physics-enhanced-potential-terrain';
  probe.name = 'potential-live-probe';
  root.add(surfaces, probe);
  scene.add(root);
  const stageRing = scene.getObjectByName('stage-ring');
  const stageRingVisible = stageRing?.visible;
  if (stageRing) stageRing.visible = false;
  const floorGrid = scene.children.find(object => object.type === 'GridHelper');
  const floorHeight = floorGrid?.position.y;
  const gridOpacity = floorGrid?.material.opacity;
  if (floorGrid) {
    floorGrid.position.y = -.375;
    floorGrid.material.opacity = .28;
  }
  const nativeVisibility = model?.group?.visible;
  const paintProbe = makeProbe(three, probe);
  paintProbe(null, null);
  let terrain;
  let priorResult;
  let location;

  function selectProbe(event) {
    const candidate = event.detail;
    if (!candidate || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return;
    location = candidate;
    paintProbe(terrain, terrain?.nearest(location));
  }

  window.addEventListener(PROBE_EVENT, selectProbe);
  return {
    update(snapshot) {
      if (snapshot.result === priorResult) return;
      priorResult = snapshot.result;
      terrain = getTerrain(priorResult);
      disposeObjects(surfaces);
      if (model?.group) model.group.visible = !terrain && nativeVisibility;
      if (terrain) {
        addSurface(three, surfaces, terrain);
        addContours(three, surfaces, terrain);
        addFieldLines(three, surfaces, terrain);
        addCharges(three, surfaces, terrain);
        addParticleTrack(three, surfaces, terrain);
      }
      paintProbe(terrain, location ? terrain?.nearest(location) : terrain?.defaultPoint);
    },
    frame(stage) {
      stage.setView([.81, .75, 1.12], [0, .012, 0]);
    },
    destroy() {
      if (stageRing) stageRing.visible = stageRingVisible;
      if (floorGrid) floorGrid.position.y = floorHeight;
      if (floorGrid) floorGrid.material.opacity = gridOpacity;
      window.removeEventListener(PROBE_EVENT, selectProbe);
      disposeObjects(root);
      scene.remove(root);
      if (model?.group) model.group.visible = nativeVisibility;
    },
  };
}
