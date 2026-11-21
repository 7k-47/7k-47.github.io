import { createTerrainView } from './terrain.js';
import { createInterferenceView } from './interference.js';
import { createTrackView } from './track.js?v=loop2';
import { mountTerrainThree } from './terrain-three.js?v=loop2';
import { mountInterferenceThree } from './interference-three.js';
import { mountTrackThree } from './track-three.js?v=loop2';

const views = {
  'electricity.potential': {
    title: '等势线与探针',
    companion: createTerrainView,
    three: mountTerrainThree,
  },
  'optics.double_slit': {
    title: '光强分布与条纹测量',
    companion: createInterferenceView,
    three: mountInterferenceThree,
  },
  'mechanics.circular': {
    title: '小球实时受力',
    companion: createTrackView,
    three: mountTrackThree,
  },
};

export function mountModelView(host, snapshot, { native, solve, setParameters, seek }) {
  const experiment = views[snapshot.experimentId];
  if (!experiment) return null;
  const root = document.createElement('div');
  root.className = 'physics-model-view';
  const title = document.createElement('h3');
  title.className = 'physics-view-heading';
  title.textContent = experiment.title;
  root.append(title);
  host.replaceChildren(root);

  let companion;
  let model;
  try {
    companion = experiment.companion({
      root, solve, setParameters, seek, companion: Boolean(native),
    });
    model = native ? experiment.three(native, solve) : null;
    companion.update(snapshot);
    model?.update(snapshot);
  } catch (error) {
    model?.destroy();
    companion?.destroy();
    root.remove();
    throw error;
  }

  return {
    update(nextSnapshot) {
      if (nextSnapshot.experimentId !== snapshot.experimentId) return;
      companion.update(nextSnapshot);
      model?.update(nextSnapshot);
    },
    frame(stage) {
      if (!model?.frame) return false;
      model.frame(stage);
      return true;
    },
    destroy() {
      model?.destroy();
      companion.destroy();
      root.remove();
    },
  };
}
