(() => {
  const motion = globalThis.PhysicsCircularMotion;
  if (!motion) return;

  const columns = [
    { key: 'time', label: '时间', unit: 's', precision: 3 },
    { key: 'phase', label: '运动阶段', unit: '', precision: 0 },
    { key: 'angle', label: '轨道角度', unit: '°', precision: 1 },
    { key: 'speed', label: '速率', unit: 'm/s', precision: 3 },
    { key: 'weight', label: '重力', unit: 'N', precision: 3 },
    { key: 'normal', label: '支持力', unit: 'N', precision: 3 },
    { key: 'drive', label: '水平推力', unit: 'N', precision: 3 },
    { key: 'net', label: '合力', unit: 'N', precision: 3 },
  ];
  const phases = { launch: '水平段', loop: '圆轨道', return: '沿轨返回', airborne: '离轨', stationary: '静止' };
  const outcomes = { completed: '完成一圈', detached: '离开轨道', returned: '沿轨道滑回底部', stationary: '小球保持静止' };
  const magnitude = vector => Math.hypot(...vector);
  const rounded = (value, precision) => Number(value.toFixed(precision));

  function rows(result) {
    return result.samples.map(state => ({
      time: rounded(state.time, 4),
      phase: phases[state.phase],
      angle: state.angleDeg == null ? '—' : rounded(state.angleDeg, 2),
      speed: rounded(state.speed, 4),
      weight: rounded(magnitude(state.gravity), 4),
      normal: rounded(magnitude(state.normal), 4),
      drive: rounded(magnitude(state.drive), 4),
      net: rounded(magnitude(state.net), 4),
    }));
  }

  function charts(result) {
    const x = result.samples.map(state => state.time);
    const curve = (name, getValue) => ({ name, kind: 'line', x, y: result.samples.map(getValue) });
    return [
      { id: 'force-time', title: '各力大小随时间变化', xLabel: '时间 t (s)', yLabel: '力 (N)', xUnit: 's', yUnit: 'N', series: [
        curve('重力', state => magnitude(state.gravity)), curve('支持力', state => magnitude(state.normal)),
        curve('水平推力', state => magnitude(state.drive)), curve('合力', state => magnitude(state.net)),
      ] },
      { id: 'speed-time', title: '速率随时间变化', xLabel: '时间 t (s)', yLabel: '速率 v (m/s)', xUnit: 's', yUnit: 'm/s', series: [curve('速率', state => state.speed)] },
    ];
  }

  function diagnosis(result) {
    let detail = '向上运动时速率减小，向下运动时速率增大。圆轨道段的支持力始终指向圆心。';
    if (result.outcome === 'detached') {
      detail = `小球在 ${result.leaveAngleDeg.toFixed(1)}° 处离开轨道，离轨后仅受重力。模拟在再次接触处结束。`;
    } else if (result.outcome === 'returned') {
      detail = '小球上升至速率为零，随后沿轨道滑回最低点。';
    } else if (result.outcome === 'stationary') {
      detail = '水平段初速度与水平推力均为零。重力和支持力平衡。';
    }
    return [{ id: 'circular_motion', severity: result.outcome === 'completed' ? 'info' : 'warn', title: outcomes[result.outcome], detail,
      facts: [{ key: 'criticalF', label: '当前初速度下的临界推力', value: `${result.requiredForce.toFixed(2)} N` }] }];
  }

  globalThis.configurePhysicsCircularExperiment = original => ({
    ...original,
    metadata: { ...original.metadata, name: '竖直圆轨道与实时受力', shortName: '竖直圆轨道', version: '2.0.0',
      description: '小球沿水平段进入完整竖直圆轨道。三维箭头同步标出每一时刻的重力、支持力、水平推力和合力。可拖动时间轴查看运行、回落或脱轨过程。',
      keywords: [...original.metadata.keywords, '完整圆轨道', '实时受力', '小球'] },
    parameters: original.parameters.map(parameter => {
      if (parameter.key === 'radius') return { ...parameter, label: '圆轨道半径', description: '完整竖直圆轨道的半径。' };
      if (parameter.key === 'appliedForce') return { ...parameter, default: 9 };
      return parameter;
    }),
    solverVersion: 'vertical-loop/2.0.0',
    solve: motion.solve,
    metrics(result) {
      if (!result.samples) return original.metrics(result);
      const metric = (key, label, value, unit, source) => ({ key, label, value, unit, source, precision: 3 });
      return [
        metric('duration', '仿真时长', result.duration, 's', '从释放到完成一圈、回到底部或离轨后再次接触'),
        metric('requiredF', '临界推力', result.requiredForce, 'N', '当前初速度下完成一圈所需的最小水平推力'),
        metric('vM', '入轨速率', result.speedAtM, 'm/s', '水平段功与动能关系'),
        metric('vQ', '最高点速率', result.pointQ.speed ?? '—', 'm/s', '小球贴轨经过最高点时的速率'),
        metric('normalQ', '最高点支持力', result.pointQ.normalForce ?? '—', 'N', '小球贴轨经过最高点时，N = mv²/R − mg'),
      ];
    },
    dataView: { ...original.dataView, columns, rows: (result, mode) => result.samples ? rows(result) : original.dataView.rows(result, mode) },
    charts: result => result.samples ? charts(result) : original.charts(result),
    diagnosis: (parameters, result) => result.samples ? diagnosis(result) : original.diagnosis(parameters, result),
    records: { ...original.records, columns, timeColumn: 'time', sampleLabel: '时间采样', derivedNote: '各力大小由瞬时力矢量计算。离轨段记录重力和合力。' },
    theory: { ...original.theory,
      latex: String.raw`v^2=v_M^2-2gR(1-\cos\theta)\qquad N=mv^2/R+mg\cos\theta`,
      description: '重力始终竖直向下。贴轨时支持力指向圆心，合力由各个作用力矢量相加。支持力降为零并失去接触后，小球做抛体运动。轨道与小球均按理想模型处理。' },
    teaching: { ...original.teaching,
      learningGoal: '观察小球在水平段、竖直圆轨道和离轨段的受力，检验最高点的贴轨条件。',
      principles: [
        { title: '圆轨道上的受力', latex: String.raw`N=mv^2/R+mg\cos\theta`, text: '支持力随速率和在轨道上的位置改变，重力保持竖直向下。' },
        { title: '通过最高点的条件', latex: String.raw`v_Q\ge\sqrt{gR}`, text: '临界时支持力为零，重力单独提供向心加速度。' },
      ],
      apparatus: ['光滑水平段和完整竖直圆轨道', '小球', '水平推力装置'],
      steps: ['运行默认实验，拖动时间轴比较小球在轨道底部、侧面与顶部的受力。', '减小水平推力，观察支持力何时归零，以及小球离轨后的合力。'],
    },
  });
})();
