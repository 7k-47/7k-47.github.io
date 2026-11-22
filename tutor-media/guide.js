import {PENDULUM, inquiryFor, inquiryProgress, photoDescription, photoFieldsFor, predictionOptions} from './inquiries.js';

const PENDULUM_CYCLES = 30;

function same(a, b) {
  if (a === b) return true;
  return Number.isFinite(a) && Number.isFinite(b) &&
    Math.abs(a - b) <= 1e-10 * Math.max(Math.abs(a), Math.abs(b));
}

function parameterValue(definition, value) {
  if (definition.kind === 'select') {
    return definition.options.find(option => option.value === value)?.label ?? value;
  }
  return value + (definition.unit === '°' ? '°' : definition.unit ? ' ' + definition.unit : '');
}

function metricValue(value, metric) {
  const formatted = Number(value.toPrecision(4)).toString();
  return metric.label + ' ' + formatted + (metric.unit ? ' ' + metric.unit : '');
}

function readRun(record, inquiry) {
  const readings = inquiry.metrics.map(metric => record.metrics?.find(item => item.key === metric.key)?.value);
  let timing = null;
  if (record.experimentId === PENDULUM) {
    const result = record.result;
    const measurement = record.mode === 'measurement' ? result?.measurement : null;
    const cycles = measurement?.cycles ?? PENDULUM_CYCLES;
    const total = measurement?.totalTimeRead ?? result?.periodActual * cycles;
    if (!Number.isSafeInteger(cycles) || cycles <= 0 || !Number.isFinite(total) || total <= 0) return null;
    readings[0] = total / cycles;
    timing = {cycles, total};
  }
  return Number.isFinite(readings[0]) ? {record, readings, timing} : null;
}

function measurementChanges(first, second) {
  const changes = [];
  if (first.mode !== second.mode) changes.push('理论／测量模式不同');
  if (first.mode === 'measurement' && second.mode === 'measurement' && first.seed !== second.seed) {
    changes.push('测量随机种子不同');
  }
  return changes;
}

