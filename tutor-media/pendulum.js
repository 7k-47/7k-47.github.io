export const PENDULUM = 'mechanics.pendulum';
const LESSON = 'mechanics.pendulum.inquiry';
const TASK = 'compare-periods';
const FIRST_LENGTH = 0.60;
const SECOND_LENGTH = 0.90;
const CYCLES = 30;
const PREDICTIONS = ['周期变长', '周期变短', '周期不变'];

function same(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;
}

function readRun(record) {
  const params = record.parameters ?? {};
  const result = record.result ?? {};
  const measurement = record.mode === 'measurement' ? result.measurement : null;
  const cycles = measurement?.cycles ?? CYCLES;
  const seconds = measurement?.totalTimeRead ?? result.periodActual * cycles;
  if (![params.lengthM, params.amplitudeDeg, params.massG, seconds].every(Number.isFinite) || seconds <= 0) {
    return null;
  }
  return { record, params, cycles, seconds, period: seconds / cycles };
}

function conditions(first, params, mode) {
  const differences = [];
  if (!same(first.params.amplitudeDeg, params.amplitudeDeg)) {
    differences.push('初始摆角 ' + first.params.amplitudeDeg + '° → ' + params.amplitudeDeg + '°');
  }
  if (!same(first.params.massG, params.massG)) {
    differences.push('摆球质量 ' + first.params.massG + ' g → ' + params.massG + ' g');
  }
  if (first.record.mode !== mode) differences.push('测量模式不同');
  return differences;
}

function description(run) {
  return run.params.lengthM.toFixed(2) + ' m · ' + run.params.amplitudeDeg + '° · ' +
    run.cycles + ' 次 ' + run.seconds.toFixed(2) + ' s · T = ' + run.period.toFixed(3) + ' s';
}

function photosText(photos) {
  return photos.map((photo, index) => '照片实测 ' + (index + 1) + '（学生已核对）｜L = ' +
    photo.lengthM + ' m' + (photo.angleDeg === null ? '' : '，初始摆角 ' + photo.angleDeg + '°') +
    '，' + photo.oscillations + ' 次用时 ' + photo.totalTimeS + ' s，T = ' +
    (photo.totalTimeS / photo.oscillations).toFixed(3) + ' s').join('\n');
}

