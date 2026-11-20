import { defaultForceLimits, endOnTrack, forceOptions } from './track.js';

// Match the coordinate scale of the existing semicircle scene.
const WORLD_UNITS_PER_METRE = 0.36;
const RAIL_LIFT = 0.004;
const MATCH_TOLERANCE = 1e-6;

function disposeObjects(group) {
  const geometries = new Set();
  const materials = new Set();
  group.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) materials.add(object.material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  group.clear();
}

export function mountTrackThree({ scene, three, model }, solve) {
  const { Group, Mesh, MeshStandardMaterial, MeshBasicMaterial, TubeGeometry, SphereGeometry,
    Vector3, CatmullRomCurve3, BoxGeometry } = three;
  const comparison = new Group();
  comparison.name = 'Semicircular track force comparisons';
  scene.add(comparison);
  const originalDepth = model.group.position.z;
  const originalAnchors = model.anchors;
  model.anchors = function () {
    return originalAnchors.call(this).map((anchor) => ({
      ...anchor,
      position: anchor.position.clone().add(this.group.position),
    }));
  };
  let dimensions;
  let lanes = [];
  let signature;
  let activeLane = -1;

  function rail(points, material, radius) {
    return new Mesh(new TubeGeometry(new CatmullRomCurve3(points), Math.max(12, points.length), radius, 8, false), material);
  }

  function createLane(entry, depth) {
    const { length, radius } = dimensions;
    const group = new Group();
    group.name = entry.title;
    group.position.z = depth;
    comparison.add(group);

    const structure = new MeshStandardMaterial({ color: '#456478', roughness: 0.37, metalness: 0.44 });
    const deckMaterial = new MeshStandardMaterial({ color: '#182c3d', roughness: 0.76, metalness: 0.16 });
    const deck = new Mesh(new BoxGeometry(length + radius + 0.2, 0.026, 0.27), deckMaterial);
    deck.position.set((radius - length) / 2, -0.025, 0);
    deck.receiveShadow = true;
    group.add(deck);

    const start = new Vector3(-length, RAIL_LIFT, 0);
    const onArc = (angle) => {
      const theta = angle * Math.PI / 180;
      return new Vector3(radius * Math.sin(theta), RAIL_LIFT + radius * (1 - Math.cos(theta)), 0);
    };
    const pathTo = (angle) => {
      const points = [start];
      if (angle === 0) return [...points, onArc(0)];
      const segments = Math.max(2, Math.ceil(angle / 3));
      for (let index = 0; index <= segments; index++) points.push(onArc(angle * index / segments));
      return points;
    };
    group.add(rail(pathTo(180), structure, 0.014));

    const outcome = endOnTrack(entry.result);
    if (!outcome) return { group, entry, marker: null };
    const route = new MeshBasicMaterial({ color: entry.color });
    if (outcome.angle !== null) {
      const illuminated = pathTo(outcome.angle).map((point) => point.clone().setY(point.y + 0.01));
      group.add(rail(illuminated, route, 0.01));
    }
    const endpoint = outcome.angle === null ? start.clone() : onArc(outcome.angle);
    endpoint.y += 0.04;
    const marker = new Mesh(new SphereGeometry(0.027, 16, 12), route);
    marker.position.copy(endpoint);
    group.add(marker);
    const halo = new Mesh(new SphereGeometry(0.044, 16, 12), new MeshBasicMaterial({
      color: entry.color, transparent: true, opacity: 0.22, depthWrite: false,
    }));
    halo.position.copy(endpoint);
    group.add(halo);

    if (outcome.angle < 180) {
      const top = new Mesh(new SphereGeometry(0.016, 12, 8), structure);
      top.position.copy(onArc(180));
      group.add(top);
    }
    return { group, entry, marker, halo };
  }

  function update(snapshot) {
    const result = snapshot.result;
    if (!result || !Number.isFinite(result.requiredForce)) return;
    const definition = snapshot.paramDefs?.find((item) => item.key === 'appliedForce');
    const limits = definition?.step > 0 ? definition : defaultForceLimits;
    const key = [result.requiredForce, result.radius, result.g, result.massKg, result.horizontalLength,
      limits.min, limits.max, limits.step, limits.precision].join('/');
    if (key !== signature) {
      signature = key;
      const length = result.horizontalLength * WORLD_UNITS_PER_METRE;
      const radius = result.radius * WORLD_UNITS_PER_METRE;
      const spacing = Math.max(0.72, Math.min(1.75, (length + radius) * 0.5));
      dimensions = { length, radius, spacing };
      disposeObjects(comparison);
      const depths = [spacing, 0, -spacing];
      lanes = forceOptions(snapshot.parameters, result.requiredForce, limits, solve)
        .map((entry, index) => createLane(entry, originalDepth + depths[index]));
    }

    activeLane = lanes.findIndex(({ entry }) => entry.appliedForce != null &&
      Math.abs(entry.appliedForce - result.appliedForce) <= MATCH_TOLERANCE &&
      Math.abs(result.initialSpeed) <= MATCH_TOLERANCE);
    model.group.position.z = activeLane < 0
      ? originalDepth - dimensions.spacing * 2
      : lanes[activeLane].group.position.z;
    const showResultMarker = snapshot.runStatus === 'idle';
    lanes.forEach(({ marker, halo }, index) => {
      if (marker) marker.visible = index !== activeLane || showResultMarker;
      if (halo) halo.visible = index !== activeLane || showResultMarker;
    });
  }

  function extents() {
    if (!dimensions) return null;
    const { length, radius, spacing } = dimensions;
    const minimumZ = originalDepth - (activeLane < 0 ? 2 * spacing : spacing) - 0.17;
    const maximumZ = originalDepth + spacing + 0.17;
    return { minimum: new Vector3(-length - 0.1, -0.08, minimumZ),
      maximum: new Vector3(radius + 0.1, radius * 2 + 0.14, maximumZ) };
  }

  function frame(stage) {
    const bounds = extents();
    if (!bounds) return false;
    const { minimum, maximum } = bounds;
    const target = minimum.clone().add(maximum).multiplyScalar(0.5);
    const direction = new Vector3(0.95, 0.6, 0.53).normalize();
    const right = new Vector3(direction.z, 0, -direction.x).normalize();
    const up = direction.clone().cross(right).normalize();
    const vertical = Math.tan(stage.camera.fov * Math.PI / 360);
    const horizontal = vertical * Math.max(0.2, stage.camera.aspect);
    let distance = 0;
    for (const x of [minimum.x, maximum.x]) {
      for (const y of [minimum.y, maximum.y]) {
        for (const z of [minimum.z, maximum.z]) {
          const corner = new Vector3(x, y, z).sub(target);
          const depth = corner.dot(direction);
          distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / horizontal,
            depth + Math.abs(corner.dot(up)) / vertical);
        }
      }
    }
    distance *= 1.13;
    stage.setView(target.clone().addScaledVector(direction, distance).toArray(), target.toArray());
    return true;
  }

  return {
    update,
    frame,
    bounds: extents,
    destroy() {
      model.group.position.z = originalDepth;
      model.anchors = originalAnchors;
      scene.remove(comparison);
      disposeObjects(comparison);
    },
  };
}
