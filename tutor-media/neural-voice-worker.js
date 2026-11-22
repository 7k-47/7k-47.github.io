const cdn='https://cdn.jsdelivr.net/npm/';
const ortBase=cdn+'onnxruntime-web@1.18.0/';
const phonemizer=cdn+'@diffusionstudio/vits-web@1.0.3/dist/piper-DeOu3H9E.js/+esm';
const phonemizerData=cdn+'@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
const voice='https://huggingface.co/rhasspy/piper-voices/resolve/9b2a7bdd829bc1bf446ccbef7fe6e57358de9b7d/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx';
let engine;

async function fetchAsset(url,report){
  const cache=await self.caches?.open('physics-natural-voice-v1').catch(()=>null);
  const saved=await cache?.match(url);
  if(saved)return saved.arrayBuffer();
  const response=await fetch(url);
  if(!response.ok)throw new Error('音色文件无法下载。');
  if(!report||!response.body)return response.arrayBuffer();
  const length=Number(response.headers.get('content-length'))||63201294;
  const stream=response.body.getReader();
  const chunks=[];
  let loaded=0;
  let previous=-1;
  while(true){
    const {done,value}=await stream.read();
    if(done)break;
    chunks.push(value);
    loaded+=value.byteLength;
    const progress=Math.min(100,Math.round(loaded/length*100));
    if(progress!==previous){report(progress);previous=progress;}
  }
  const blob=new Blob(chunks);
  if(cache)await cache.put(url,new Response(blob)).catch(()=>{});
  return blob.arrayBuffer();
}

async function load(progress){
  const [ort,piper,config,weights]=await Promise.all([
    import(ortBase+'+esm'),import(phonemizer),
    fetch(voice+'.json').then(response=>{
      if(!response.ok)throw new Error('音色配置无法下载。');
      return response.json();
    }),
    fetchAsset(voice,progress),
  ]);
  ort.env.wasm.numThreads=1;
  ort.env.wasm.wasmPaths=ortBase+'dist/';
  const session=await ort.InferenceSession.create(weights,{executionProviders:['wasm']});
  return {ort,piper,config,session};
}

async function phonemes(piper,config,text){
  let sequence;
  const module=await piper.createPiperPhonemize({
    print(line){sequence=JSON.parse(line).phoneme_ids;},
    printErr(){},
    locateFile(file){
      if(file.endsWith('.wasm'))return phonemizerData+'.wasm';
      if(file.endsWith('.data'))return phonemizerData+'.data';
      return file;
    },
  });
  module.callMain(['-l',config.espeak.voice,'--input',JSON.stringify([{text}]),'--espeak_data','/espeak-ng-data']);
  if(!sequence?.length)throw new Error('没有生成普通话发音。');
  return BigInt64Array.from(sequence,BigInt);
}

function wav(samples,rate){
  const audio=new DataView(new ArrayBuffer(44+samples.length*2));
  for(const [position,label] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']]){
    for(let index=0;index<label.length;index+=1)audio.setUint8(position+index,label.charCodeAt(index));
  }
  audio.setUint32(4,audio.byteLength-8,true);
  audio.setUint32(16,16,true);
  audio.setUint16(20,1,true);
  audio.setUint16(22,1,true);
  audio.setUint32(24,rate,true);
  audio.setUint32(28,rate*2,true);
  audio.setUint16(32,2,true);
  audio.setUint16(34,16,true);
  audio.setUint32(40,samples.length*2,true);
  for(let index=0;index<samples.length;index+=1){
    audio.setInt16(44+index*2,Math.max(-32768,Math.min(32767,samples[index]*32768)),true);
  }
  return audio.buffer;
}

self.onmessage=async({data:{id,text}})=>{
  try{
    engine??=load(progress=>self.postMessage({id,progress}));
    const {ort,piper,config,session}=await engine;
    const symbols=await phonemes(piper,config,text);
    const {noise_scale,length_scale,noise_w}=config.inference;
    const {output}=await session.run({
      input:new ort.Tensor('int64',symbols,[1,symbols.length]),
      input_lengths:new ort.Tensor('int64',BigInt64Array.of(BigInt(symbols.length)),[1]),
      scales:new ort.Tensor('float32',[noise_scale,length_scale,noise_w],[3]),
    });
    const bytes=wav(output.data,config.audio.sample_rate);
    self.postMessage({id,bytes},[bytes]);
  }catch(error){
    engine=undefined;
    self.postMessage({id,error:error.message});
  }
};
