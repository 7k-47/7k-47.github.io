const digits = '零一二三四五六七八九';
const superscripts = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const subscripts = '₀₁₂₃₄₅₆₇₈₉';

const units = {
  'm/s²': '米每二次方秒', 'm/s^2': '米每二次方秒', 'm/s^{2}': '米每二次方秒',
  'm/s': '米每秒', 'cm/s': '厘米每秒', 'km/h': '千米每小时',
  'rad/s': '弧度每秒', 'N/kg': '牛顿每千克', 'N/m': '牛顿每米',
  'm²': '平方米', 'm^2': '平方米', 'm³': '立方米', 'm^3': '立方米',
  'cm²': '平方厘米', 'cm^2': '平方厘米', 'cm³': '立方厘米', 'cm^3': '立方厘米',
  nm: '纳米', 'μm': '微米', mm: '毫米', cm: '厘米', m: '米', km: '千米',
  'μs': '微秒', ms: '毫秒', s: '秒', min: '分钟', h: '小时',
  mg: '毫克', g: '克', kg: '千克', rad: '弧度',
  Hz: '赫兹', kHz: '千赫兹', MHz: '兆赫兹',
  kV: '千伏', mV: '毫伏', V: '伏特', mA: '毫安', A: '安培', C: '库仑',
  'kΩ': '千欧', 'Ω': '欧姆', 'μF': '微法', F: '法拉',
  N: '牛顿', J: '焦耳', W: '瓦特', Pa: '帕斯卡', kPa: '千帕', T: '特斯拉',
};

const unitPattern = new RegExp('(\\d\\}?)[ \\t]*(' + Object.keys(units)
  .sort((left, right) => right.length - left.length)
  .map(unit => unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\w\\/^²³])', 'g');

const latexSymbols = {
  pi: 'π', theta: 'θ', mu: 'μ', lambda: 'λ', omega: 'ω', Delta: 'Δ', delta: 'δ',
  alpha: 'α', beta: 'β', gamma: 'γ', rho: 'ρ', phi: 'φ', varphi: 'φ', Phi: 'Φ',
  approx: '≈', sim: '∼', propto: '∝', times: '×', cdot: '⋅', div: '÷', pm: '±', mp: '∓',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', to: '→', rightarrow: '→',
  circ: '°', degree: '°', sin: '正弦', cos: '余弦', tan: '正切', ln: '自然对数', log: '对数',
  left: '', right: '', quad: '，', qquad: '，',
};

function exponentWords(exponent) {
  if (exponent === '2') return '的平方';
  if (exponent === '3') return '的立方';
  return '的' + exponent.replace(/^[-−]/, '负').replace(/^\+/, '正') + '次方';
}

function operandWords(operand) {
  const value = operand.trim();
  return /[+−=≈<>]|\s-\s/.test(value) ? '括号内' + value + '，括号结束' : value;
}