export function createInquiryGuide({h, ref, watch, experiment, records, lesson, speak}) {
  const inquiry = () => inquiryFor(experiment.experimentId);
  const progress = () => inquiryProgress(experiment.experimentId);
  const task = () => lesson.progressOf(progress().lessonId).tasks[progress().taskId] ?? {};
  const hint = ref(false);
  const pending = ref(null);
  const status = ref('');
  const explanation = ref(task().explanation ?? '');
  let disposed = false;

  function update(field, value) {
    const {lessonId, taskId} = progress();
    lesson.setTaskField(lessonId, taskId, field, value);
  }

  function initialConditions(config) {
    const parameters = {...config.setup, [config.variable]: config.from};
    if (experiment.experimentId === PENDULUM && experiment.parameters.amplitudeDeg > 5) {
      parameters.amplitudeDeg = 5;
    }
    return parameters;
  }

  function initialMatches(config, parameters) {
    return same(parameters[config.variable], config.from) &&
      Object.entries(config.setup ?? {}).every(([key, value]) => same(parameters[key], value)) &&
      (experiment.experimentId !== PENDULUM || parameters.amplitudeDeg <= 5);
  }

  function getRuns(config) {
    const saved = records.recordsFor(experiment.experimentId).map(record => readRun(record, config)).filter(Boolean);
    const current = task();
    const completed = current.completed && current.tutorPair;
    if (completed) {
      const first = saved.find(run => run.record.runId === completed.first);
      const second = saved.find(run => run.record.runId === completed.second);
      if (first && second) return {first, second};
    }
    const index = saved.findIndex(run => run.record.runId === current.tutorBaseline &&
      initialMatches(config, run.record.parameters));
    const baseline = index >= 0 ? index : saved.findIndex(run => initialMatches(config, run.record.parameters));
    return {
      first: saved[baseline] ?? null,
      second: baseline < 0 ? null : saved.slice(0, baseline).find(run =>
        same(run.record.parameters[config.variable], config.to)) ?? null,
    };
  }

  function differences(config, before, after) {
    return [
      ...experiment.paramDefs
        .filter(param => param.key !== config.variable && !same(before.parameters[param.key], after.parameters[param.key]))
        .map(param => param.label + ' ' + parameterValue(param, before.parameters[param.key]) +
          ' → ' + parameterValue(param, after.parameters[param.key])),
      ...measurementChanges(before, after),
    ];
  }

  function pairChanges(config, first, second) {
    const changes = differences(config, first.record, second.record);
    if (first.timing && second.timing && first.timing.cycles !== second.timing.cycles) changes.push('全振动计数不同');
    return changes;
  }

  function describe(config, run) {
    const control = experiment.paramDefs.find(param => param.key === config.variable);
    const values = [control.label + ' ' + parameterValue(control, run.record.parameters[control.key])];
    if (run.timing) values.push('初始摆角 ' + run.record.parameters.amplitudeDeg + '°',
      run.timing.cycles + ' 次用时 ' + run.timing.total.toFixed(2) + ' s');
    config.metrics.forEach((metric, index) => {
      if (Number.isFinite(run.readings[index])) values.push(metricValue(run.readings[index], metric));
    });
    return values.join(' · ');
  }

  function photoRows(photos) {
    const fields = photoFieldsFor(experiment);
    return photos.map((reading, index) =>
      '照片读数 ' + (index + 1) + '（学生已核对）｜' + photoDescription(fields, reading));
  }

  function syncObservation() {
    const current = task();
    const previous = current.tutorLastObservation;
    const own = current.observation && current.observation !== previous
      ? current.observation.split('\n').filter(line => !previous?.split('\n').includes(line)).join('\n')
      : current.tutorOwnObservation;
    if (own !== current.tutorOwnObservation) update('tutorOwnObservation', own);
    const comparison = current.tutorComparison ?? previous?.split('\n').find(line => line.startsWith('仿真对照'));
    if (comparison && !current.tutorComparison) update('tutorComparison', comparison);
    const observation = [own, comparison, ...photoRows(current.tutorPhotos ?? [])].filter(Boolean).join('\n');
    update('observation', observation);
    update('tutorLastObservation', observation);
  }

  function addPhoto(reading) {
    const config = inquiry();
    if (!config) return false;
    update('tutorTitle', config.title);
    update('tutorPhotos', [...(task().tutorPhotos ?? []), reading]);
    syncObservation();
    return true;
  }

  function matchesSnapshot(snapshot) {
    return Object.entries(snapshot.parameters).every(([key, value]) => same(value, experiment.parameters[key])) &&
      !measurementChanges(snapshot, experiment).length;
  }

  function saveMeasurement(snapshot) {
    if (!matchesSnapshot(snapshot)) return;
    const config = inquiry();
    const previous = records.recordsFor(snapshot.id).find(record => record.runId === experiment.lastRunId);
    if (!previous || previous.runId === snapshot.previousRun ||
        !Object.entries(snapshot.parameters).every(([key, value]) => same(value, previous.parameters[key])) ||
        measurementChanges(snapshot, previous).length) {
      experiment.recordRun('AI 导师导学测量');
    }
    const saved = records.recordsFor(snapshot.id).find(record => record.runId === experiment.lastRunId);
    if (!saved || !readRun(saved, config)) {
      status.value = '当前条件下没有得到这项读数。请检查参数后再测一次。';
      return;
    }
    if (snapshot.first) update('tutorBaseline', saved.runId);
    status.value = '已保存本组仿真读数。';
  }

  function runGroup(config, first) {
    if (inquiry() !== config || pending.value || experiment.runStatus === 'running') return;
    if (first === null ? !initialMatches(config, experiment.parameters) :
      !same(experiment.parameters[config.variable], config.to) || differences(config, first.record, experiment).length) return;
    const snapshot = {
      id: experiment.experimentId,
      first: first === null,
      parameters: {...experiment.parameters},
      mode: experiment.mode,
      seed: experiment.seed,
      previousRun: experiment.lastRunId,
    };
    if (!experiment.canRun) {
      saveMeasurement(snapshot);
      return;
    }
    pending.value = snapshot;
    status.value = '';
    experiment.run();
    if (experiment.runStatus !== 'running') {
      pending.value = null;
      status.value = '实验当前无法运行。请核对参数和实验台的提示。';
    }
  }

  const stop = watch(() => [experiment.experimentId, experiment.runStatus], ([id, state]) => {
    const snapshot = pending.value;
    if (!snapshot || id === snapshot.id && state !== 'idle' && state !== 'finished') return;
    pending.value = null;
    if (disposed) stop();
    if (id === snapshot.id && state === 'finished') saveMeasurement(snapshot);
  });

  function apply(config, parameters, baseline) {
    if (inquiry() !== config || experiment.runStatus === 'running') return;
    for (const [key, value] of Object.entries(parameters)) experiment.setParam(key, value);
    if (baseline) {
      experiment.setMode(baseline.mode);
      if (baseline.mode === 'measurement' && Number.isFinite(baseline.seed)) experiment.setSeed(baseline.seed);
    }
    experiment.highlightVariable(config.variable);
    status.value = '';
  }

  function saveExplanation(config) {
    if (inquiry() !== config) return;
    const {first, second} = getRuns(config);
    const text = explanation.value.trim();
    if (!first || !second || pairChanges(config, first, second).length || !text) return;
    const {lessonId, taskId} = progress();
    if (!task().prediction) update('prediction', lesson.progressOf(lessonId).prediction);
    update('tutorComparison', '仿真对照｜第一组 ' + describe(config, first) + '\n第二组 ' +
      describe(config, second) + '\n已核对控制变量。两组仅改变' +
      experiment.paramDefs.find(param => param.key === config.variable).label + '，并采用相同的测量设置。');
    syncObservation();
    update('explanation', text);
    const saved = second.record;
    if (lesson.completeTask(lessonId, taskId, saved.parameters, saved.runId).ok) {
      update('tutorPair', {first: first.record.runId, second: saved.runId});
      records.setConclusion(saved.runId, text);
      records.select(saved.runId);
      status.value = '解释和对照数据已保存到实验报告。';
    }
  }

  const button = (label, onClick, primary = false, disabled = false) =>
    h('button', {class: 'btn sm' + (primary ? ' primary' : ''), type: 'button', onClick, disabled}, label);
  const paragraph = (content, className) => h('p', {class: className}, content);

  function render() {
    const config = inquiry();
    if (!config) return null;
    const current = task();
    const {lessonId} = progress();
    const prediction = current.prediction || lesson.progressOf(lessonId).prediction;
    const {first, second} = getRuns(config);
    const control = experiment.paramDefs.find(param => param.key === config.variable);
    const running = experiment.runStatus === 'running';
    const savedMode = experiment.canRun ? '运行并记录' : '测量并保存';
    const children = [];
    const actions = [];
    let title;
    let instruction;

    if (!prediction) {
      title = '先做预测';
      instruction = config.prediction;
      actions.push(...predictionOptions(config).map(option => button(option, () => {
        update('tutorTitle', config.title);
        lesson.setPrediction(lessonId, option);
        update('prediction', option);
      })));
    } else if (pending.value?.id === experiment.experimentId) {
      title = '正在做仿真测量';
      instruction = experiment.runStatus === 'paused'
        ? '实验已暂停。可以在实验台继续运行。'
        : '观察实验现象。运行结束后，导师会保存这一组读数。';
    } else if (!first && current.completed && current.tutorComparison) {
      title = '已完成对照';
      instruction = '此前保存的对照数据和解释可在实验报告中查看。';
      children.push(paragraph(current.tutorComparison, 'tutor-evidence tutor-report-observation'));
    } else if (!first) {
      title = '测量第一组';
      const parameters = initialConditions(config);
      const changes = experiment.paramDefs.filter(param => Object.hasOwn(parameters, param.key) &&
        !same(parameters[param.key], experiment.parameters[param.key]));
      instruction = '把' + control.label + '设为 ' + parameterValue(control, config.from) + '，记录' +
        config.metrics[0].label + '。';
      if (changes.length) {
        const preview = changes.map(param => param.label + '设为 ' + parameterValue(param, parameters[param.key]));
        children.push(paragraph(preview.join('，'), 'tutor-evidence'));
        actions.push(button(changes.length === 1 ? preview[0] : '应用第一组条件',
          () => apply(config, parameters), true, running));
      } else {
        actions.push(button(savedMode + '第一组', () => runGroup(config, null), true, running));
      }
    } else {
      const recordedDiff = second ? pairChanges(config, first, second) : [];
      children.push(paragraph('仿真 1｜' + describe(config, first), 'tutor-evidence'));
      if (second) children.push(paragraph('仿真 2｜' + describe(config, second), 'tutor-evidence'));
      if (second && !recordedDiff.length) {
        const completed = current.completed && current.tutorPair?.second === second.record.runId;
        title = completed ? '已完成对照' : '用读数解释结果';
        instruction = completed ? '对照数据和解释已写入实验报告。' + (config.transfer ?? '')
          : '两组只改变了' + control.label + '。引用两组读数，说说你观察到了什么，以及是否符合预测。';
        if (hint.value) children.push(paragraph(config.hint));
        children.push(h('label', {class: 'tutor-explanation'}, [
          '我的解释',
          h('textarea', {rows: 2, maxlength: 1200, value: explanation.value,
            onInput: event => { explanation.value = event.target.value; }}),
        ]));
        if (!completed && !hint.value) actions.push(button('再给一点提示', () => { hint.value = true; }));
        if (!completed || explanation.value.trim() !== current.explanation) {
          actions.push(button('保存解释到报告', () => saveExplanation(config), true, !explanation.value.trim()));
        }
      } else {
        const liveDiff = differences(config, first.record, experiment);
        title = recordedDiff.length || liveDiff.length ? '核对控制变量' : '测量第二组';
        instruction = recordedDiff.length
          ? '这两组暂时不能直接比较。变化的条件还有：' + recordedDiff.join('、') + '。恢复条件后补测。'
          : '把' + control.label + '设为 ' + parameterValue(control, config.to) + '，其他条件沿用第一组。';
        if (liveDiff.length) children.push(paragraph('需要恢复：' + liveDiff.join('、'), 'tutor-evidence'));
        if (liveDiff.length || !same(experiment.parameters[config.variable], config.to)) {
          actions.push(button(liveDiff.length ? '恢复对照条件' : control.label + '设为 ' + parameterValue(control, config.to),
            () => apply(config, {...first.record.parameters, [config.variable]: config.to}, first.record), true, running));
        } else {
          actions.push(button(savedMode + '第二组', () => runGroup(config, first), true, running));
        }
      }
    }

    actions.push(speak('inquiry-guide', instruction));
    const rows = photoRows(current.tutorPhotos ?? []);
    if (rows.length) children.push(h('details', {class: 'tutor-evidence'}, [
      h('summary', null, '已核对的照片读数（' + rows.length + '）'),
      ...rows.map(row => paragraph(row)),
    ]));
    return h('section', {class: 'tutor-guide', 'aria-label': config.title + '导学'}, [
      h('div', {class: 'tutor-guide-stage'}, config.title + ' · ' + title),
      paragraph(instruction),
      ...children,
      h('div', {class: 'tutor-guide-actions'}, actions),
      status.value ? h('p', {class: 'tutor-status', role: 'status'}, status.value) : null,
    ]);
  }

  function resetView() {
    hint.value = false;
    status.value = '';
    explanation.value = task().explanation ?? '';
  }

  function dispose() {
    disposed = true;
    if (!pending.value) stop();
  }

  return {render, addPhoto, resetView, dispose};
}
