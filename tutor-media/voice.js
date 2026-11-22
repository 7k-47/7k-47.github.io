const MANDARIN = 'zh-CN';

const recognitionErrors = {
  'not-allowed': '无法使用麦克风。请检查浏览器权限，或直接输入文字。',
  'service-not-allowed': '浏览器未允许语音识别服务，请直接输入文字。',
  'audio-capture': '没有可用的麦克风，请检查设备，或直接输入文字。',
  'network': '语音识别服务暂时无法连接，请重试或直接输入文字。',
  'no-speech': '刚才没有听清。可以再说一次，或直接输入文字。',
  'language-not-supported': '当前浏览器的识别服务不支持普通话，请直接输入文字。',
  'aborted': '语音输入已结束，可以继续输入文字。',
};

const PREMIUM_VOICE = /natural|neural|premium|enhanced|自然语音|优质|高质量|增强/i;
const COMPACT_VOICE = /compact|eloquence/i;
const PREFERRED_NATURAL_VOICE = /晓晓|xiaoxiao/i;

function localeOf(voice) {
  return voice.lang.toLowerCase().replaceAll('_', '-');
}

function getMandarinVoices(synthesis) {
  return synthesis.getVoices().filter(voice => {
    const locale = localeOf(voice);
    return /^(zh|cmn)(?:-|$)/.test(locale) && !locale.split('-').includes('hk') && !locale.includes('yue');
  }).sort((a, b) => voiceRank(b) - voiceRank(a));
}

function voiceIdentity(voice) {
  return voice.voiceURI + ' ' + voice.name;
}

function voiceRank(voice) {
  const identity = voiceIdentity(voice);
  const nativeQuality = PREMIUM_VOICE.test(identity);
  const mainland = ['zh-cn', 'zh-hans-cn', 'cmn-cn'].includes(localeOf(voice));
  return (nativeQuality ? 100 : 0) + (voice.localService ? 20 : 0) + (mainland ? 10 : 0) +
    (nativeQuality && PREFERRED_NATURAL_VOICE.test(identity) ? 3 : 0) +
    (voice.default ? 1 : 0) - (COMPACT_VOICE.test(identity) ? 4 : 0);
}

const MATH_CHARACTER = /[A-Za-z0-9.,+−\-×÷/^²³⁰¹⁴⁵⁶⁷⁸⁹⁺⁻零一二三四五六七八九十百千万亿点]/;

function canSplitSpeech(text, index) {
  return !/[\uDC00-\uDFFF]/.test(text[index]) &&
    !(MATH_CHARACTER.test(text[index - 1]) && MATH_CHARACTER.test(text[index]));
}

function splitLongSentence(sentence, limit, words) {
  const sections = [];
  let remaining = sentence.trim();
  while (remaining.length > limit) {
    let boundary = limit;
    while (boundary > limit / 2 && (!/[，、；：,;:]/.test(remaining[boundary - 1]) ||
        !canSplitSpeech(remaining, boundary))) boundary -= 1;
    if (boundary <= limit / 2) {
      boundary = 0;
      if (words) {
        for (const {index} of words.segment(remaining)) {
          if (index > limit) break;
          if (index && canSplitSpeech(remaining, index)) boundary = index;
        }
      }
      if (boundary <= limit / 2) {
        boundary = limit;
        while (boundary > 0 && !canSplitSpeech(remaining, boundary)) boundary -= 1;
      }
      if (!boundary) {
        // Let an indivisible literal stay together even when it crosses the limit.
        boundary = limit + 1;
        while (boundary < remaining.length && !canSplitSpeech(remaining, boundary)) boundary += 1;
      }
    }
    sections.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) sections.push(remaining);
  return sections;
}

