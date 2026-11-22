export const PENDULUM = 'mechanics.pendulum';

const increase = ['变大', '变小', '基本不变'];

export const INQUIRIES = {
  'mechanics.inclined_plane': {
    title: '倾角与下滑加速度', variable: 'angleDeg', from: 25, to: 40,
    setup: {staticFriction: 0.15, kineticFriction: 0.10},
    prediction: '保持滑块、摩擦系数和路程相同，把斜面倾角从 25° 调到 40°，滑块加速度会怎样变？',
    metrics: [{key: 'acceleration', label: '沿斜面加速度', unit: 'm/s²'}, {key: 'endTime', label: '滑行时间', unit: 's'}],
    hint: '沿斜面重力分量随倾角增大而增大，支持力和动摩擦力则会改变。',
  },
  'optics.prism_dispersion': {
    title: '棱镜顶角与偏向角', variable: 'apexAngleDeg', from: 45, to: 60,
    setup: {incidenceAngleDeg: 45, material: 'BK7'},
    prediction: '保持玻璃和入射角相同，顶角从 45° 增至 60°，同一参考波长的偏向角会怎样变？',
    metrics: [{key: 'deltaRef', label: '参考波长偏向角', unit: '°'}, {key: 'deltaSpan', label: '光谱展宽', unit: '°'}],
    hint: '沿参考波长的光线观察两个界面。比较时在两组中都用 587.6 nm 的光。',
  },
  'mechanics.linear_motion': {
    title: '加速度与滑行用时', variable: 'acceleration', from: 1, to: 3,
    prediction: '小车的初速度和行程相同，把加速度从 1 增至 3 m/s²，跑完整段路的时间会怎样变？',
    metrics: [{key: 'totalTime', label: '全程用时', unit: 's'}, {key: 'fitAcceleration', label: '纸带拟合加速度', unit: 'm/s²'}],
    hint: '先确定两次跑到的是同一个位置，再对照中途纸带上相邻点的间距。',
  },
  'mechanics.projectile': {
    title: '平抛射程与水平初速度', variable: 'speed', from: 3, to: 6, setup: {launchAngleDeg: 0},
    prediction: '同一高度水平抛出小球。初速度从 3 增至 6 m/s，水平射程会怎样变？',
    metrics: [{key: 'range', label: '水平射程', unit: 'm'}, {key: 'flightTime', label: '飞行时间', unit: 's'}],
    hint: '先比较两组飞行时间。平抛的竖直运动决定用时，水平速度决定这段时间内走多远。',
  },
  'mechanics.force_composition': {
    title: '夹角与合力', variable: 'angleDeg', from: 60, to: 120,
    prediction: '两支弹簧测力计的示数保持不变。两分力夹角从 60° 增至 120°，合力会怎样变？',
    metrics: [{key: 'resultant', label: '合力大小', unit: 'N'}, {key: 'direction', label: '合力方向角', unit: '°'}],
    hint: '画出力的平行四边形。两条邻边的长度分别保持不变，观察对角线怎样变化。',
  },
  [PENDULUM]: {
    title: '摆长与周期', variable: 'lengthM', from: 0.60, to: 0.90,
    prediction: '先猜一猜。摆长从 0.60 m 增加到 0.90 m，摆角和摆球质量都一样。摆一个来回的时间会怎么变？',
    options: ['周期变长', '周期变短', '周期不变'],
    metrics: [{key: 'periodActual', label: '周期', unit: 's'}],
    hint: '先用每组总用时除以全振动次数。小摆角时，周期与摆长的平方根成正比。',
    transfer: '想继续探究，可以保持摆长和摆角相同，再换一个质量的摆球。',
  },
  'mechanics.hooke': {
    title: '悬挂质量与弹簧伸长', variable: 'massLeftG', from: 200, to: 400,
    prediction: '使用同一根弹簧，把左侧砝码质量从 200 g 增至 400 g。弹簧静止时的伸长量会怎样变？',
    metrics: [{key: 'leftX', label: '左弹簧伸长', unit: 'cm'}, {key: 'leftF', label: '左弹簧弹力', unit: 'N'}],
    hint: '伸长量要用总长度减去原长。静止时，弹力等于悬挂砝码的重力。',
  },
  'mechanics.circular': {
    title: '推力与最高点速率', variable: 'appliedForce', from: 10, to: 15,
    setup: {horizontalLength: 5, radius: 1.6, massKg: 1, initialSpeed: 0, gravity: 10},
    prediction: '轨道和小球相同，水平段推力从 10 N 增至 15 N，小球过圆轨道最高点时的速率会怎样变？',
    metrics: [{key: 'vQ', label: '最高点速率', unit: 'm/s'}, {key: 'normalQ', label: '最高点支持力', unit: 'N'}],
    hint: '先比较进入圆轨道时的动能，再考虑到达同一高度要增加多少重力势能。',
  },
  'electricity.capacitor': {
    title: '电阻与充电速度', variable: 'resistance', from: 10, to: 20, setup: {switchState: 'charging'},
    prediction: '同一个电容器用相同电压充电。电阻从 10 kΩ 增至 20 kΩ，时间常数会怎样变？',
    metrics: [{key: 'tau', label: '充电时间常数', unit: 's'}, {key: 'initialCurrent', label: '初始充电电流', unit: 'mA'}],
    hint: '比较充到最终电压约六成三所需的时间。时间常数等于电阻乘以电容。',
  },
  'electricity.point_charge': {
    title: '探针位置与点电荷场强', variable: 'probeX', from: 0.08, to: 0.16,
    setup: {preset: 'single', probeY: 0.05},
    prediction: '保持点电荷和探针的纵坐标不变，把横坐标从 0.08 m 移到 0.16 m，探针处场强会怎样变？',
    metrics: [{key: 'Emag', label: '探针处场强', unit: 'N/C'}, {key: 'potential', label: '探针处电势', unit: 'V'}],
    hint: '比较探针到点电荷的实际距离，距离并不等于横坐标。',
  },
  'electricity.deflection': {
    title: '偏转电压与屏幕偏移', variable: 'voltage', from: 40, to: 80,
    setup: {accelVoltage: 1000, plateSeparation: 0.02, plateLength: 0.08, screenDistance: 0.15},
    prediction: '入射条件和极板几何保持相同。偏转电压从 40 V 增至 80 V，屏幕偏移量的大小会怎样变？',
    metrics: [{key: 'yTotal', label: '屏幕总偏移', unit: 'mm'}, {key: 'E', label: '板间电场', unit: 'V/m'}],
    hint: '先看板间电场，再比较粒子在相同入射速度下受到的横向加速度。',
  },
  'electricity.magnetic_particle': {
    title: '磁感应强度与回旋半径', variable: 'magneticField', from: 0.50, to: 1.00,
    setup: {incidentAngleDeg: 90},
    prediction: '同一粒子以相同速率垂直进入匀强磁场。磁感应强度从 0.50 T 增至 1.00 T，回旋半径会怎样变？',
    metrics: [{key: 'radius', label: '回旋半径', unit: 'cm'}, {key: 'period', label: '回旋周期', unit: 'ns'}],
    hint: '洛伦兹力提供向心力。磁场增强时，粒子速率是否也发生变化？',
  },
  'electricity.rail': {
    title: '拉力与导轨感应电流', variable: 'externalForce', from: 0.5, to: 1.0, setup: {driveMode: 'force'},
    prediction: '导轨、电阻和磁场相同，测量时长也相同。恒定拉力从 0.5 N 增至 1.0 N，记录到的最大电流会怎样变？',
    metrics: [{key: 'imax', label: '该时段最大电流', unit: 'A'}, {key: 'heat', label: '该时段焦耳热', unit: 'J'}],
    hint: '把同一时段内的最大电流作比较。导体棒速度会影响动生电动势。',
  },
  'electricity.generator': {
    title: '线圈匝数与峰值电动势', variable: 'turns', from: 100, to: 200, setup: {outputMode: 'ac'},
    prediction: '磁场、线圈面积和转速相同。匝数从 100 增至 200，峰值电动势会怎样变？',
    metrics: [{key: 'peak', label: '峰值电动势', unit: 'V'}, {key: 'freq', label: '交流频率', unit: 'Hz'}],
    hint: '峰值电动势取决于磁通变化率和匝数。比较频率时留意线圈转速保持相同。',
  },
  'optics.double_slit': {
    title: '波长与干涉条纹间距', variable: 'wavelengthNm', from: 450, to: 650,
    setup: {emitMode: 'wave', observePath: 'off'},
    prediction: '双缝间距和屏的位置相同。波长从 450 nm 增至 650 nm，相邻亮纹的间距会怎样变？',
    metrics: [{key: 'spacing', label: '相邻亮纹间距', unit: 'mm'}],
    hint: '选相邻两条明纹，或测多条后除以间隔数。缝屏距离和缝间距始终用同一组值。',
  },
  'mechanics.collision': {
    title: '初速度与碰撞前后动量', variable: 'velC', from: 4, to: 6,
    setup: {collisionType: 'inelastic', massA: 1, massB: 2, massC: 1, mu1: 0.3, mu2: 0.06, boardLength: 2},
    prediction: '保持质量和接触条件不变，把物块 C 的初速度从 4 m/s 增至 6 m/s，碰撞前的总动量会怎样变？',
    metrics: [{key: 'pBefore', label: '碰前总动量', unit: 'kg·m/s'}, {key: 'pAfter', label: '碰后总动量', unit: 'kg·m/s'}],
    hint: '每组都比较碰撞前后两个紧邻时刻的系统总动量。注意速度的正负方向。',
  },
  'electricity.potential': {
    title: '电荷量与最大场强', variable: 'chargeMicroC', from: 2, to: 4, setup: {scene: 'unlike'},
    prediction: '保持异号点电荷的间距、采样范围和布局相同。把两电荷的电荷量大小从 2 μC 增至 4 μC，模型中最大场强会怎样变？',
    metrics: [{key: 'eMax', label: '采样范围最大场强', unit: 'V/m'}],
    hint: '要比较同一采样区域。单个电荷的场强与电荷量成正比，合场强用分量叠加。',
  },
};