function formatKnownMath(text) {
  let result = text
    .replace(/\\(?:begin|end)\{(?:align\*?|equation\*?|gather\*?|cases)\}/g, ' ')
    .replace(/\\(?:mathrm|text|operatorname|textnormal)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\([A-Za-z]+)/g, (command, name) => Object.hasOwn(latexSymbols, name) ? latexSymbols[name] : command)
    .replace(/\\(?:[,;:!]| |\n)/g, ' ')
    .replace(/\\\\/g, '。')
    .replace(/\\([%_&#])/g, '$1')
    .replace(/\^\s*(?:\{\s*°\s*\}|°)/g, '°')
    .replace(/(?<=[\u3400-\u9fff])([ \t]+)([-−+])[ \t]*(?=\d)/g,
      (_, spacing, sign) => spacing + (sign === '+' ? '正' : '负'))
    .replace(/µ/g, 'μ')
    .replace(/m\s*(?:[·⋅]\s*|\s+)s(?:⁻²|\^\{?\s*[-−]2\s*\}?)/g, 'm/s²')
    .replace(/m\s*(?:[·⋅]\s*|\s+)s(?:⁻¹|\^\{?\s*[-−]1\s*\}?)/g, 'm/s')
    .replace(/(\d)\s*\\(?:[cdt])?frac\s*\{m\}\s*\{s\s*\^\s*(?:2|\{2\})\}/g, '$1米每二次方秒')
    .replace(unitPattern, (_, number, unit) => number + units[unit])
    .replace(/\bT(?:²|\^\{?2\}?)\s*[-–—]\s*L\b/g, 'T的平方与L')
    .replace(/\^\s*(?:\{\s*([+−-]?\d+)\s*\}|([+−-]?\d+))/g, (_, grouped, simple) => exponentWords(grouped ?? simple))
    .replace(/[⁺⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, exponent => exponentWords(Array.from(exponent, letter => {
      if (letter === '⁺') return '+';
      if (letter === '⁻') return '-';
      return String(superscripts.indexOf(letter));
    }).join('')));

  // Resolve the small set of structured expressions used in the tutor's formulas.
  for (let pass = 0; pass < 3; pass += 1) {
    const next = result
      .replace(/\\(?:[cdt])?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,
        (_, numerator, denominator) => /^\d+$/.test(numerator) && /^\d+$/.test(denominator)
          ? denominator + '分之' + numerator : operandWords(numerator) + '除以' + operandWords(denominator))
      .replace(/(?:\\sqrt\s*\{([^{}]+)\}|√\s*\(([^()]+)\)|√\s*([A-Za-z\d]+))/g,
        (_, latex, grouped, single) => '根号下，' + (latex ?? grouped ?? single).trim() + '，根号结束');
    if (next === result) break;
    result = next;
  }

  return result
    .replace(/θ\s*(?:₀|_\s*\{?0\}?)/g, '初始摆角')
    .replace(/μ\s*(?:_\{?s\}?|ₛ)/g, '静摩擦系数')
    .replace(/μ\s*(?:_\{?k\}?|ₖ)/g, '动摩擦系数')
    .replace(/\b([vt])_\s*(?:\{end\}|end\b)/g, (_, variable) => variable === 'v' ? '末速度' : '结束时间')
    .replace(/[₀₁₂₃₄₅₆₇₈₉]+/g, subscript => '下标' + Array.from(subscript, letter => digits[subscripts.indexOf(letter)]).join(''))
    .replace(/(\d)\s*(?=(?:mg|ma|mv)(?:\b|_)|at的)/g, '$1乘以')
    .replace(/\b(?:mg|ma|mv)(?=\b|_)|\bat(?=的)/g, product => product[0] + '乘以' + product[1])
    .replace(/(?<![A-Za-z\d])([A-Za-zα-ω])_\{?([\da-z]+)\}?/g, '$1下标$2')
    .replace(/(\d+(?:\.\d+)?)[eE]([+-]?\d+)(?![\d.])/g, (_, coefficient, exponent) => coefficient + '乘以10' + exponentWords(exponent))
    .replace(/(\d)\s*(?=π)/g, '$1乘以')
    .replace(/π(的平方|的立方)?\s*(?=根号下|[A-Za-z]\b)/g, 'π$1乘以')
    .replace(/\b(sin|cos|tan)\s*(?=θ|\(|[A-Za-z]\b)/g, name => latexSymbols[name])
    .replace(/([\dA-Za-z])\s*(?=正弦|余弦|正切)/g, '$1乘以')
    .replace(/(\d)\s*[~～–—]\s*(?=\d)/g, '$1到')
    .replace(/(^|[=≈<>≤≥±+×÷:：，,、（(|｜]|[是为约达])([ \t]*)([-−+])[ \t]*(?=\d|[A-Za-zα-ω])/gm,
      (_, prefix, spacing, sign) => prefix + spacing + (sign === '+' ? '正' : '负'))
    .replace(/([α-ω])\s*-\s*(?=[\dA-Za-z(α-ω]|[静动]摩擦系数)/g, '$1减去')
    .replace(/[πθμλωΔδαβγρφΦ]/g, letter => ({
      π: '派', θ: '西塔', μ: '缪', λ: '拉姆达', ω: '欧米伽', Δ: '德尔塔', δ: '德尔塔',
      α: '阿尔法', β: '贝塔', γ: '伽马', ρ: '柔', φ: '斐', Φ: '斐',
    })[letter])
    .replace(/([\dA-Za-z)])\s*\/\s*(?=[\dA-Za-z(])/g, '$1除以')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '百分之$1')
    .replace(/(\d+)\.(\d+)/g, (_, whole, tail) => (whole === '0' ? '零' : whole) + '点' +
      Array.from(tail, digit => digits[Number(digit)]).join(''))
    .replace(/(\d|[零一二三四五六七八九])\s*°\s*C\b/g, '$1摄氏度')
    .replace(/℃/g, '摄氏度').replace(/°/g, '度')
    .replace(/\s*(<=|>=|!=|[=≈∼≠≤≥<>±∓×÷+−→∝])\s*/g, (_, operator) => ({
      '=': '等于', '≈': '约等于', '∼': '近似于', '≠': '不等于', '!=': '不等于',
      '<': '小于', '>': '大于', '<=': '小于等于', '>=': '大于等于', '≤': '小于等于', '≥': '大于等于',
      '±': '正负', '∓': '负正', '×': '乘以', '÷': '除以', '+': '加', '−': '减去', '→': '变为', '∝': '正比于',
    })[operator])
    .replace(/([\dA-Za-z²³)])\s*[·⋅*]\s*(?=[\dA-Za-z(])/g, '$1乘以')
    .replace(/(\d|\)|的平方|的立方)\s*-\s*(?=[\dA-Za-z(])/g, '$1减去')
    .replace(/\b([A-Za-z])\s*-\s*(?=\d|\(|[A-Za-z]\b)/g, '$1减去');
}

export function formatTutorSpeech(text) {
  const prose = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*```[^\n]*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/[^\s，。；）)]+/g, '')
    .replace(/^[ \t]*(?:#{1,6}|>|[-+*])[ \t]+/gm, '')
    .replace(/^[ \t]*(?:---+|___+|\*\*\*+)[ \t]*$/gm, '')
    .replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*(?:[ \t]*:?-{3,}:?)?[ \t]*$/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '$1')
    .replace(/\\[()[\]]|[`$]/g, '');

  return formatKnownMath(prose)
    .replace(/，根号结束(?=$|[ \t]*[。！？；\n])/g, '')
    .replace(/^[ \t]*\|[ \t]*|[ \t]*\|[ \t]*$/gm, '')
    .replace(/[ \t]*[|｜·⋅][ \t]*/g, '，')
    .replace(/(^|\n)[ \t]*(\d+)[.)、][ \t]+/g, '$1第$2点，')
    .replace(/[ \t]*(?:\n[ \t]*)+/g, '。')
    .replace(/([。！？；])[。，]+/g, '$1')
    .replace(/，。/g, '。')
    .replace(/([，；：])[ \t]*\1+/g, '$1')
    .replace(/[ \t]+([，。！？；：])/g, '$1')
    .replace(/^[\s，。]+|[\s，]+$/g, '');
}