function speechSections(text, online) {
  const sections = [];
  const paragraphs = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
  // Short online sections can add a fresh synthesis delay to each paragraph.
  const blocks = online
    ? [paragraphs.map(line => /[。！？.!?；;，,：:]$/.test(line) ? line : line + '。').join(' ')]
    : paragraphs;
  const maxLength = online ? 420 : 120;
  const sentences = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(MANDARIN, {granularity: 'sentence'}) : null;
  const words = sentences && new Intl.Segmenter(MANDARIN, {granularity: 'word'});
  for (const block of blocks) {
    if (block.length <= maxLength) {
      sections.push(block);
      continue;
    }
    let section = '';
    const segments = sentences?.segment(block) ?? [{segment: block}];
    for (const {segment} of segments) {
      if (segment.length > maxLength) {
        if (section.trim()) sections.push(section.trim());
        sections.push(...splitLongSentence(segment, maxLength, words));
        section = '';
      } else {
        if (section && section.length + segment.length > maxLength) {
          sections.push(section.trim());
          section = '';
        }
        section += segment;
      }
    }
    if (section.trim()) sections.push(section.trim());
  }
  return sections;
}

export function createTutorVoice({
  onTranscript = () => {},
  onStatus = () => {},
  onListeningChange = () => {},
  onSpeakingChange = () => {},
  onVoicesChange = () => {},
  preferredVoice = () => '',
} = {}) {
  const browser = globalThis.window ?? globalThis;
  const Recognition = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  const synthesis = browser.speechSynthesis;
  const Utterance = browser.SpeechSynthesisUtterance;
  const capabilities = Object.freeze({
    recognition: typeof Recognition === 'function' && browser.isSecureContext !== false,
    synthesis: Boolean(synthesis && typeof Utterance === 'function'),
  });

  let disposed = false;
  let listening = null;
  let speaking = null;

  function refreshVoices() {
    onVoicesChange(capabilities.synthesis ? getMandarinVoices(synthesis) : []);
  }
  refreshVoices();
  synthesis?.addEventListener?.('voiceschanged', refreshVoices);

  function abortRecognition(recognition) {
    try {
      recognition.abort();
    } catch {
      // A browser can close the session before the abort arrives.
    }
  }

  function finishListening(session, status) {
    if (listening !== session) return false;
    listening = null;
    clearTimeout(session.stopTimer);
    onListeningChange(false);
    onStatus(status);
    return true;
  }

  function cancelListening() {
    const session = listening;
    if (!session) return false;
    finishListening(session, '');
    abortRecognition(session.recognition);
    return true;
  }

  function startListening() {
    if (disposed || listening) return false;
    if (!capabilities.recognition) {
      onStatus('当前浏览器或页面不支持语音输入，请直接输入文字。');
      return false;
    }

    stopSpeaking();
    let recognition;
    try {
      recognition = new Recognition();
      recognition.lang = MANDARIN;
      recognition.continuous = false;
      recognition.interimResults = false;
    } catch {
      onStatus('无法启动语音识别，请重试或直接输入文字。');
      return false;
    }

    const session = { recognition, phase: 'starting', transcriptReceived: false, stopTimer: null };
    listening = session;
    recognition.onstart = () => {
      if (listening !== session) {
        abortRecognition(recognition);
        return;
      }
      session.phase = 'listening';
      onStatus('正在听，点一下结束。');
    };
    recognition.onresult = (event) => {
      if (listening !== session) return;
      const segments = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) segments.push(result[0].transcript);
      }
      const transcript = segments.join('').trim();
      if (!transcript) return;
      session.transcriptReceived = true;
      onTranscript(transcript);
    };
    recognition.onerror = (event) => {
      const status = recognitionErrors[event.error] ?? '语音识别失败，请重试或直接输入文字。';
      finishListening(session, status);
    };
    recognition.onend = () => {
      const status = session.transcriptReceived
        ? '语音已填入草稿，可以修改后发送。'
        : recognitionErrors['no-speech'];
      finishListening(session, status);
    };

    onListeningChange(true);
    onStatus('正在启动麦克风。浏览器可能使用在线识别。');
    try {
      recognition.start();
      return true;
    } catch {
      finishListening(session, '无法启动语音识别，请重试或直接输入文字。');
      return false;
    }
  }

  function stopListening() {
    const session = listening;
    if (!session || session.phase === 'stopping') return false;
    if (session.phase === 'starting') return cancelListening();

    session.phase = 'stopping';
    onStatus('正在完成转写…');
    session.stopTimer = setTimeout(() => {
      const status = session.transcriptReceived
        ? '语音已填入草稿，可以修改后发送。'
        : '语音识别响应超时，请重试或直接输入文字。';
      if (finishListening(session, status)) abortRecognition(session.recognition);
    }, 5000);
    try {
      session.recognition.stop();
    } catch {
      if (finishListening(session, '语音输入已结束，可以继续输入文字。')) {
        abortRecognition(session.recognition);
      }
    }
    return true;
  }

  function toggleListening() {
    return listening ? stopListening() : startListening();
  }

  function finishSpeaking(session) {
    if (speaking !== session) return false;
    speaking = null;
    clearTimeout(session.pause);
    onSpeakingChange(null);
    return true;
  }

  function stopSpeaking() {
    const session = speaking;
    if (!session || !finishSpeaking(session)) return false;
    synthesis.cancel();
    onStatus('');
    return true;
  }

  function playSection(session) {
    if (speaking !== session) return false;
    try {
      const text = session.sections[session.index];
      const utterance = new Utterance(text);
      session.utterance = utterance;
      utterance.lang = session.voice?.lang || MANDARIN;
      if (session.voice) utterance.voice = session.voice;
      utterance.rate = session.voice && PREMIUM_VOICE.test(voiceIdentity(session.voice)) ? 0.98 : 0.94;
      let started = false;
      if (session.voice?.localService === false) onStatus('正在准备自然播报…');
      utterance.onstart = () => {
        if (speaking !== session || session.utterance !== utterance) return;
        started = true;
        if (session.voice?.localService === false) onStatus('');
      };
      utterance.onend = () => {
        if (speaking !== session || session.utterance !== utterance) return;
        session.utterance = null;
        session.index += 1;
        if (session.index === session.sections.length) {
          finishSpeaking(session);
          return;
        }
        const pause = /[？?]$/.test(text) ? 210 : 140;
        session.pause = setTimeout(() => playSection(session), pause);
      };
      utterance.onerror = event => {
        if (speaking !== session || session.utterance !== utterance) return;
        if (event.error === 'canceled' || event.error === 'interrupted') {
          finishSpeaking(session);
          onStatus('');
          return;
        }
        if (!started && session.localFallback) {
          session.voice = session.localFallback;
          session.localFallback = null;
          onStatus('在线音色暂不可用，改用本机语音继续。');
          playSection(session);
          return;
        }
        finishSpeaking(session);
        onStatus('这一段没能播出来。可以换一个音色，或直接看文字。');
      };
      synthesis.speak(utterance);
      return true;
    } catch {
      finishSpeaking(session);
      onStatus('语音播报暂时无法启动，可以阅读文字回复。');
      return false;
    }
  }

  function speak(messageId, text) {
    if (disposed || !text.trim()) return false;
    if (!capabilities.synthesis) {
      onStatus('当前浏览器不支持语音播报，可以阅读文字回复。');
      return false;
    }
    if (listening) {
      onStatus('请先结束语音输入，再播放导师回复。');
      return false;
    }

    stopSpeaking();
    const voices = getMandarinVoices(synthesis);
    const uri = preferredVoice();
    const voice = voices.find(item => item.voiceURI === uri) ?? voices[0];
    const online = voice?.localService === false;
    const session = {
      id: messageId,
      voice,
      localFallback: online ? voices.find(item => item.localService) : null,
      sections: speechSections(text, online),
      index: 0,
      utterance: null,
      pause: null,
    };
    speaking = session;
    onStatus('');
    onSpeakingChange(messageId);
    return playSection(session);
  }

  function toggleSpeaking(messageId, text) {
    return speaking?.id === messageId ? stopSpeaking() : speak(messageId, text);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    synthesis?.removeEventListener?.('voiceschanged', refreshVoices);
    cancelListening();
    stopSpeaking();
  }

  return {
    capabilities,
    startListening,
    stopListening,
    cancelListening,
    toggleListening,
    speak,
    stopSpeaking,
    toggleSpeaking,
    dispose,
  };
}