export function inquiryFor(experimentId) {
  return Object.hasOwn(INQUIRIES, experimentId) ? INQUIRIES[experimentId] : null;
}

export function inquiryProgress(experimentId) {
  return experimentId === PENDULUM
    ? {lessonId: 'mechanics.pendulum.inquiry', taskId: 'compare-periods'}
    : {lessonId: 'tutor.' + experimentId, taskId: 'compare'};
}

export function predictionOptions(inquiry) {
  return inquiry.options ?? increase;
}

export const PENDULUM_PHOTO_FIELDS = [
  {key: 'lengthM', label: '摆长', unit: 'm', min: 0.001, max: 100, required: true},
  {key: 'angleDeg', label: '初始摆角', unit: '°', min: 0, max: 180},
  {key: 'oscillations', label: '全振动次数', unit: '', min: 1, max: 10000, integer: true, required: true},
  {key: 'totalTimeS', label: '总用时', unit: 's', min: 0.001, max: 1e6, required: true},
];

export function photoFieldsFor(experiment) {
  if (experiment.experimentId === PENDULUM) return PENDULUM_PHOTO_FIELDS;
  const inquiry = inquiryFor(experiment.experimentId);
  if (!inquiry) return [];
  const control = experiment.paramDefs.find(param => param.key === inquiry.variable);
  return [
    {key: control.key, label: control.label, unit: control.unit || ''},
    ...inquiry.metrics.map((metric, index) => ({...metric, required: index === 0})),
  ];
}

export function photoDescription(fields, reading) {
  const data = fields.filter(field => Number.isFinite(reading[field.key])).map(field =>
    field.label + ' ' + reading[field.key] + (field.unit ? ' ' + field.unit : ''));
  if (Number.isFinite(reading.totalTimeS) && reading.oscillations > 0) {
    data.push('平均周期 ' + (reading.totalTimeS / reading.oscillations).toFixed(3) + ' s');
  }
  return data.join('，');
}