export function createPendulumGuide({h, ref, watch, experiment, records, lesson, speak}) {
  const hint = ref(0);
  const pending = ref(null);
  const status = ref('');
  const explanation = ref(task().explanation ?? '');
  const active = () => experiment.experimentId === PENDULUM;
  let disposed = false;

  function task() {
    return lesson.progressOf(LESSON).tasks[TASK] ?? {};
  }

  function update(field, value) {
    lesson.setTaskField(LESSON, TASK, field, value);
  }

  function getRuns() {
    const saved = records.recordsFor(PENDULUM).map(readRun).filter(Boolean);
    const current = task();
    const completed = current.completed && current.tutorPair;
    if (completed) {
      const first = saved.find(run => run.record.runId === completed.first);
      const second = saved.find(run => run.record.runId === completed.second);
      if (first && second) return {first, second};
    }
    const baseline = saved.findIndex(run => run.record.runId === current.tutorBaseline);
    const index = baseline >= 0 ? baseline : saved.findIndex(run =>
      same(run.params.lengthM, FIRST_LENGTH) && run.params.amplitudeDeg <= 5);
    return {
      first: index < 0 ? null : saved[index],
      second: index < 0 ? null : saved.slice(0, index).find(run => same(run.params.lengthM, SECOND_LENGTH)) ?? null,
    };
  }

  function pair() {
    const {first, second} = getRuns();
    return first && second && !conditions(first, second.params, second.record.mode).length &&
      first.cycles === second.cycles ? {first, second} : null;
  }

  function syncObservation() {
    const runs = pair();
    const current = task();
    const parts = [current.tutorOwnObservation, runs &&
      '仿真对照：第一组 ' + description(runs.first) + '；第二组 ' + description(runs.second),
      photosText(current.tutorPhotos ?? [])].filter(Boolean);
    const generated = parts.join('\n');
    if (generated) update('observation', generated);
    update('tutorLastObservation', generated);
  }

  function preserveObservation() {
    const current = task();
    if (current.observation && current.observation !== current.tutorLastObservation) {
      update('tutorOwnObservation', current.observation);
    }
  }

  function addPhoto(photo) {
    if (!active()) return false;
    preserveObservation();
    update('tutorPhotos', [...(task().tutorPhotos ?? []), photo]);
    syncObservation();
    return true;
  }

  function runGroup(length) {
    const run = pair();
    const {first} = getRuns();
    const params = {...experiment.parameters};
    const mode = experiment.mode;
    if (!active() || pending.value || experiment.runStatus === 'running' || !same(params.lengthM, length)) return;
    if (length === FIRST_LENGTH ? params.amplitudeDeg > 5 : !first || conditions(first, params, mode).length) return;
    pending.value = {params, mode, previousRun: experiment.lastRunId};
    experiment.run();
    if (experiment.runStatus !== 'running') pending.value = null;
    status.value = '';
    if (run) hint.value = 0;
  }

  const stop = watch(() => [experiment.experimentId, experiment.runStatus], ([id, state]) => {
    const target = pending.value;
    if (!target) return;
    if (id !== PENDULUM || state === 'idle') {
      settleRun();
      return;
    }
    if (state !== 'finished') return;
    settleRun();
    const matches = (params, mode) => Object.entries(target.params)
      .every(([key, value]) => same(value, params[key])) && target.mode === mode;
    if (!matches(experiment.parameters, experiment.mode)) return;
    const saved = records.recordsFor(PENDULUM).find(record => record.runId === experiment.lastRunId);
    if (!saved || saved.runId === target.previousRun || !matches(saved.parameters, saved.mode)) {
      experiment.recordRun('AI 导师导学测量');
    }
    if (same(target.params.lengthM, FIRST_LENGTH)) update('tutorBaseline', experiment.lastRunId);
    status.value = '已保存本组仿真记录。';
  });

  function settleRun() {
    pending.value = null;
    if (disposed) stop();
  }

  function setConditions(length, angle, mass, mode) {
    if (!active() || experiment.runStatus === 'running') return;
    if (angle !== undefined) experiment.setParam('amplitudeDeg', angle);
    if (mass !== undefined) experiment.setParam('massG', mass);
    if (mode !== undefined) experiment.setMode(mode);
    if (length !== undefined) experiment.setParam('lengthM', length);
    experiment.highlightVariable(length === undefined ? 'amplitudeDeg' : 'lengthM');
    status.value = '';
  }

  function saveExplanation() {
    const runs = pair();
    const text = explanation.value.trim();
    if (!runs || !text) return;
    if (!task().prediction) update('prediction', lesson.progressOf(LESSON).prediction);
    preserveObservation();
    syncObservation();
    update('explanation', text);
    const snapshot = runs.second.record;
    if (lesson.completeTask(LESSON, TASK, snapshot.parameters, snapshot.runId).ok) {
      update('tutorPair', {first: runs.first.record.runId, second: snapshot.runId});
      records.setConclusion(snapshot.runId, text);
      records.select(snapshot.runId);
      status.value = '解释和对照数据已保存到实验报告。';
    }
  }

  const button = (label, onClick, primary = false, disabled = false) =>
    h('button', {class: 'btn sm' + (primary ? ' primary' : ''), type: 'button', onClick, disabled}, label);
  const text = (content, className) => h('p', {class: className}, content);

  function render() {
    if (!active()) return null;
    const current = task();
    const prediction = current.prediction || lesson.progressOf(LESSON).prediction;
    const {first, second} = getRuns();
    const params = experiment.parameters;
    const mode = experiment.mode;
    const running = experiment.runStatus === 'running';
    const children = [];
    let title = '';
    let instruction = '';
    const actions = [];

    if (!prediction) {
      title = '先做预测';
      instruction = '先猜一猜。摆长从 0.60 m 增加到 0.90 m，摆角和摆球质量都一样。摆一个来回的时间会怎么变？';
      actions.push(...PREDICTIONS.map(option => button(option, () => {
        lesson.setPrediction(LESSON, option);
        update('prediction', option);
      })));
    } else if (pending.value) {
      title = '正在做仿真测量';
      instruction = experiment.runStatus === 'paused'
        ? '实验已暂停，请在实验台继续运行。' : '先看看摆球怎么来回摆动。动画结束后，这一组的仿真计时会自动记下来。';
    } else if (!first) {
      title = '测量第一组';
      instruction = '我们先测第一组。把摆长设为 0.60 m，轻轻拉开摆球，初始摆角别超过 5°。';
      const needsLength = !same(params.lengthM, FIRST_LENGTH);
      const needsAngle = params.amplitudeDeg > 5;
      if (needsLength || needsAngle) {
        const label = [needsLength && '摆长设为 0.60 m', needsAngle && '摆角设为 5°'].filter(Boolean).join('，');
        actions.push(button(label, () => setConditions(needsLength ? FIRST_LENGTH : undefined, needsAngle ? 5 : undefined), true, running));
      } else {
        actions.push(button('运行并记录第一组', () => runGroup(FIRST_LENGTH), true, running));
      }
    } else {
      const recordedDiff = second ? conditions(first, second.params, second.record.mode) : [];
      const liveDiff = conditions(first, params, mode);
      const needsLength = !same(params.lengthM, SECOND_LENGTH);
      children.push(text('仿真 1｜' + description(first), 'tutor-evidence'));
      if (second) children.push(text('仿真 2｜' + description(second), 'tutor-evidence'));
      if (second && !recordedDiff.length && first.cycles === second.cycles) {
        const completed = current.completed && current.tutorPair?.second === second.record.runId;
        title = completed ? '已完成单摆对照' : '用读数解释结果';
        instruction = completed
          ? '对照数据和解释已写入实验报告。想继续探究，可以在相同摆长下换一个质量的摆球。'
          : '现在对比一下。哪一组摆一个来回更久？把两组的摆长和周期写进解释，再回头看看自己的预测。';
        if (hint.value) children.push(text(hint.value === 1
          ? '先用每组总时间除以全振动次数，再比较两个周期。'
          : '小摆角时 T ≈ 2π√(L/g)。根据两组数据说说摆长怎样影响周期。'));
        children.push(h('label', {class: 'tutor-explanation'}, [
          '我的解释',
          h('textarea', {rows: 2, maxlength: 1200, value: explanation.value,
            onInput: event => { explanation.value = event.target.value; }}),
        ]));
        if (!completed && hint.value < 2) actions.push(button('再给一点提示', () => { hint.value += 1; }));
        if (!completed || explanation.value.trim() !== current.explanation) {
          actions.push(button('保存解释到报告', saveExplanation, true, !explanation.value.trim()));
        }
      } else {
        title = recordedDiff.length ? '核对控制变量' : '测量第二组';
        instruction = recordedDiff.length
          ? '两组同时改变了其他条件：' + recordedDiff.join('、') + '。恢复第一组条件再测。'
          : '把摆长改为 0.90 m，保持初始摆角 ' + first.params.amplitudeDeg +
            '°、摆球质量 ' + first.params.massG + ' g，并使用相同测量模式。';
        if (needsLength || liveDiff.length) {
          const base = first.params;
          const label = liveDiff.length ? '恢复对照条件' : '摆长设为 0.90 m';
          if (liveDiff.length) children.push(text('将应用：0.90 m · ' + base.amplitudeDeg + '° · ' + base.massG +
            ' g · ' + (first.record.mode === 'measurement' ? '测量模式' : '理论模式'), 'tutor-evidence'));
          actions.push(button(label, () => setConditions(SECOND_LENGTH, base.amplitudeDeg, base.massG, first.record.mode), true, running));
        } else {
          actions.push(button('运行并记录第二组', () => runGroup(SECOND_LENGTH), true, running));
        }
      }
    }

    actions.push(speak('pendulum-guide', instruction));
    const photos = task().tutorPhotos ?? [];
    if (photos.length) children.push(h('details', {class: 'tutor-evidence'}, [
      h('summary', null, '已核对的照片读数（' + photos.length + '）'),
      ...photosText(photos).split('\n').map(row => text(row)),
    ]));
    return h('section', {class: 'tutor-guide', 'aria-label': '摆长与周期导学'}, [
      h('div', {class: 'tutor-guide-stage'}, '摆长与周期 · ' + title),
      text(instruction),
      ...children,
      h('div', {class: 'tutor-guide-actions'}, actions),
      status.value ? h('p', {class: 'tutor-status', role: 'status'}, status.value) : null,
    ]);
  }

  function resetView() {
    hint.value = 0;
    status.value = '';
    explanation.value = task().explanation ?? '';
  }

  function dispose() {
    disposed = true;
    if (!pending.value) stop();
  }

  return {render, addPhoto, resetView, dispose};
}
