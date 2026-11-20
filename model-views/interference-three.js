import { getInterferenceFringePairs, watchInterferenceSelection } from './interference.js';

const SOURCE = -.564;
const SLITS = -.06;
const SCREEN = .62;
const SCREEN_HEIGHT = .42;
const SCREEN_WIDTH = .156;
const SCREEN_FACE = .609;
const RULER_COLOR = 0xffcc83;

function frameExperiment(stage, Vector3) {
  const target = new Vector3(0, .018, 0);
  const outward = new Vector3(-.31, .28, .91).normalize();
  const right = new Vector3(0, 1, 0).cross(outward).normalize();
  const up = outward.clone().cross(right).normalize();
  const { clientWidth, clientHeight } = stage.containerEl;
  const aspect = clientWidth > 0 && clientHeight > 0 ? clientWidth / clientHeight : stage.camera.aspect;
  const verticalTangent = Math.tan(stage.camera.fov * Math.PI / 360) * .87;
  const horizontalTangent = verticalTangent * Math.max(.25, aspect);
  let distance = 1.10;
  for (const x of [-.74, .74]) {
    for (const y of [-.27, .34]) {
      for (const z of [-.20, .20]) {
        const corner = new Vector3(x, y, z).sub(target);
        const depth = corner.dot(outward);
        const span = Math.max(Math.abs(corner.dot(right)) / horizontalTangent, Math.abs(corner.dot(up)) / verticalTangent);
        distance = Math.max(distance, depth + span);
      }
    }
  }
  const position = target.clone().addScaledVector(outward, distance + .04);
  stage.setView(position.toArray(), target.toArray());
}

function progressOf(snapshot) {
  if (snapshot.runStatus === 'idle') return 0;
  if (snapshot.runStatus === 'finished') return 1;
  return Math.max(0, Math.min(1, snapshot.progress || 0));
}

function createWaveGeometry(three) {
  const verticalSteps = 24;
  const depthSteps = 8;
  const vertices = [];
  const faces = [];
  const wires = [];
  for (let vertical = 0; vertical <= verticalSteps; vertical += 1) {
    const theta = (vertical / verticalSteps - .5) * 1.9;
    for (let depth = 0; depth <= depthSteps; depth += 1) {
      const phi = (depth / depthSteps - .5) * 1.10;
      const point = [Math.cos(theta) * Math.cos(phi), .57 * Math.sin(theta) * Math.cos(phi), .56 * Math.sin(phi)];
      vertices.push(...point);
      if (vertical === 0 || depth === 0) continue;
      const index = vertical * (depthSteps + 1) + depth;
      faces.push(index, index - 1, index - depthSteps - 2, index, index - depthSteps - 2, index - depthSteps - 1);
      if (depth === 1 || depth === depthSteps / 2 || depth === depthSteps - 1) {
        const previous = index - depthSteps - 1;
        wires.push(...vertices.slice(previous * 3, previous * 3 + 3), ...point);
      }
    }
  }

  const surface = new three.BufferGeometry();
  surface.setAttribute('position', new three.Float32BufferAttribute(vertices, 3));
  surface.setIndex(faces);
  const outline = new three.BufferGeometry();
  outline.setAttribute('position', new three.Float32BufferAttribute(wires, 3));
  return { surface, outline };
}

