import { trackForceColors } from './track.js?v=loop2';

const SCALE = .36;

function disposeGroup(group) {
  const geometries = new Set();
  const materials = new Set();
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) materials.add(object.material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  group.clear();
}

export function mountTrackThree({ scene, three, model }) {
  const { Group, Mesh, MeshStandardMaterial, MeshBasicMaterial, TubeGeometry, SphereGeometry, Vector3,
    CatmullRomCurve3, BoxGeometry, ArrowHelper } = three;
  const root = new Group();
  root.name = 'vertical-loop-real-time';
  const course = new Group();
  const moving = new Group();
  root.add(course, moving);
  scene.add(root);
  const stageRing = scene.getObjectByName('stage-ring');
  const stageRingVisible = stageRing?.visible;
  if (stageRing) stageRing.visible = false;
  const floorGrid = scene.children.find(object => object.type === 'GridHelper');
  const floorHeight = floorGrid?.position.y;
  const wasVisible = model.group.visible;
  const oldAnchors = model.anchors;
  model.group.visible = false;
  let radius = 0;
  let length = 0;
  let forceScale = 0;
  let geometryKey;

  const ball = new Mesh(new SphereGeometry(.043, 32, 20), new MeshStandardMaterial({
    color: '#f5bc68', metalness: .38, roughness: .29,
  }));
  ball.castShadow = true;
  moving.add(ball);

  const shaftGeometry = new BoxGeometry(1, 1, 1);
  const arrows = Object.entries(trackForceColors).map(([key, color], index) => {
    const arrow = new ArrowHelper(new Vector3(1, 0, 0), new Vector3(), 1, color);
    const offset = [-.064, .018, -.052, .074][index];
    const shaft = new Mesh(shaftGeometry, new MeshBasicMaterial({ color, depthTest: false }));
    shaft.renderOrder = 8 + index;
    shaft.visible = false;
    arrow.line.visible = false;
    arrow.line.material.depthTest = false;
    arrow.cone.material.depthTest = false;
    arrow.line.renderOrder = arrow.cone.renderOrder = 8 + index;
    arrow.visible = false;
    moving.add(arrow, shaft);
    return { key, arrow, shaft, offset };
  });
  const direction = new Vector3();
  const up = new Vector3(0, 1, 0);

  function makeCourse() {
    disposeGroup(course);
    const nickel = new MeshStandardMaterial({ color: '#a1b6c1', metalness: .76, roughness: .31 });
    const dark = new MeshStandardMaterial({ color: '#315169', metalness: .67, roughness: .49 });
    const base = new MeshStandardMaterial({ color: '#152734', metalness: .38, roughness: .65 });
    const separation = Math.min(.075, radius * .34);
    const rail = Math.min(.016, radius * .065);
    function block(x, y, z, width, height, depth, material) {
      const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
      mesh.position.set(x, y, z);
      mesh.receiveShadow = true;
      course.add(mesh);
      return mesh;
    }
    const supportY = Math.max(.13, radius * .27);
    if (floorGrid) floorGrid.position.y = -supportY - .018;
    block((radius - length) / 2, -supportY, 0, length + radius + .17, .034, .38, base);
    for (const z of [-separation, separation]) {
      const points = Array.from({ length: 112 }, (_, index) => {
        const angle = index * Math.PI / 56;
        return new Vector3(radius * Math.sin(angle), radius * (1 - Math.cos(angle)) - .025, z);
      });
      const ring = new Mesh(new TubeGeometry(new CatmullRomCurve3(points, true), 160, rail, 10, true), nickel);
      ring.castShadow = true;
      course.add(ring);
      block(-length / 2, -.025, z, length, rail * 2, rail * 2, nickel);
    }
    for (let index = 0; index < 24; index++) {
      const angle = index * Math.PI / 12;
      const x = (radius + .017) * Math.sin(angle);
      const y = radius - (radius + .017) * Math.cos(angle) - .025;
      const tie = block(x, y, 0, .028, .018, 2 * separation + .015, dark);
      tie.rotation.z = angle;
    }
    const posts = [-length * .85, -length * .25, radius * .66];
    for (const x of posts) {
      const top = x < 0 ? -.045 : radius * (1 - Math.sqrt(1 - .66 ** 2)) - .055;
      const from = -supportY + .019;
      if (top <= from) continue;
      for (const z of [-separation, separation]) block(x, (top + from) / 2, z, .033, top - from, .032, dark);
    }
  }

  model.anchors = () => [
    { index: '01', label: '入轨点', meta: '最低点 · 0° / 360°', position: new Vector3(0, 0, 0), side: 'left' },
    { index: '02', label: '最高点', meta: '180°', position: new Vector3(0, 2 * radius, 0), side: 'right' },
  ];

  return {
    update({ result, motion }) {
      if (!motion || !result) return;
      const nextGeometry = `${result.radius}/${result.horizontalLength}`;
      if (geometryKey !== nextGeometry) {
        geometryKey = nextGeometry;
        radius = result.radius * SCALE;
        length = result.horizontalLength * SCALE;
        makeCourse();
      }
      const maxForce = Math.max(result.appliedForce, result.massKg * (result.g + result.speedAtM ** 2 / result.radius));
      forceScale = Math.min(1, Math.max(.35, radius * 1.55)) / maxForce;
      ball.position.set(motion.position.x * SCALE, motion.position.y * SCALE + .026, 0);
      for (const { key, arrow, shaft, offset } of arrows) {
        const [x, y] = motion[key];
        const magnitude = Math.hypot(x, y);
        const arrowLength = magnitude * forceScale;
        arrow.visible = magnitude >= .005 && arrowLength >= .002;
        shaft.visible = arrow.visible;
        if (!arrow.visible) continue;
        direction.set(x / magnitude, y / magnitude, 0);
        arrow.position.copy(ball.position);
        arrow.position.x -= direction.y * offset;
        arrow.position.y += direction.x * offset;
        arrow.position.z = .025;
        arrow.setDirection(direction);
        const head = Math.min(.071, arrowLength * .40);
        arrow.setLength(arrowLength, head, head * .62);
        const shaftLength = arrowLength - head * .72;
        const thickness = Math.min(.012, arrowLength * .18);
        shaft.position.copy(arrow.position).addScaledVector(direction, shaftLength / 2);
        shaft.quaternion.setFromUnitVectors(up, direction);
        shaft.scale.set(thickness, shaftLength, thickness);
      }
    },
    frame(stage) {
      if (!radius) return false;
      const target = new Vector3((radius - length) * .43, radius * .85, 0);
      const outward = new Vector3(.31, .24, 1).normalize();
      const right = new Vector3(0, 1, 0).cross(outward).normalize();
      const up = outward.clone().cross(right).normalize();
      const vertical = Math.tan(stage.camera.fov * Math.PI / 360) * .85;
      const horizontal = vertical * Math.max(.22, stage.camera.aspect);
      let distance = .62;
      for (const x of [-length - .10, radius + .17]) {
        for (const y of [-.16, 2 * radius + .24]) {
          for (const z of [-.23, .23]) {
            const point = new Vector3(x, y, z).sub(target);
            const span = Math.max(Math.abs(point.dot(right)) / horizontal, Math.abs(point.dot(up)) / vertical);
            distance = Math.max(distance, point.dot(outward) + span);
          }
        }
      }
      stage.setView(target.clone().addScaledVector(outward, distance).toArray(), target.toArray());
      return true;
    },
    destroy() {
      if (stageRing) stageRing.visible = stageRingVisible;
      if (floorGrid) floorGrid.position.y = floorHeight;
      model.group.visible = wasVisible;
      model.anchors = oldAnchors;
      scene.remove(root);
      disposeGroup(course);
      ball.geometry.dispose();
      ball.material.dispose();
      shaftGeometry.dispose();
      for (const { arrow, shaft } of arrows) {
        // ArrowHelper shares geometries across instances. Only these materials are owned here.
        arrow.line.material.dispose();
        arrow.cone.material.dispose();
        shaft.material.dispose();
      }
    },
  };
}
