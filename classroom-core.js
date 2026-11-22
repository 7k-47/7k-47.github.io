(() => {
  const scenes = {
    'mechanics.inclined_plane': ['斜面滑块|斜面|下滑|静摩擦', '倾角', 'angleDeg', ['滑块', '斜面', '受力']],
    'optics.prism_dispersion': ['三棱镜|棱镜|色散|折射率|插针', '入射角', 'incidenceAngleDeg', ['入射光', '出射光谱', '全反射路径']],
    'mechanics.linear_motion': ['纸带|打点计时|匀变速|直线运动', '加速度', 'acceleration', ['小车', '纸带', '打点']],
    'mechanics.projectile': ['平抛|斜抛|抛体|抛射', '初速度', 'speed', ['小球', '轨迹点', '落点']],
    'mechanics.force_composition': ['力的合成|两个分力|平行四边形|橡皮条', '夹角', 'angleDeg', ['分力一', '分力二', '合力']],
    'mechanics.pendulum': ['单摆|摆长|测重力加速度', '摆长', 'lengthM', ['细线', '摆球', '轨迹弧']],
    'mechanics.hooke': ['胡克|弹簧|砝码', '劲度系数', 'stiffness', ['左弹簧', '右弹簧', '悬挂砝码']],
    'mechanics.circular': ['竖直圆轨道|圆轨道|脱轨|向心力', '轨道半径', 'radius', ['滑动小球', '圆轨道', '水平段']],
    'electricity.capacitor': ['电容器|充放电|充电|放电|时间常数', '电阻', 'resistance', ['电容极板', '导线', '电荷']],
    'electricity.point_charge': ['点电荷的电场|点电荷|电场叠加', '探针横坐标', 'probeX', ['源电荷', '电场线', '探针']],
    'electricity.deflection': ['极板偏转|偏转电压|电偏转|类平抛|匀强电场.{0,5}偏转', '偏转电压', 'voltage', ['平行极板', '粒子束', '荧光屏']],
    'electricity.magnetic_particle': ['磁场粒子|洛伦兹力|回旋|磁偏转|匀强磁场.{0,5}粒子', '磁感应强度|磁场强度', 'magneticField', ['磁场方向', '带电粒子', '运动轨迹']],
    'electricity.rail': ['电磁感应|导轨|导体棒|安培力', '拉力|外力', 'externalForce', ['导轨', '导体棒', '回路']],
    'electricity.generator': ['交流发电机|正弦电流|中性面|发电机', '匝数', 'turns', ['磁极', '旋转线圈', '输出电路']],
    'optics.double_slit': ['双缝|干涉|明纹|条纹|波长', '波长', 'wavelengthNm', ['入射波前', '双缝', '观察屏']],
    'mechanics.collision': ['碰撞|动量守恒|恢复系数', '碰前初速度|初速度', 'velC', ['左物块', '木板', '右物块']],
    'electricity.potential': ['电势地形|等势线|电势与场强|电势差', '电荷量', 'chargeMicroC', ['电势高低', '点电荷', '探针']],
  };

  function aliasPattern(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  }

  const unitGroups = [
    {m: 1, 米: 1, cm: 0.01, 厘米: 0.01, mm: 0.001, 毫米: 0.001, nm: 1e-9, 纳米: 1e-9},
    {kg: 1, 千克: 1, g: 0.001, 克: 0.001},
    {V: 1, 伏: 1, 伏特: 1, kV: 1000, 千伏: 1000},
    {'Ω': 1, 欧姆: 1, 'kΩ': 1000, 千欧: 1000},
    {'μC': 1e-6, 微库仑: 1e-6, C: 1, 库仑: 1},
    {'m/s': 1, '米每秒': 1, 'cm/s': 0.01, '厘米每秒': 0.01},
    {'m/s²': 1, 'm/s2': 1, '米每二次方秒': 1, '米每秒平方': 1},
    {'°': 1, 度: 1, deg: 1}, {T: 1, 特斯拉: 1}, {N: 1, 牛顿: 1}, {匝: 1}, {Hz: 1, 赫兹: 1},
  ];

  function parameterNumber(question, definition, aliases) {
    const names = aliases.filter(Boolean).map(aliasPattern).join('|');
    if (!names) return null;
    const group = unitGroups.find(units => Object.hasOwn(units, definition.unit));
    const units = Object.keys(group ?? {}).sort((a,b)=>b.length-a.length).map(aliasPattern).join('|');
    const unitToken = units ? '(' + units + ')?' : '()';
    const token = '([-+−]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?)';
    const match = question.match(new RegExp('(?:' + names + ')\\s*(?:设为|改为|为|等于|是|[:：=])?\\s*' + token + '\\s*' + unitToken))
      ?? question.match(new RegExp(token + '\\s*' + (units ? '(' + units + ')' : '()') + '\\s*(?:的)?\\s*(?:' + names + ')'));
    if (!match) return null;
    const value = Number(match[1].replace('−','-'));
    if (!Number.isFinite(value)) return null;
    return match[2] && group ? value * group[match[2]] / group[definition.unit] : value;
  }

  function plan(question, plugins) {
    const exact = plugins.filter(plugin => question.includes(plugin.metadata.name) ||
      question.includes(plugin.metadata.shortName) && plugin.metadata.shortName.length >= 3);
    const candidates = exact.length ? exact : plugins.filter(plugin =>
      scenes[plugin.metadata.id] && new RegExp(scenes[plugin.metadata.id][0]).test(question));
    // If an instruction mentions several named experiments, keep the chooser honest.
    if (candidates.length !== 1) return candidates.length > 1 ? { choices: candidates } : null;
    const plugin = candidates[0];
    const scene = scenes[plugin.metadata.id];
    if (!scene) return null;
    const parameters = {};
    for (const def of plugin.parameters) {
      const plainLabel = (def.label.match(/^[\u3400-\u9fff]+/) ?? [])[0] ?? '';
      const aliases = [def.label, plainLabel, ...(def.key === scene[2] ? scene[1].split('|') : [])];
      if (def.kind === 'number') {
        const value = parameterNumber(question, def, aliases);
        if (value !== null) parameters[def.key] = value;
      } else {
        const options = def.options.filter(option => option.label.length >= 2 && question.includes(option.label));
        if (options.length === 1) parameters[def.key] = options[0].value;
      }
    }
    return {plugin, parameters};
  }

  const answers = {
    'mechanics.inclined_plane': [/静摩擦/.source,'滑块将要沿斜面向下滑时，静摩擦沿斜面向上。先比较下滑分力与最大静摩擦力，判断能否启动。'],
    'optics.prism_dispersion': [/全反射|短波/.source,'玻璃对短波光的折射率通常更大，临界角较小。当第二界面的入射角超过该波长的临界角，对应的光就全反射。'],
    'mechanics.linear_motion': [/相邻|瞬时速度|点距/.source,'相邻两点的位移除以间隔是这段时间的平均速度。用待测点前、后等时刻的两点求平均，可近似得到中间点的瞬时速度。'],
    'mechanics.projectile': [/落地|飞行时间/.source,'平抛的竖直初速度为零，落地时间由高度和重力决定。改变水平初速度会改变射程。斜抛时还要考虑竖直初速度。'],
    'mechanics.force_composition': [/合力|分力/.source,'力有方向，要做矢量加法。保持两个分力的长度，改变夹角后看平行四边形的对角线。两力同向时，合力大小才等于两个大小之和。'],
    'mechanics.pendulum': [/简谐|小角度|摆长/.source,'摆角较小时，沿切向的恢复力近似与位移成正比，所以可以按简谐运动处理。摆长增大时，周期随摆长的平方根增大。'],
    'mechanics.hooke': [/伸长|弹力|砝码/.source,'弹性限度内，弹力等于劲度系数乘以伸长量。两弹簧的劲度系数相同时，伸长量之比等于所受拉力之比。'],
    'mechanics.circular': [/最高点|脱轨|根号|√/.source,'小球在轨道内侧经过最高点时，重力和支持力合起来提供向心力。支持力降到零时，重力刚好提供所需的向心力，临界速率是根号下 gR。'],
    'electricity.capacitor': [/充电|放电|时间常数/.source,'电容器充电时，两端电压逐渐接近电源电压，电阻分到的电压越来越小，充电电流也越来越小。时间常数等于电阻乘以电容。'],
    'electricity.point_charge': [/合场强|叠加|中点/.source,'先分别求各点电荷在探针处产生的场强，再按方向做矢量相加。电势则直接做带正负号的代数相加。'],
    'electricity.deflection': [/平抛|偏转|位移/.source,'忽略边缘效应时，板间电场力只沿垂直极板的方向。平行极板方向速度不变，垂直方向有恒定加速度，所以可以按两个分运动处理。'],
    'electricity.magnetic_particle': [/回旋|半径|螺旋|周期/.source,'回旋半径由质量、垂直磁场的速度分量、电荷量大小和磁场强度决定。垂直速度越大，半径越大。磁场越强，半径越小。'],
    'electricity.rail': [/加速|速度|电流/.source,'导体棒越快，感应电动势与电流越大，反向安培力也越大。当安培力抵消外力时，加速度趋近零。'],
    'electricity.generator': [/中性面|磁通|峰值/.source,'线圈平面垂直于磁场时处于中性面。穿过线圈的磁通量大小最大，此刻变化率为零，感应电动势也为零。'],
    'optics.double_slit': [/中央|明纹|条纹/.source,'屏中央到两缝的距离相等，程差为零。同相光在中央叠加增强，形成中央明纹。'],
    'mechanics.collision': [/动量|守恒|碰撞/.source,'碰撞时间很短，若系统受到的外力冲量可忽略，总动量近似守恒。先确定系统，再按同一正方向计算各物体的带符号动量。'],
    'electricity.potential': [/斜率|变陡|中点|Eₓ/.source,'电势沿 x 的变化率越大，场强分量 Eₓ 的绝对值越大。Eₓ 的方向是电势降低的一侧。'],
  };

  function answer(experimentId, question, plugin) {
    if (experimentId === 'electricity.potential' && /中点|中垂线|φ\s*=?\s*0/.test(question)) {
      return '等量同号电荷的连线中点，两个场强方向相反而抵消，两个电势同号相加。等量异号电荷的连线中点，电势抵消为零，两个场强同向叠加。沿异号电荷的中垂线，电势也为零，场强的大小随位置变化。';
    }
    const entry = answers[experimentId];
    if (entry && new RegExp(entry[0]).test(question)) return entry[1];
    const strip = text => text.replace(/[\s，。？?!！、]/g, '');
    const key = strip(question);
    if (!key) return '';
    const topic = plugin?.teaching?.topics?.find(item =>
      strip(item.title) === key || item.questions?.some(value => strip(value) === key));
    return topic?.hints?.findLast(hint => !hint.includes('{{')) ?? '';
  }

  globalThis.PhysicsClassroom = {
    plan, answer,
    legend(id) { return scenes[id]?.[3] ?? []; },
    primary(id) { return scenes[id]?.[2]; },
  };
})();