export function mountInterferenceThree({ scene, model, three }) {
  const group = new three.Group();
  group.name = 'double-slit-optics-3d';
  const resources = new Set();
  const keep = (resource) => {
    resources.add(resource);
    return resource;
  };

  const cube = keep(new three.BoxGeometry(1, 1, 1));
  const benchMaterial = keep(new three.MeshStandardMaterial({ color: 0x263b4d, roughness: .58, metalness: .28 }));
  const plateMaterial = keep(new three.MeshStandardMaterial({ color: 0x4d7183, roughness: .42, metalness: .32 }));
  const screenMaterial = keep(new three.MeshStandardMaterial({ color: 0x101e2d, roughness: .85, metalness: .12 }));
  const edgeMaterial = keep(new three.MeshBasicMaterial({ color: 0x5c9cb0 }));

  function piece(material, x, y, z, sx, sy, sz) {
    const mesh = new three.Mesh(cube, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    group.add(mesh);
    return mesh;
  }

  piece(benchMaterial, 0, -.248, 0, 1.48, .025, .24);
  piece(benchMaterial, 0, -.226, 0, 1.44, .012, .075);
  piece(plateMaterial, SOURCE - .055, -.128, 0, .021, .205, .048);
  piece(plateMaterial, SLITS, -.199, 0, .018, .058, .072);
  piece(screenMaterial, SCREEN + .005, 0, 0, .013, SCREEN_HEIGHT + .014, SCREEN_WIDTH + .012);
  for (const sign of [-1, 1]) {
    piece(edgeMaterial, SCREEN - .002, sign * (SCREEN_HEIGHT / 2 + .006), 0, .012, .004, SCREEN_WIDTH + .014);
    piece(edgeMaterial, SCREEN - .002, 0, sign * (SCREEN_WIDTH / 2 + .004), .012, SCREEN_HEIGHT + .016, .004);
  }

  const aperture = Array.from({ length: 3 }, () => piece(plateMaterial, SLITS, 0, 0, .012, 1, .137));

  const waveGeometry = createWaveGeometry(three);
  keep(waveGeometry.surface);
  keep(waveGeometry.outline);
  function makeWaves(amount, color) {
    return Array.from({ length: amount }, () => {
      const wave = new three.Group();
      const skin = keep(new three.MeshBasicMaterial({
        color, transparent: true, side: three.DoubleSide, depthWrite: false,
      }));
      const wire = keep(new three.LineBasicMaterial({ color, transparent: true, depthWrite: false }));
      wave.add(new three.Mesh(waveGeometry.surface, skin), new three.LineSegments(waveGeometry.outline, wire));
      wave.visible = false;
      group.add(wave);
      return { wave, skin, wire };
    });
  }

  const incoming = makeWaves(12, 0xc3ffe8);
  const upper = makeWaves(14, 0x80e9ef);
  const lower = makeWaves(14, 0x8faaff);

  const photonGeometry = keep(new three.BufferGeometry());
  const photonMaterial = keep(new three.PointsMaterial({
    size: .0055, vertexColors: true, depthWrite: false, opacity: .9, transparent: true,
  }));
  const photons = new three.Points(photonGeometry, photonMaterial);
  photons.visible = false;
  group.add(photons);

  const ruler = new three.Group();
  ruler.name = 'double-slit-fringe-ruler';
  ruler.visible = false;
  group.add(ruler);
  const rulerGeometry = keep(new three.BufferGeometry());
  const rulerPositions = new three.Float32BufferAttribute(new Float32Array(5 * 2 * 3), 3);
  rulerGeometry.setAttribute('position', rulerPositions);
  const rulerMaterial = keep(new three.LineBasicMaterial({ color: RULER_COLOR, depthTest: false, transparent: true, opacity: .9 }));
  const marks = new three.LineSegments(rulerGeometry, rulerMaterial);
  marks.frustumCulled = false;
  marks.renderOrder = 4;
  ruler.add(marks);

  const dotGeometry = keep(new three.SphereGeometry(.005, 10, 6));
  const dotMaterial = keep(new three.MeshBasicMaterial({ color: RULER_COLOR, depthTest: false }));
  const dots = [new three.Mesh(dotGeometry, dotMaterial), new three.Mesh(dotGeometry, dotMaterial)];
  for (const dot of dots) {
    dot.renderOrder = 4;
    ruler.add(dot);
  }

  const rebuildNativeFringes = model.rebuildFringes;
  const rebuildNativeWaves = model.rebuildWavefronts;
  const rebuildNativePhotons = model.rebuildPhotons;
  const originalAnchors = model.anchors;
  const disabledRebuild = () => {};
  model.rebuildWavefronts = disabledRebuild;
  model.rebuildPhotons = disabledRebuild;
  model.waveGroup.visible = false;
  model.photonGroup.visible = false;

  let snapshot;
  let currentResult;
  let domain;
  let pairs = [];
  let selection = 0;
  let measured;
  let nativeBase;

  function screenY(yMm) {
    return ((yMm - domain.min) / (domain.max - domain.min) - .5) * SCREEN_HEIGHT;
  }

  model.anchors = function () {
    return originalAnchors.call(this).flatMap((anchor) => {
      if (anchor.label !== '条纹间距' || !snapshot) return [anchor];
      if (!measured) return [];
      return [{ ...anchor, meta: `Δy ≈ ${measured.distance.toFixed(measured.distance < 10 ? 2 : 1)} mm`,
        position: new three.Vector3(SCREEN_FACE, screenY((measured.first.position + measured.second.position) / 2), SCREEN_WIDTH / 2 + .015) }];
    });
  };

  function updateRuler() {
    const ready = snapshot && currentResult && snapshot.showSpacing !== false
      && (currentResult.emitMode === 'wave' || snapshot.runStatus === 'finished');
    const pair = ready && (pairs.find(({ order }) => order === selection) ?? pairs.find(({ order }) => order === 0) ?? pairs[0]);
    if (pair === measured) return;
    measured = pair;
    ruler.visible = !!pair;
    if (!pair) return;

    const x = SCREEN_FACE - .002;
    const flank = SCREEN_WIDTH / 2 + .016;
    const y1 = screenY(pair.first.position);
    const y2 = screenY(pair.second.position);
    const guides = [
      [x, y1, -.075], [x, y1, flank], [x, y2, -.075], [x, y2, flank],
      [x, y1, flank], [x, y2, flank],
      [x, y1, flank - .006], [x, y1, flank + .006],
      [x, y2, flank - .006], [x, y2, flank + .006],
    ];
    for (let index = 0; index < guides.length; index += 1) rulerPositions.setXYZ(index, ...guides[index]);
    rulerPositions.needsUpdate = true;
    dots[0].position.set(x, y1, flank);
    dots[1].position.set(x, y2, flank);
  }

  const stopSelection = watchInterferenceSelection((order) => {
    selection = order;
    updateRuler();
  });

  function alignNativeScreen(result) {
    if (!model.fringeGroup.children.length || model.fringeGroup.children[0] === nativeBase) {
      rebuildNativeFringes.call(model, result);
    }
    nativeBase = model.fringeGroup.children[0];
    for (const [index, mesh] of model.fringeGroup.children.entries()) {
      mesh.position.x = SCREEN_FACE + (index === 0 ? .002 : 0);
      mesh.scale.x = index === 0 ? SCREEN_WIDTH / .012 : SCREEN_WIDTH / .0032;
      if (index === 0) {
        mesh.material.transparent = false;
        mesh.material.opacity = 1;
        mesh.material.needsUpdate = true;
      } else {
        mesh.renderOrder = 2;
      }
    }
  }

  function prepareParameters(result) {
    const profile = result.intensityProfile;
    domain = { min: profile[0].yMm, max: profile.at(-1).yMm };
    pairs = getInterferenceFringePairs(result);
    alignNativeScreen(result);

    const slit = Math.max(.012, result.slitSeparation * 32) / 2;
    const slitHalfHeight = .003;
    const sections = [[-.165, -slit - slitHalfHeight], [-slit + slitHalfHeight, slit - slitHalfHeight], [slit + slitHalfHeight, .165]];
    for (let index = 0; index < aperture.length; index += 1) {
      const [bottom, top] = sections[index];
      aperture[index].position.y = (bottom + top) / 2;
      aperture[index].scale.y = top - bottom;
    }

    if (result.emitMode !== 'photon') return;
    const size = result.photonHits.length * 3;
    if (photonGeometry.getAttribute('position')?.array.length !== size) {
      photonGeometry.setAttribute('position', new three.Float32BufferAttribute(new Float32Array(size), 3));
      photonGeometry.setAttribute('color', new three.Float32BufferAttribute(new Float32Array(size), 3));
    }
    const positions = photonGeometry.getAttribute('position');
    const colors = photonGeometry.getAttribute('color');
    const wave = [result.color.r / 255, result.color.g / 255, result.color.b / 255];
    for (const [index, hit] of result.photonHits.entries()) {
      const across = ((index * .61803398875) % 1 - .5) * (SCREEN_WIDTH - .008);
      positions.setXYZ(index, SCREEN_FACE - .002, screenY(hit.y * 1e3), across);
      if (hit.slit === 'A') colors.setXYZ(index, .54, .94, .89);
      else if (hit.slit === 'B') colors.setXYZ(index, 1, .81, .56);
      else colors.setXYZ(index, ...wave);
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    photonGeometry.computeBoundingSphere();
  }

  function moveWaves(fronts, center, holder, limit, spacing, phase, visible, independent) {
    for (const [index, front] of fronts.entries()) {
      const radius = (index + .55 + phase) * spacing;
      front.wave.visible = visible && radius < limit;
      if (!front.wave.visible) continue;
      const fade = 1 - radius / (limit * 1.25);
      front.wave.position.set(center, holder, 0);
      front.wave.scale.setScalar(radius);
      front.skin.opacity = fade * (independent ? .024 : .035);
      front.wire.opacity = fade * (independent ? .35 : .57);
    }
  }

  scene.add(group);
  return {
    frame(stage) {
      frameExperiment(stage, three.Vector3);
    },
    update(next) {
      snapshot = next;
      if (!next.result?.intensityProfile?.length) return;
      const result = next.result;
      if (result !== currentResult) {
        currentResult = result;
        prepareParameters(result);
      }

      const progress = progressOf(next);
      const phase = (progress * 10) % 1;
      const waveMode = result.emitMode === 'wave';
      const showWaves = waveMode && next.showWavefronts !== false;
      const frontSeparation = .05 + (result.wavelength * 1e9 - 380) * .000038;
      const slit = Math.max(.012, result.slitSeparation * 32) / 2;
      const outgoingLimit = SCREEN - SLITS - .027;
      moveWaves(incoming, SOURCE, 0, SLITS - SOURCE - .018, frontSeparation, phase, showWaves, false);
      moveWaves(upper, SLITS + .008, slit, outgoingLimit, frontSeparation, phase, showWaves, result.observePath);
      moveWaves(lower, SLITS + .008, -slit, outgoingLimit, frontSeparation, phase, showWaves, result.observePath);

      model.fringeGroup.visible = waveMode;
      photons.visible = !waveMode;
      if (!waveMode) photonGeometry.setDrawRange(0, Math.floor(progress * result.photonHits.length));
      updateRuler();
    },
    destroy() {
      stopSelection();
      scene.remove(group);
      model.rebuildWavefronts = rebuildNativeWaves;
      model.rebuildPhotons = rebuildNativePhotons;
      model.anchors = originalAnchors;
      model.waveGroup.visible = true;
      model.photonGroup.visible = true;
      model.fringeGroup.visible = true;
      for (const [index, mesh] of model.fringeGroup.children.entries()) {
        mesh.position.x = index === 0 ? .622 : .629;
        mesh.scale.x = 1;
        if (index === 0) {
          mesh.material.transparent = true;
          mesh.material.opacity = .95;
          mesh.material.needsUpdate = true;
        } else {
          mesh.renderOrder = 0;
        }
      }
      for (const resource of resources) resource.dispose();
    },
  };
}
