export const NATURAL_VOICE='physics-local-neural';
const AudioEngine=globalThis.AudioContext??globalThis.webkitAudioContext;
export const neuralAvailable=Boolean(AudioEngine&&globalThis.Worker&&globalThis.WebAssembly);

export function createNeuralVoice() {
  let worker;
  let audio;
  let serial=0;
  let pending;

  function discardWorker(){
    worker?.terminate();
    worker=null;
  }

  function synthesize(text,signal,onStatus){
    signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
      const id=++serial;
      worker??=new Worker(new URL('./neural-voice-worker.js',import.meta.url),{type:'module'});
      function done(callback,value){
        if(pending!==cancel)return;
        pending=null;
        signal.removeEventListener('abort',cancel);
        clearTimeout(timeout);
        callback(value);
      }
      function cancel(){
        discardWorker();
        done(reject,signal.reason??new Error('已结束播报。'));
      }
      const timeout=setTimeout(cancel,90000);
      pending=cancel;
      signal.addEventListener('abort',cancel,{once:true});
      worker.onmessage=({data})=>{
        if(data.id!==id)return;
        if(data.error){
          discardWorker();
          done(reject,new Error(data.error));
        } else if(data.bytes) done(resolve,data.bytes);
        else if(Number.isFinite(data.progress)) onStatus('正在下载自然音色 '+data.progress+'%');
      };
      worker.onerror=()=>{
        discardWorker();
        done(reject,new Error('自然音色引擎暂时无法启动。'));
      };
      worker.postMessage({id,text});
    });
  }

  async function play(text,signal,onStatus){
    audio??=new AudioEngine();
    // Called from the play button before the first awaited operation.
    await audio.resume();
    onStatus('正在合成自然语音。首次使用会下载音色。');
    const bytes=await synthesize(text,signal,onStatus);
    const buffer=await audio.decodeAudioData(bytes);
    signal.throwIfAborted();
    if(buffer.duration<.1 || !buffer.getChannelData(0).some(sample=>Math.abs(sample)>.002)){
      throw new Error('自然音色没有生成有效音频。');
    }
    await new Promise((resolve,reject)=>{
      const source=audio.createBufferSource();
      const cleanup=()=>{
        signal.removeEventListener('abort',stop);
        source.disconnect();
      };
      const stop=()=>{
        source.stop();
        cleanup();
        reject(signal.reason);
      };
      source.buffer=buffer;
      source.connect(audio.destination);
      source.onended=()=>{cleanup();resolve();};
      signal.addEventListener('abort',stop,{once:true});
      try{
        source.start();
        onStatus('');
      }catch(error){cleanup();reject(error);}
    });
  }

  function dispose(){
    pending?.();
    discardWorker();
    audio?.close().catch(()=>{});
    audio=null;
  }

  return {play,dispose};
}
