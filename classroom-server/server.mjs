import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {basename, extname, resolve, sep} from 'node:path';
import {networkInterfaces} from 'node:os';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {getLlama, LlamaChatSession, resolveModelFile} from 'node-llama-cpp';

const site = fileURLToPath(new URL('../',import.meta.url));
const {values: args}=parseArgs({options:{
  'port': {type:'string',default:'8080'},
  'lan': {type:'boolean',default:false},
  'model': {type:'string'},
}});
const port=Number(args.port);
if(!Number.isInteger(port)||port<1||port>65535) throw new Error('端口须为 1 到 65535 的整数。');
const knownModel='https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf';
const modelDirectory=resolve(site,'classroom-server/models');
const displayName=args.model?basename(args.model,'.gguf'):'Qwen3 4B Instruct';
const types={
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.png':'image/png','.jpg':'image/jpeg','.wasm':'application/wasm','.gz':'application/gzip',
  '.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8',
};
const publicFiles=new Set(['/index.html','/opening.html','/classroom-core.js','/record-storage.js']);
const roles=new Set(['system','user','assistant']);
const requestLimit=65536;
const requestTimeout=30000;
const systemPrompt='你是高中物理实验助教。用简洁、自然的中文回答，先观察条件，再解释现象。使用本次仿真数据时必须照实引用。缺少读数时引导学生测量。参数调整和实验运行只能由学生确认。';

let context;
let loadError=false;
const activeSequences=[];
const queue=[];

async function initialize() {
  const cachedPath=resolve(modelDirectory,basename(new URL(knownModel).pathname));
  const cached=await stat(cachedPath).catch(()=>null);
  const modelPath=args.model?resolve(args.model):cached?.isFile()?cachedPath:
    await resolveModelFile(knownModel,{directory:modelDirectory});
  const runtime=await getLlama({logLevel:'warn'});
  const model=await runtime.loadModel({modelPath});
  context=await model.createContext({contextSize:4096,sequences:2});
  activeSequences.push(context.getSequence(),context.getSequence());
  process.stdout.write('课堂模型已就绪 '+displayName+'\n');
}

function json(response,status,data){
  response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  response.end(JSON.stringify(data));
}

function fail(status,message){return Object.assign(new Error(message),{status});}

async function payload(request){
  let size=0;
  const chunks=[];
  for await (const chunk of request) {
    size+=chunk.length;
    if(size>requestLimit) throw fail(413,'内容过长。请缩短问题后重试。');
    chunks.push(chunk);
  }
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch {throw fail(400,'请求数据格式不正确。');}
}

function getMessages(data){
  if(!Array.isArray(data?.messages)||data.messages.length>24) throw fail(400,'缺少有效的问题。');
  const messages=data.messages.filter(message=>roles.has(message?.role)&&typeof message.content==='string')
    .map(message=>({role:message.role,content:message.content.trim().slice(0,7000)}))
    .filter(message=>message.content);
  if(messages.filter(message=>message.role!=='system').at(-1)?.role!=='user') throw fail(400,'最后一条消息需要是学生的问题。');
  return messages;
}

function acquire(signal){
  if(activeSequences.length) return Promise.resolve(activeSequences.pop());
  if(queue.length>=18)throw fail(503,'课堂导师正在处理较多问题，请稍等再问。');
  return new Promise((resolveWait,rejectWait)=>{
    const entry={accept(value){signal.removeEventListener('abort',cancel);resolveWait(value);}};
    function cancel(){
      const position=queue.indexOf(entry);
      if(position>=0) queue.splice(position,1);
      rejectWait(fail(503,'课堂导师暂时忙碌，请重试。'));
    }
    signal.addEventListener('abort',cancel,{once:true});
    if(signal.aborted) cancel();
    else queue.push(entry);
  });
}

async function generate(messages,signal,maxTokens){
  if(!context)throw fail(503,'课堂模型正在加载或服务暂不可用。');
  const sequence=await acquire(signal);
  try{
    const instructions=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n').slice(0,8200);
    const dialog=messages.filter(m=>m.role!=='system').slice(-9);
    const last=dialog.pop();
    const session=new LlamaChatSession({
      contextSequence:sequence,
      systemPrompt:systemPrompt+'\n'+instructions,
    });
    if(dialog.length){
      const history=session.getChatHistory();
      for(const turn of dialog){
        history.push(turn.role==='user'?{type:'user',text:turn.content}:{type:'model',response:[turn.content]});
      }
      session.setChatHistory(history);
    }
    try{
      return (await session.prompt(last.content,{
        signal, maxTokens, temperature:.3, topP:.9, repeatPenalty:{penalty:1.12},
      })).trim();
    } finally {session.dispose({disposeSequence:false});}
  } finally {
    const next=queue.shift();
    if(next) next.accept(sequence);
    else activeSequences.push(sequence);
  }
}

