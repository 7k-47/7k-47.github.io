import {createTutorVoice} from './voice.js?v=classroom-tools';
import {NATURAL_VOICE} from './neural-voice.js';
import {formatTutorSpeech} from './spoken-text.js';
import {
  PHOTO_ACCEPT, normalizeVisionEndpoint, preparePhoto, recognizeExperimentPhoto, recognizePendulumPhoto, releasePhoto,
} from './photo.js?v=classroom-tools';
import {createInquiryGuide} from './guide.js?v=classroom';
import {PENDULUM, inquiryFor, photoDescription, photoFieldsFor} from './inquiries.js?v=classroom';

let visionProfile = null;

const VOICE_PREFERENCE = 'physics-lab.tutor-voice';
const VOICE_SAMPLE = '先别急着下结论。我们一起看看这两次记录，找出是哪一个条件变了。';

function readVoicePreference() {
  try { return localStorage.getItem(VOICE_PREFERENCE) ?? ''; }
  catch { return ''; }
}

function readPreference() {
  try { return localStorage.getItem('physics-lab.tutor-guided') !== '0'; }
  catch { return true; }
}

export function createTutorSession({h, ref, watch, experiment, records, lesson, draft, byokVision, openClassroom}) {
  const guided = ref(readPreference());
  const listening = ref(false);
  const speaking = ref(null);
  const voiceStatus = ref('');
  const voiceList = ref([]);
  const voicePreference = ref(readVoicePreference());
  const photo = ref(null);
  const photoStatus = ref('');
  const photoError = ref(false);
  const busy = ref(false);
  const readings = ref({});
  const notes = ref([]);
  const newEvidence = ref('');
  const attached = ref(null);
  const configured = byokVision();
  const profile = ref(visionProfile ?? configured ?? {endpoint: '', model: '', apiKey: ''});
  let preprocessing = null;
  let request = null;

  const voice = createTutorVoice({
    onTranscript(transcript) {
      const previous = draft.value;
      draft.value = (previous + (previous && !/\s$/.test(previous) ? ' ' : '') + transcript).slice(0, 2000);
    },
    onStatus(message) { voiceStatus.value = message; },
    onListeningChange(value) { listening.value = value; },
    onSpeakingChange(id) { speaking.value = id; },
    onVoicesChange(voices) { voiceList.value = voices; },
    preferredVoice: () => voicePreference.value,
  });

  const button = (label, onClick, attributes = {}) =>
    h('button', {type: 'button', class: 'btn sm', onClick, ...attributes}, label);

  function speak(id, message) {
    if (!voice.capabilities.synthesis || !message) return null;
    const playing = speaking.value === id;
    return button(playing ? '停止播报' : '播放讲解',
      () => voice.toggleSpeaking(id, formatTutorSpeech(message)), {'aria-pressed': playing});
  }

  function setStatus(message, error = false) {
    photoStatus.value = message;
    photoError.value = error;
  }

  function clearPhoto() {
    preprocessing?.abort();
    request?.abort();
    preprocessing = null;
    request = null;
    busy.value = false;
    if (photo.value) releasePhoto(photo.value);
    photo.value = null;
    readings.value = Object.fromEntries(photoFieldsFor(experiment).map(field => [field.key, '']));
    notes.value = [];
    setStatus('');
  }

  const guide = createInquiryGuide({h, ref, watch, experiment, records, lesson, speak, openClassroom});

  const stop = watch(() => experiment.experimentId, () => {
    voice.cancelListening();
    voice.stopSpeaking();
    voiceStatus.value = '';
    clearPhoto();
    newEvidence.value = '';
    attached.value = null;
    guide.resetView();
  });

  async function pickPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    clearPhoto();
    attached.value = null;
    newEvidence.value = '';
    const operation = new AbortController();
    preprocessing = operation;
    setStatus('正在准备照片…');
    try {
      const prepared = await preparePhoto(file, {signal: operation.signal});
      if (preprocessing !== operation) {
        releasePhoto(prepared);
        return;
      }
      photo.value = prepared;
      setStatus('可以在本机自动识读，也可以对照照片直接填写。');
    } catch (error) {
      if (preprocessing === operation) setStatus(error.message, true);
    } finally {
      if (preprocessing === operation) preprocessing = null;
    }
  }

  async function recognize(local) {
    if (!photo.value || busy.value) return;
    let endpoint;
    if (!local) try {
      endpoint = normalizeVisionEndpoint(profile.value.endpoint);
      if (!profile.value.model.trim()) throw new Error('请填写支持图片的模型名称。');
    } catch (error) {
      setStatus(error.message, true);
      return;
    }
    const operation = new AbortController();
    request = operation;
    busy.value = true;
    setStatus('正在识读照片…');
    try {
      const fields = photoFieldsFor(experiment);
      let result;
      if (local) {
        const {recognizeLocalPhoto}=await import('./local-ocr.js');
        result=await recognizeLocalPhoto(photo.value,fields,{
          signal:operation.signal,
          onProgress(stage,progress){
            if(request===operation&&stage==='recognizing text') setStatus('正在本机识读照片 '+Math.round(progress*100)+'%');
          },
        });
      } else {
        const configuration={endpoint,model:profile.value.model.trim(),apiKey:profile.value.apiKey.trim()};
        visionProfile={...profile.value};
        const options={...configuration,signal:operation.signal};
        result=experiment.experimentId===PENDULUM
          ? await recognizePendulumPhoto(photo.value,options)
          : await recognizeExperimentPhoto(photo.value,{...options,fields,experimentName:experiment.plugin.metadata.name});
      }
      if (request !== operation) return;
      const candidates = Object.fromEntries(fields.map(({key}) => [key, result[key] == null ? '' : String(result[key])]));
      readings.value = {...candidates, ...Object.fromEntries(Object.entries(readings.value).filter(([, value]) => value !== ''))};
      notes.value = result.notes;
      setStatus(local&&result.count===0?'本次没有读到可填写的数值。可以裁切到一条清晰记录重试。':
        '请对照原图核对或补齐读数，再确认关联。');
    } catch (error) {
      if (request === operation) setStatus(error.message + ' 你仍可手动填写读数。', true);
    } finally {
      if (request === operation) {
        request = null;
        busy.value = false;
      }
    }
  }

  function confirmPhoto() {
    if (!photo.value || busy.value) return;
    const fields = photoFieldsFor(experiment);
    const verified = {};
    for (const field of fields) {
      const input = String(readings.value[field.key] ?? '').trim();
      const value = input ? Number(input) : null;
      if ((value === null && field.required) || (value !== null &&
          (!Number.isFinite(value) || (field.min !== undefined && value < field.min) ||
           (field.max !== undefined && value > field.max) || (field.integer && !Number.isInteger(value))))) {
        setStatus('请核对「' + field.label + '」的读数。', true);
        return;
      }
      verified[field.key] = value;
    }
    if (!guide.addPhoto(verified)) return;
    newEvidence.value = '学生核对的「' + experiment.plugin.metadata.name + '」照片读数：' +
      photoDescription(fields, verified) + '。';
    attached.value = verified;
    clearPhoto();
    setStatus('照片读数已关联到当前实验的报告。');
  }

  function imagePicker(label, capture) {
    return h('label', {class: 'btn sm tutor-file'}, [
      h('span', null, label),
      h('input', {
        type: 'file', accept: capture ? 'image/*' : PHOTO_ACCEPT, capture, 'aria-label': label,
        onChange: pickPhoto,
      }),
    ]);
  }

  function photoReview() {
    if (!photo.value) return null;
    return h('section', {class: 'tutor-attachment', 'aria-label': '核对实验照片'}, [
      h('div', {class: 'tutor-guide-stage'}, '核对照片读数'),
      h('img', {src: photo.value.previewUrl, alt: '待核对的实验记录照片'}),
      h('div', {class:'tutor-guide-actions'}, [
        button(busy.value?'正在识读…':'本机自动识读',()=>recognize(true),{disabled:busy.value}),
        h('p',{class:'tutor-status'},'清晰印刷记录效果最佳。照片在本机处理。'),
      ]),
      h('div', {class: 'tutor-photo-fields'}, photoFieldsFor(experiment).map(field =>
        h('label', {key: field.key}, [
          field.label + (field.unit ? '（' + field.unit + '）' : '') + (field.required ? '' : ' · 选填'),
          h('input', {
            class: 'input', type: 'number', inputmode: field.integer ? 'numeric' : 'decimal',
            min: field.min, max: field.max, step: field.integer ? 1 : 'any', value: readings.value[field.key],
            'aria-required': field.required || undefined, disabled: busy.value,
            onInput: event => { readings.value[field.key] = event.target.value; },
          }),
        ]))),
      ...notes.value.map(note => h('p', {class: 'tutor-status'}, note)),
      h('details', {class: 'tutor-vision-settings'}, [
        h('summary', null, '使用视觉模型识读照片'),
        h('p', {class: 'tutor-status'}, '填写支持图片的 Chat Completions 服务。点「发送照片识读」才会把照片发往该地址。'),
        h('div', {class: 'tutor-photo-fields'}, [
          ['endpoint', '服务地址', 'url', 'https://…/v1'],
          ['model', '模型名称', 'text', '填入支持图片的模型'],
          ['apiKey', 'API Key（服务需要时）', 'password', '仅本次页面会话使用'],
        ].map(([key, label, type, placeholder]) => h('label', {key}, [
          label,
          h('input', {
            class: 'input', type, placeholder, value: profile.value[key], disabled: busy.value,
            autocomplete: 'off', spellcheck: false,
            onInput: event => { profile.value = {...profile.value, [key]: event.target.value}; },
          }),
        ]))),
        button(busy.value ? '正在识读…' : '发送照片识读', () => recognize(false), {disabled: busy.value}),
      ]),
      h('div', {class: 'tutor-guide-actions'}, [
        button('确认并关联', confirmPhoto, {class: 'btn sm primary', disabled: busy.value}),
        button('移除照片', clearPhoto),
      ]),
    ]);
  }

  function renderGuide() {
    if (!inquiryFor(experiment.experimentId)) return null;
    return h('div', {class: 'tutor-guide-wrap'}, [
      h('div', {class: 'tutor-guide-actions tutor-mode', role: 'group', 'aria-label': '导师模式'}, [
        button('随实验引导', () => changeMode(true), {'aria-pressed': guided.value}),
        button('仅答疑', () => changeMode(false), {'aria-pressed': !guided.value}),
      ]),
      guided.value ? guide.render() : null,
    ]);
  }

  function changeMode(value) {
    guided.value = value;
    voice.stopSpeaking();
    try { localStorage.setItem('physics-lab.tutor-guided', value ? '1' : '0'); } catch {}
  }

  function renderVoiceSettings() {
    if (!voiceList.value.length&&!voice.capabilities.neural) return null;
    const voices = voiceList.value;
    const selected = voices.find(item => item.voiceURI === voicePreference.value);
    const current = selected ?? voices[0];
    const isNatural=voice.capabilities.neural&&!selected;
    const voiceName = item => item.name.replace(/^Microsoft\s+|\s+Online \(Natural\).*$/g, '');
    const previewing = speaking.value === 'tutor-voice-preview';
    return h('details', {class: 'tutor-voice-settings'}, [
      h('summary', null, '播报音色 · ' + (isNatural?'普通话自然音色':voiceName(current)+(current.localService?'':'（在线）'))),
      h('div', {class: 'tutor-media-actions'}, [
        h('select', {
          'aria-label': '选择导师播报音色',
          value: isNatural?NATURAL_VOICE:selected?.voiceURI??'',
          onChange: event => {
            voice.stopSpeaking();
            voicePreference.value = event.target.value;
            try { localStorage.setItem(VOICE_PREFERENCE, voicePreference.value); } catch {}
          },
        }, [
          voice.capabilities.neural?h('option',{value:NATURAL_VOICE},'普通话自然音色（本机合成）'):h('option',{value:''},'自动选择'),
          ...voices.map(item => h('option', {key: item.voiceURI, value: item.voiceURI},
            voiceName(item) + (item.localService ? '' : '（在线）'))),
        ]),
        button(previewing ? '停止试听' : '试听音色', () => voice.toggleSpeaking('tutor-voice-preview', VOICE_SAMPLE),
          {'aria-pressed': previewing}),
      ]),
      isNatural?h('p',{class:'tutor-status'},'首次需下载约 90 MB 的音色文件，讲解文字在本机合成。'):
        !current.localService?h('p',{class:'tutor-status'},'点击播放后，讲解文字由浏览器的在线语音服务合成。'):null,
    ]);
  }

  function renderMedia() {
    const hasInquiry = Boolean(inquiryFor(experiment.experimentId));
    return h('div', {class: 'tutor-media'}, [
      h('div', {class: 'tutor-media-actions'}, [
        button(listening.value ? '结束录音' : '语音提问', voice.toggleListening,
          {'aria-pressed': listening.value, title: '语音由浏览器处理，转写后可编辑'}),
        hasInquiry ? imagePicker('拍照', 'environment') : null,
        hasInquiry ? imagePicker('上传照片') : null,
      ]),
      renderVoiceSettings(),
      voiceStatus.value ? h('p', {class: 'tutor-status', role: 'status'}, voiceStatus.value) : null,
      photoReview(),
      photoStatus.value ? h('p', {
        class: ['tutor-status', {'tutor-error': photoError.value}],
        role: photoError.value ? 'alert' : 'status',
      }, photoStatus.value) : null,
      attached.value ? h('div', {class: 'tutor-media-actions'}, [
        h('span', {class: 'tutor-status'}, '已为下一条提问附上核对后的读数'),
        button('取消附带', () => { newEvidence.value = ''; attached.value = null; }),
      ]) : null,
    ]);
  }

  function takeContext() {
    const evidence = newEvidence.value;
    newEvidence.value = '';
    attached.value = null;
    return evidence;
  }

  function dispose() {
    stop();
    guide.dispose();
    voice.dispose();
    clearPhoto();
  }

  return {renderMedia, renderGuide, speak, takeContext, isGuided: () => guided.value && Boolean(inquiryFor(experiment.experimentId)), isListening: () => listening.value, dispose};
}
