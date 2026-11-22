import {parseExperimentReadings} from './photo.js?v=classroom-tools';

const browserAssets = new URL('./vendor/ocr/', import.meta.url);
const number = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+-]?\\d+)?';
const aliases = {
  lengthM: ['摆长','悬点到球心距离'],
  angleDeg: ['初始摆角','摆角'],
  oscillations: ['全振动次数','振动次数','全振次数','计数'],
  totalTimeS: ['总用时','总时间','总计时','用时'],
};
const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clean = text => text.normalize('NFKC').replace(/[−–]/g,'-')
  .replace(/(?<=\p{Script=Han})[^\S\n]+(?=\p{Script=Han})/gu,'')
  .replaceAll('µ','μ');
const trimUnit = text => text.trim().replace(/^[([（【]+|[)\]）】,;。]+$/g,'').trim();

function fieldLabels(field) {
  return [...new Set([field.label, ...(aliases[field.key] ?? [])])]
    .sort((a,b)=>b.length-a.length).map(label=>escaped(clean(label)));
}

function boundReading(field, value) {
  if (value == null || (field.min!==undefined&&value<field.min) ||
      (field.max!==undefined&&value>field.max) || (field.integer&&!Number.isInteger(value))) return null;
  return value;
}

export function extractLocalReadings(text, fields) {
  const lines = clean(text).split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const found = Object.fromEntries(fields.map(field=>[field.key, []]));
  const header = [];
  const repeated = new Set();
  for (const [index,line] of lines.entries()) {
    for (const field of fields) {
      const label = '(?:'+fieldLabels(field).join('|')+')';
      const cell = new RegExp(label+'\\s*(?:\\(([^)]+)\\))?\\s*[:=]?\\s*('+number+')\\s*(.*?)\\s*$','i');
      const match = line.match(cell);
      if (match) {
        const inline = trimUnit(match[3]);
        const unit = field.unit ? (inline||match[1]||'') : inline.replace(/^(次|个)$/,'');
        const value = parseExperimentReadings({readings:{[field.key]:{value:match[2],unit}}},[field])[field.key];
        const bounded=boundReading(field,value);
        if(bounded!==null) found[field.key].push(bounded);
      }
      const heading=new RegExp(label+'\\s*(?:\\(([^)]+)\\))?','i').exec(line);
      if(heading) header.push({field,index,offset:heading.index,unit:heading[1]??''});
    }
  }

  // A table can supply units in column headings. Use a single numeric row only.
  for (const index of new Set(header.map(column=>column.index))) {
    const columns=header.filter(column=>column.index===index).sort((a,b)=>a.offset-b.offset);
    if(columns.length<2 || columns.some(({field})=>found[field.key].length)) continue;
    const numericRow = new RegExp('^'+Array(columns.length).fill('('+number+')').join('(?:\\s+|[|,]\\s*)')+'$','i');
    const rows=[];
    for(let next=index+1;next<lines.length;next+=1){
      const match=numericRow.exec(lines[next]);
      if(!match) break;
      rows.push(match.slice(1));
    }
    if(rows.length>1) {
      columns.forEach(({field})=>repeated.add(field.key));
      continue;
    }
    if(rows.length===1) columns.forEach(({field,unit},column)=>{
      const value=parseExperimentReadings({readings:{[field.key]:{value:rows[0][column],unit}}},[field])[field.key];
      const bounded=boundReading(field,value);
      if(bounded!==null) found[field.key].push(bounded);
    });
  }

  const ambiguous = repeated.size>0 || Object.values(found).some(values=>values.length>1);
  const readings = Object.fromEntries(fields.map(field=>[field.key,ambiguous?null:found[field.key][0]??null]));
  const count = Object.values(readings).filter(value=>value!==null).length;
  const notes = ambiguous ? ['照片里似乎有多条实验记录。请裁切到一条后重试，或手动填写。'] :
    count < fields.length ? ['单位不清楚或没有读到的项目已留空。请根据原图核对。'] : [];
  return {...readings, count, notes};
}

export async function recognizeLocalPhoto(photo, fields, {signal,onProgress}={}) {
  signal?.throwIfAborted();
  let worker;
  const controller = new AbortController();
  const cancel=()=>controller.abort(signal.reason);
  signal?.addEventListener('abort',cancel,{once:true});
  const timeout=setTimeout(()=>controller.abort(new Error('本机识读用时过长，请裁切照片后重试。')),45000);
  const cancelled=new Promise((_,reject)=>controller.signal.addEventListener('abort',
    ()=>reject(controller.signal.reason),{once:true}));
  const read=(async()=>{
    const {default: tesseract}=await import('./vendor/ocr/tesseract.esm.min.js');
    controller.signal.throwIfAborted();
    worker=await tesseract.createWorker(['chi_sim','eng'],1,{
      workerPath:new URL('worker.min.js',browserAssets).href,
      corePath:browserAssets.href,
      langPath:browserAssets.href.replace(/\/$/,''),
      workerBlobURL:false,
      logger:event=>onProgress?.(event.status,event.progress),
    });
    if(controller.signal.aborted){
      await worker.terminate();
      controller.signal.throwIfAborted();
    }
    const {data}=await worker.recognize(photo.blob,{},{text:true});
    return extractLocalReadings(data.text,fields);
  })();
  try { return await Promise.race([read,cancelled]); }
  finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort',cancel);
    if(worker) await worker.terminate().catch(()=>{});
  }
}