async function api(request,response,path){
  if(path==='/api/health'&&request.method==='GET'){
    json(response,200,{
      ok:true, ai:!!context, mode:context?'online':'offline',
      model:displayName, experiments:17, planner:false, classroom:true,
      status:context?'ready':loadError?'error':'loading',
    });
    return;
  }
  if(request.method!=='POST'||!['/api/chat','/api/report'].includes(path)){
    json(response,404,{ok:false,error:'当前 API 不可用。'});
    return;
  }
  // Native browser requests from the classroom page are same-origin.
  const origin=request.headers.origin;
  if((origin && new URL(origin).host!==request.headers.host)||request.headers['sec-fetch-site']==='cross-site'){
    throw fail(403,'请在教师发放的课堂页面中使用导师。');
  }
  const data=await payload(request);
  const abort=new AbortController();
  response.once('close',()=>abort.abort());
  const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(requestTimeout)]);
  if(path==='/api/chat'){
    const content=await generate(getMessages(data),signal,420);
    if(!content) throw fail(502,'模型没有返回内容，请重试。');
    json(response,200,{ok:true,content,model:displayName});
    return;
  }
  const metrics=Array.isArray(data?.metrics)?data.metrics.filter(item=>typeof item?.label==='string'&&Number.isFinite(item.value)).slice(0,12):[];
  if(!metrics.length) throw fail(400,'报告需要保存后的实验读数。');
  const rows=metrics.map(item=>item.label.slice(0,80)+' '+item.value+' '+String(item.unit??'').slice(0,24)).join('\n');
  const analysis=await generate([{role:'user',content:[
    '根据这份高中物理实验记录写 100–170 字的数据分析。引用关键读数与单位，说明可能的物理关系，并指出一项可核对的控制变量。没有第二组数据时不要虚构第二组。',
    '实验：'+String(data.experimentId??'').slice(0,100),
    rows,
    '学生已完成的对照：'+String(data.comparison??'').slice(0,1600),
  ].join('\n')}],signal,280);
  if(!analysis) throw fail(502,'模型没有返回报告分析。');
  json(response,200,{ok:true,analysis,source:'ai',model:displayName});
}

async function sendFile(request,response,path){
  const relative=path==='/'?'/index.html':path;
  const type=types[extname(relative)];
  const accepted=publicFiles.has(relative)||relative.startsWith('/model-views/')||relative.startsWith('/tutor-media/');
  if(!['GET','HEAD'].includes(request.method)||!accepted||!type) throw fail(404,'找不到该页面。');
  const file=resolve(site,'.'+relative);
  const allowed=file.startsWith(resolve(site,'model-views')+sep)||file.startsWith(resolve(site,'tutor-media')+sep)||
    [...publicFiles].some(entry=>file===resolve(site,'.'+entry));
  if(!allowed) throw fail(404,'找不到该页面。');
  const info=await stat(file).catch(()=>null);
  if(!info?.isFile()) throw fail(404,'找不到该页面。');
  response.writeHead(200,{
    'content-type':type,'content-length':info.size,
    'cache-control':relative.includes('/vendor/')?'public, max-age=86400':'no-cache',
  });
  if(request.method==='HEAD')return response.end();
  const stream=createReadStream(file);
  stream.on('error',()=>response.destroy());
  response.once('close',()=>stream.destroy());
  stream.pipe(response);
}

const server=createServer(async(request,response)=>{
  response.setHeader('x-content-type-options','nosniff');
  response.setHeader('referrer-policy','same-origin');
  try{
    const path=decodeURIComponent(new URL(request.url,'http://classroom.local').pathname);
    if(path.startsWith('/api/')) await api(request,response,path);
    else await sendFile(request,response,path);
  }catch(error){
    if(response.destroyed||response.headersSent)return;
    const status=error.status??(error.name==='TimeoutError'?503:500);
    json(response,status,{ok:false,error:status===500?'课堂服务暂时无法完成请求。':error.message});
  }
});
server.requestTimeout=15000;
server.listen(port,args.lan?'0.0.0.0':'127.0.0.1',()=>{
  process.stdout.write('本机课堂 http://127.0.0.1:'+port+'/\n');
  if(args.lan) for(const address of Object.values(networkInterfaces()).flat()){
    if(address.family==='IPv4'&&!address.internal)process.stdout.write('学生访问 http://'+address.address+':'+port+'/\n');
  }
  initialize().catch(error=>{loadError=true;process.stderr.write('课堂模型加载失败 '+error.message+'\n');});
});
