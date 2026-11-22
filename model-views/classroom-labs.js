import {classroomPlot, fitLine, nearest} from './classroom-plot.js';

const pretty = value => value == null || !Number.isFinite(value) ? '—' :
  value === 0 ? '0' : Math.abs(value) >= 1e5 || Math.abs(value) < 0.001
    ? value.toExponential(3) : Number(value.toPrecision(5)).toString();
const reading = (label,value,unit='') => label+' '+pretty(value)+(unit==='°'?unit:unit?' '+unit:'');
const curve = (label,points,options={})=>({label,points,...options});
const samples = list=>list.length<=350?list:list.filter((_,index)=>index%Math.ceil(list.length/350)===0||index===list.length-1);
const chord = (start,end,label,options)=>curve(label,[start,end],options);
const degree = Math.PI/180;
const drafts = new Map();
const draftKey = id => 'physics-lab.classroom-draft.v1.'+id;

function drawCircuit(canvas, state) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const line = (points, color = '#a9c4da') => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    points.forEach(([x,y], index) => index ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.stroke();
  };
  ctx.fillStyle='#08131e';
  ctx.fillRect(0,0,440,175);
  const active = state==='holding' ? '#768c9d' : '#63e2ff';
  line([[104,42],[168,42]],active);
  line([[213,42],[239,42],[249,34],[260,50],[271,34],[282,50],[293,42],[355,42],[355,86]],active);
  line([[355,105],[355,132],[104,132],[104,state==='discharging'?42:101]],active);
  if(state!=='discharging'){
    line([[104,42],[104,82]],active);
    line([[88,82],[120,82]]);
    line([[94,101],[114,101]]);
  }
  line([[168,42],[state==='holding'?205:213,state==='holding'?24:42]],active);
  line([[335,86],[375,86]]);
  line([[335,105],[375,105]]);
  ctx.fillStyle='#c9dce8';
  ctx.font='14px system-ui';
  ctx.fillText('开关 S',165,75);
  ctx.fillText('电阻 R',243,75);
  ctx.fillText('电容 C',369,100);
  ctx.fillText(state==='discharging'?'放电回路':'直流电源',28,101);
  if(state!=='holding'){
    const from=state==='charging'?301:327;
    const to=state==='charging'?327:301;
    const tip=state==='charging'?320:308;
    line([[from,21],[to,21],[tip,15]],active);
    line([[to,21],[tip,27]],active);
  }
}

export function createClassroomBench({h,ref,experiment,records,onClose,onUnmounted,prismGeometry}) {
  const id=experiment.experimentId;
  let initial = drafts.get(id);
  try {
    const stored=JSON.parse(localStorage.getItem(draftKey(id))??'null');
    if(Array.isArray(stored?.rows)) initial=stored;
  } catch {}
  const state = ref(initial ?? {rows: []});
  const storageFailed=ref(false);
  const data=()=>experiment.result;
  const values=()=>state.value;
  function persistDraft(){
    const snapshot={...state.value,watchRunning:false};
    drafts.set(id,snapshot);
    try {
      localStorage.setItem(draftKey(id),JSON.stringify(snapshot));
      storageFailed.value=false;
    } catch {storageFailed.value=true;}
  }
  const put=(key,value)=>{
    state.value[key]=value;
    if(key!=='watchTime'&&key!=='watchRunning') persistDraft();
  };
  const read=(key,initial)=>state.value[key]??initial;
  const status=ref('');
  let frame=0;
  let timeOrigin=0;
  const button=(text,action,primary=false,disabled=false)=>h('button',{
    type:'button',class:'btn '+(primary?'primary':''),onClick:action,disabled
  },text);
  const row=(...children)=>h('div',{class:'classroom-actions'},children.filter(Boolean));
  const p=(text,small=false)=>h('p',{class:small?'classroom-context':null},text);
  const field=(label,key,initial,{min,max,step='any',type='number'}={})=>
    h('label',{class:'classroom-field'},[
      h('span',null,label+(type==='range'?' '+pretty(read(key,initial)):'')),
      h('input',{type,min,max,step,value:read(key,initial), onInput:event=>{
        const value=event.target.valueAsNumber;
        put(key,Number.isFinite(value)?value:'');
      }})
    ]);
  const renderPlot=model=>classroomPlot(h,model);
  const set=parameters=>{
    if(experiment.experimentId!==id) return;
    for(const [key,value] of Object.entries(parameters)) experiment.setParam(key,value);
  };
  const push=value=>{
    if(values().rows.some(row=>JSON.stringify(row)===JSON.stringify(value))) return;
    put('rows',[...values().rows,value]);
  };
  const table=(headers,rows)=>h('table',{class:'classroom-table'},[
    h('thead',null,[h('tr',null,headers.map(title=>h('th',{scope:'col'},title)))]),
    h('tbody',null,rows.map((items,index)=>h('tr',{key:index},items.map(item=>h('td',null,String(item))))))
  ]);
  const display=(...lines)=>h('ul',{class:'classroom-readings'},lines.filter(Boolean).map(line=>h('li',null,line)));
  function save(title,lines,more={}){
    if(experiment.experimentId!==id || !lines.length) return;
    experiment.recordRun('课堂操作测量', {title, lines, ...more});
    if(records.selected?.experimentId===id) status.value='已保存 '+title+'。可在实验报告中查看。';
  }
  function chartTime(rows,label,key,unit){
    return renderPlot({title:label,xLabel:'时间 t（s）',yLabel:unit,
      series:[curve(label,samples(rows).map(r=>[r.t,r[key]]))]});
  }
  function cleanup(){cancelAnimationFrame(frame);frame=0;}
  window.addEventListener('pagehide',persistDraft);
  onUnmounted(()=>{
    cleanup();
    put('watchRunning',false);
    persistDraft();
    window.removeEventListener('pagehide',persistDraft);
  });

  function incline(){
    const r=data();
    return [
      row(button('牛顿第二定律 · 改变质量',()=>{set({angleDeg:30,staticFriction:.15,kineticFriction:.1});put('mode','force');}),
        button('机械能守恒 · 近无摩擦',()=>{set({angleDeg:30,staticFriction:0,kineticFriction:0});put('mode','energy');})),
      p(read('mode','force')==='energy'?'记录势能减少量、动能增加量与摩擦耗能，再核对机械能。':'保持斜面和摩擦条件。记录合力和质量，计算 F合/m 后与加速度读数比较。'),
      display(reading('沿斜面合力',r.netForce,'N'),reading('滑块质量',r.massKg,'kg'),
        reading('加速度',r.acceleration,'m/s²'),reading('势能减少',r.potentialEnergy,'J'),
        reading('动能增加',r.kineticEnergyFinal,'J'),reading('摩擦耗能',r.frictionWork,'J')),
      chartTime(r.samples,'滑块速度随时间变化','v','速度（m/s）'),
    ];
  }

  function prism(){
    const r=data();
    const slab=read('tab','prism')==='slab';
    const options=row(button('棱镜光路',()=>put('tab','prism'),!slab),button('玻璃砖插针测折射率',()=>put('tab','slab'),slab));
    if(!slab){
      const ray=r.samples.find(s=>s.wavelengthNm===585);
      const {outline,points,normals,second,reflected}=prismGeometry(r,ray);
      const label=reflected?'全反射':'出射光';
      return [options,
        renderPlot({title:'棱镜二维光路与界面法线 · 585 nm',yBounds:[-3.35,2],xLabel:'相对位置',equalScale:true,
          series:[curve('棱镜边界',outline),chord(points[0],points[1],'入射光',{arrow:true}),
            chord(points[1],points[2],'棱镜内折射',{arrow:true}),
            ...(points[3]?[chord(points[2],points[3],label,{arrow:true})]:[]),
            curve('界面法线',normals,{dashed:true})]}),
        display(reading('入射角',r.incidenceAngleDeg,'°'),reading('棱镜内第一折射角',ray.r1Deg,'°'),
          !second?'参考光线通向底面，无法按双界面公式读取偏向角。':
            reading('第二界面入射角',ray.r2Deg,'°'),
          second&&!reflected?reading('出射角',ray.i2Deg,'°'):null)];
    }
    const i=read('glassAngle',35);
    const thickness=4;
    const index=r.nd;
    const b=thickness*Math.tan(Math.asin(Math.sin(i*degree)/index));
    const actual1=b+2*Math.tan(i*degree), actual2=b+5*Math.tan(i*degree);
    const x1=read('pinOne',2),x2=read('pinTwo',4);
    const inferred=x1-(x2-x1)*2/3;
    const refraction=Math.atan(inferred/thickness);
    const estimated=refraction>0?Math.sin(i*degree)/Math.sin(refraction):null;
    const checked=read('pinChecked',false);
    return [options,p('沿出射方向观察。调节 P₃、P₄ 的位置，使两枚针都落到出射视线所在的直线上。延长 P₃P₄ 找到玻璃砖的出射点。'),
      row(field('入射角（°）','glassAngle',35,{min:15,max:60,step:1,type:'range'}),
          field('P₃ 横坐标（cm）','pinOne',2,{min:0,max:16,step:.02,type:'range'}),
          field('P₄ 横坐标（cm）','pinTwo',4,{min:0,max:24,step:.02,type:'range'})),
      renderPlot({title:'平行玻璃砖插针俯视图',xLabel:'横坐标（cm）',yLabel:'纵坐标（cm）',
        series:[curve('砖面与法线',[[-5,0],[16,0],null,[-5,4],[16,4],null,[0,-5],[0,5]],{dashed:true}),
          curve('入射针',[[ -4*Math.tan(i*degree),-4],[-2*Math.tan(i*degree),-2]],{dots:true}),
          curve('出射视线',[[b,4],[actual1,6],[actual2,9]],{dashed:true}),
          curve('你放置的针',[[x1,6],[x2,9]],{dots:true})]}),
      row(button('用插针位置计算折射率',()=>put('pinChecked',true),true),checked&&button('保存插针测量',()=>save('玻璃砖插针测折射率',
        [reading('入射角',i,'°'),reading('折射角',refraction/degree,'°'),reading('测得折射率',estimated)]),false,!estimated)),
      checked&&display(reading('折射角',refraction/degree,'°'),reading('测得折射率',estimated),
        Math.abs(x1-actual1)+Math.abs(x2-actual2)<.15?'插针已经与视线基本对齐。':'两枚针还需要对齐。')];
  }

  function linear(){
    const r=data(), dots=r.dots??[];
    if(dots.length<3) return [p('当前纸带数据不足。请检查初速度和加速度。')];
    const i=Math.max(1,Math.min(dots.length-2,read('dotIndex',Math.min(8,dots.length-2))));
    const previous=dots[i-1],current=dots[i],next=dots[i+1];
    const measured=(next.x-previous.x)/(next.t-previous.t);
    const conditions=JSON.stringify([experiment.parameters,experiment.mode,experiment.seed]);
    const savedConditions=read('tapeConditions','');
    const result=fitLine(values().rows.map(item=>[item.t,item.velocity]));
    return [
      p('先看纸带。选一个中间点，读前点和后点的位置，算中间点附近的速度。记录几个不同时间的点，再用速度图求加速度。'),
      row(field('中间点编号','dotIndex',i,{min:1,max:dots.length-2,step:1,type:'range'}),
        field('自己算出的速度（m/s）','dotAnswer','')),
      renderPlot({title:'纸带点位',xLabel:'纸带位置（m）',yBounds:[-.15,.15],
        series:[curve('全部点',samples(dots).map(dot=>[dot.x,0]),{dots:true}),
          curve('相邻三点',[previous,current,next].map(dot=>[dot.x,0]),{dots:true})]}),
      table(['点','位置（m）','时间（s）'],[previous,current,next].map((dot,index)=>[i-1+index,pretty(dot.x),pretty(dot.t)])),
      row(button('核对并记录速度',()=>{
        const value=read('dotAnswer','');
        if(!Number.isFinite(value)){status.value='先填写你算出的速度。';return;}
        if(Math.abs(value-measured)>Math.max(.02,Math.abs(measured)*.03)){
          status.value='核对前、后两点的位移差和时间差。';return;
        }
        if(values().rows.length&&conditions!==savedConditions){
          status.value='纸带已经更换。请恢复先前参数或清空本轮读数。';return;
        }
        put('tapeConditions',conditions);
        push({t:current.t,velocity:value});status.value='已记录这个点。';
      },true),button('保存纸带读数',()=>save('纸带取点与速度拟合',values().rows.map(item=>reading('时间',item.t,'s')+'，'+reading('速度',item.velocity,'m/s')).concat(result?[reading('速度图斜率',result.slope,'m/s²')]:[])),false,!values().rows.length||conditions!==savedConditions),
      values().rows.length&&conditions!==savedConditions?button('恢复草稿的纸带条件',()=>{
        const [parameters,mode,seed]=JSON.parse(savedConditions);
        set(parameters);experiment.setMode(mode);experiment.setSeed(seed);
        status.value='已恢复原来的纸带，可以继续测量。';
      }):null,
      button('清空本轮纸带读数',()=>{put('rows',[]);status.value='已清空本轮待保存读数。';},false,!values().rows.length)),
      values().rows.length?renderPlot({title:'学生取点的速度图', xLabel:'时间（s）',yLabel:'速度（m/s）',
        series:[curve('已记录读数',values().rows.slice().sort((a,b)=>a.t-b.t).map(item=>[item.t,item.velocity]),{dots:true})]}):null,
      result?display(reading('由学生取点拟合出的加速度',result.slope,'m/s²')):null,
    ];
  }

  function projectile(){
    const r=data();
    const limit=Math.max(r.flightTime,Math.sqrt(2*r.heightM/r.g));
    const t=Math.min(limit,read('position',0));
    const pt=nearest(r.trajectory,Math.min(t,r.flightTime));
    const fall=Math.max(0,r.heightM-r.g*t*t/2);
    return [
      row(button('同高平抛与自由落体',()=>{set({launchAngleDeg:0});put('position',0);},true),
        field('同步物理时间（s）','position',t,{min:0,max:limit,step:limit/120,type:'range'})),
      renderPlot({title:'同步时刻 · 抛体与同高自由落体',xLabel:'水平位移（m）',yLabel:'高度（m）',
        series:[curve('抛体轨迹',samples(r.trajectory).map(q=>[q.x,q.y])),chord([0,r.heightM],[0,0],'自由落体路径',{dashed:true}),
          curve('抛体位置',[[pt.x,pt.y]],{dots:true}),curve('自由落体位置',[[0,fall]],{dots:true})]}),
      display(reading('抛体高度',pt.y,'m'),reading('自由落体高度',fall,'m'),
        reading('抛体落地用时',r.flightTime,'s'),reading('同高自由落体用时',Math.sqrt(2*r.heightM/r.g),'s')),
    ];
  }

  function forces(){
    const r=data(),{f1,f2,sum}=r.vectors;
    const x=read('forceX',2),y=read('forceY',2);
    const checked=read('forceChecked',false);
    return [
      p('俯视橡皮条连接点 O。两支测力计沿两个方向拉同一个点。先画平行四边形，再用控制条放置你选的合力端点。'),
      row(field('合力端点 x（N）','forceX',2,{min:-10,max:16,step:.1,type:'range'}),
          field('合力端点 y（N）','forceY',2,{min:-2,max:10,step:.1,type:'range'})),
      renderPlot({title:'测力计共点拉伸 · 俯视作图',xLabel:'水平分量（N）',yLabel:'纵向分量（N）',
        series:[chord([0,0],[f1.x,f1.y],'测力计 F₁',{arrow:true}),
          chord([0,0],[f2.x,f2.y],'测力计 F₂',{arrow:true}),
          chord([0,0],[x,y],'学生作图',{arrow:true}),
          checked?curve('平行四边形的另外两边',[[f1.x,f1.y],[sum.x,sum.y],[f2.x,f2.y]],{dashed:true}):curve('橡皮条固定点',[[-1,-.6],[0,0]],{dashed:true})]}),
      row(button('核对我的合力端点',()=>put('forceChecked',true),true),
        checked&&button('保存作图读数',()=>save('力的平行四边形作图',[reading('学生作图水平分量',x,'N'),reading('学生作图纵向分量',y,'N'),reading('合力大小',r.resultant,'N')]))),
      display(reading('测力计 F₁',r.force1,'N'),reading('测力计 F₂',r.force2,'N'),
        checked?reading('端点与求解器端点的距离',Math.hypot(sum.x-x,sum.y-y),'N'):'先核对两个分力的方向。'),
    ];
  }

  function pendulum(){
    const r=data();
    const elapsed=read('watchTime',0),running=read('watchRunning',false);
    const amplitude=r.amplitudeDeg;
    const trajectory=Array.from({length:90},(_,index)=>{
      const t=index*r.periodActual/89;
      return [t,amplitude*Math.cos(2*Math.PI*t/r.periodActual)];
    });
    const point=elapsed%r.periodActual;
    const angle=amplitude*Math.cos(2*Math.PI*point/r.periodActual);
    const pivot=[0,0];
    const bob=[r.lengthM*Math.sin(angle*degree),-r.lengthM*Math.cos(angle*degree)];
    const fit=fitLine(values().rows.map(item=>[item.length,item.period**2]));
    function start(){
      cleanup();
      put('watchTime',0);put('watchRunning',true);put('watchedLength',r.lengthM);put('watchedAngle',r.amplitudeDeg);
      timeOrigin=performance.now();
      const rate=read('watchSpeed',4);
      function tick(now){
        if(!read('watchRunning',false))return;
        const time=(now-timeOrigin)*rate/1000;
        put('watchTime',time);
        frame=requestAnimationFrame(tick);
      }
      frame=requestAnimationFrame(tick);
    }
    function stop(){cleanup();put('watchRunning',false);persistDraft();}
    function capture(){
      const count=read('cycleCount',30);
      if(!Number.isInteger(count)||count<1||count>200||!(elapsed>0)||running||
        r.lengthM!==read('watchedLength')||r.amplitudeDeg!==read('watchedAngle')){
        status.value='先用当前摆长和摆角完成一次计时，再填写实际数到的全振动次数。';
        return;
      }
      const period=elapsed/count;
      if(values().rows.length && values().rows[0].angle!==r.amplitudeDeg){
        status.value='这一轮已有不同摆角的读数。请恢复原摆角后再换摆长。';
        return;
      }
      push({length:r.lengthM,angle:r.amplitudeDeg,count,time:elapsed,period});
      status.value='已记下这次秒表读数。可以换摆长再测。';
    }
    return [
      p('从释放位置开始。观察摆球回到同一侧并完成往返，在你数到目标次数时停表。倍速只改变播放速度，秒表显示仿真物理时间。'),
      row(button('开始秒表与摆动',start,true,running),button('停止秒表',stop,false,!running),
        field('实际全振动次数','cycleCount',30,{step:1,min:1,max:200}),
        button('用正常速度',()=>put('watchSpeed',1),read('watchSpeed',4)===1,running),
        button('用 4 倍速',()=>put('watchSpeed',4),read('watchSpeed',4)===4,running)),
      display(reading('当前摆长',r.lengthM,'m'),reading('秒表',elapsed,'s'),
        reading('仿真已完成往返',Math.floor(elapsed/r.periodActual),'次')),
      h('div',{class:'classroom-plot-pair'},[
        renderPlot({title:'摆球与摆线',compact:true,xLabel:'水平位移（m）',yLabel:'竖直位移（m）',
          xBounds:[-r.lengthM,r.lengthM],yBounds:[-1.1*r.lengthM,.1*r.lengthM],equalScale:true,
          series:[chord(pivot,bob,'摆线'),curve('摆球',[bob],{dots:true}),curve('悬点',[pivot],{dots:true})]}),
        renderPlot({title:'单摆角度与当前时刻',compact:true,xLabel:'物理时间（s）',yLabel:'摆角（°）',
          series:[curve('摆角',trajectory),curve('当前角度',[[point,angle]],{dots:true})],cursor:point}),
      ]),
      row(button('记一组秒表读数',capture,true,running||elapsed<=0),
        ...[.45,.60,.75,.90,1.05].map(length=>button('摆长 '+length+' m',()=>set({lengthM:length}),false,running)),
        button('保存实测摆长与周期',()=>{
          const series=values().rows;
          const last=series.at(-1);
          const current=last?.length===r.lengthM&&last?.angle===r.amplitudeDeg;
          save('秒表测周期与重力加速度',series.map(item=>reading('摆长',item.length,'m')+'，'+item.count+' 次，'+reading('秒表',item.time,'s')+'，'+reading('平均周期',item.period,'s'))
            .concat(fit?.slope>0?[reading('由 T²–L 斜率计算的 g',4*Math.PI*Math.PI/fit.slope,'m/s²')]:[]),
            current?{pendulum:{cycles:last.count,seconds:last.time},qualifies:true}:{});
        },false,!values().rows.length),
        button('清空本轮秒表读数',()=>{put('rows',[]);status.value='已清空本轮待保存读数。';},false,!values().rows.length)),
      values().rows.length?renderPlot({title:'学生秒表数据的 T²–L 图',xLabel:'摆长 L（m）',yLabel:'周期平方 T²（s²）',
        series:[curve('学生读数',values().rows.map(item=>[item.length,item.period**2]),{dots:true}),
          ...(fit?[curve('最小二乘直线',[Math.min(...values().rows.map(x=>x.length)),Math.max(...values().rows.map(x=>x.length))]
            .map(x=>[x,fit.intercept+fit.slope*x]),{dashed:true})]:[])]}):null,
      fit?.slope>0?display(reading('拟合计算的 g',4*Math.PI*Math.PI/fit.slope,'m/s²')):null,
    ];
  }

  function hooke(){
    const r=data();
    const fit=fitLine(values().rows);
    const conditions=[r.stiffness,r.naturalLengthCm];
    return [
      p('看左弹簧。刻度尺零点对准挂点，记录原长和挂上砝码后的总长。保持同一根弹簧，换砝码并记录多组质量。'),
      renderPlot({title:'左弹簧刻度尺',xLabel:'距挂点的长度（cm）',yBounds:[-.2,.2],series:[
        chord([0,0],[r.left.totalLength*100,0],'弹簧拉伸'),
        curve('原长',[[r.naturalLengthCm,0]],{dots:true}),curve('当前下端',[[r.left.totalLength*100,0]],{dots:true})]}),
      display(reading('原长',r.naturalLengthCm,'cm'),reading('当前总长',r.left.totalLength*100,'cm'),reading('重力',r.left.weight,'N')),
      row(...[100,200,300,400,600].map(mass=>button(mass+' g',()=>set({massLeftG:mass}))),
        field('由刻度尺算出的伸长（cm）','extension',''),
        button('核对并记录伸长',()=>{
          const value=read('extension','');
          if(!Number.isFinite(value)||Math.abs(value-r.left.extensionCm)>.12){status.value='先用总长减去原长。';return;}
          if(values().rows.length && conditions.some((value,index)=>value!==read('springConditions',[])[index])){
            status.value='本轮已使用另一根弹簧。请恢复原弹簧或清空待保存读数。';
            return;
          }
          put('springConditions',conditions);
          push([value/100,r.left.weight]);status.value='已记录这个挂码档位。';
        },true),
        button('保存力与伸长记录',()=>save('胡克定律多点测量',values().rows.map(([x,y])=>reading('伸长',x,'m')+'，'+reading('力',y,'N'))
          .concat(fit?[reading('拟合劲度系数',fit.slope,'N/m')]:[])),false,!values().rows.length),
        button('清空本轮弹簧读数',()=>{put('rows',[]);status.value='已清空本轮待保存读数。';},false,!values().rows.length)),
      values().rows.length?renderPlot({title:'学生读数的 F–x 图',xLabel:'伸长（m）',yLabel:'力（N）',
        series:[curve('学生读数',values().rows,{dots:true})]}):null,
      fit?display(reading('直线斜率',fit.slope,'N/m')):null,
    ];
  }

  function circular(){
    const r=data();
    const key=read('circlePoint','low');
    const at=key==='top'?r.samples.reduce((best,sample)=>sample.position.y>best.position.y?sample:best,r.samples[0]):
      key==='out'?r.samples.find(sample=>sample.phase==='flight')??r.samples.at(-1):nearest(r.samples,r.launchDuration,'time');
    const time=at?.time??0;
    const load=(choice)=>{
      put('circlePoint',choice);
      if(choice==='low')experiment.seekTo(r.launchDuration);
      else if(choice==='out')experiment.seekTo((r.samples.find(sample=>sample.phase==='flight')??r.samples.at(-1))?.time??0);
      else {
        const maximum=r.samples.reduce((best,sample)=>sample.position.y>best.position.y?sample:best,r.samples[0]);
        experiment.seekTo(maximum.time);
      }
    };
    return [
      row(button('临界前',()=>set({initialSpeed:0,appliedForce:Math.max(0,r.requiredForce-.5)})),
        button('临界后',()=>set({initialSpeed:0,appliedForce:Math.min(30,r.requiredForce+.5)})),
        button('停在最低点',()=>load('low'),key==='low'),button('停在最高可达点',()=>load('top'),key==='top'),
        button('停在失去接触处',()=>load('out'),key==='out',!r.leavesTrack)),
      display(reading('当前时刻',time,'s'),reading('轨道支持力',Math.hypot(...(at?.normal??[])),'N'),
        reading('通过最高点所需临界推力',r.requiredForce,'N')),
      renderPlot({title:'支持力及当前停靠点',xLabel:'时间（s）',yLabel:'支持力（N）',cursor:time,
        series:[curve('支持力',r.samples.map(sample=>[sample.time,Math.hypot(...(sample.normal??[]))]))]}),
      p('再独立探究匀速圆周运动的向心力。这个读数台允许固定其中两个量，只改变第三个。'),
      row(field('质量（kg）','m',1,{min:.1,max:5,step:.1}),field('半径（m）','radius',1,{min:.1,max:5,step:.1}),
        field('角速度（rad/s）','omega',2,{min:.1,max:10,step:.1})),
      display(reading('向心力 mω²r',read('m',1)*read('omega',2)**2*read('radius',1),'N')),
    ];
  }

  function capacitor(){
    const r=data();
    const list=r.timeline;
    const t=read('position',1)*r.tau;
    const current=nearest(list,t);
    const graph=samples(list);
    return [
      row(button('接通电源充电',()=>set({switchState:'charging'})),
        button('断开开关保持',()=>set({switchState:'holding'})),button('接入电阻放电',()=>set({switchState:'discharging'})),
        field('物理时间 t/τ','position',1,{min:0,max:5,step:.05,type:'range'})),
      h('div',{class:'classroom-circuit'},[
        h('canvas',{width:440,height:175,role:'img','aria-label':'电容器充放电电路图',ref:canvas=>drawCircuit(canvas,r.switchState)}),
        p(r.switchState==='charging'?'电源通过电阻给电容器充电。箭头表示电流正方向。':
          r.switchState==='holding'?'开关断开，两极板保持原有电压，电流为零。':'电源已断开，电容器通过电阻放电。箭头表示实际电流方向。'),
      ]),
      h('div',{class:'classroom-plot-pair'},[
        renderPlot({title:'电容电压 U 与物理时间',compact:true,xLabel:'时间（s）',yLabel:'电压（V）',cursor:t,
          series:[curve('极板电压',graph.map(q=>[q.t,q.voltage])),
            ...(r.switchState==='charging'?[chord([0,.632*r.emf],[r.tau,.632*r.emf],'0.632 U₀',{dashed:true})]:[])]}),
        renderPlot({title:'充放电电流 I 与物理时间',compact:true,xLabel:'时间（s）',yLabel:'电流（mA）',cursor:t,
          series:[curve('电阻电流',graph.map(q=>[q.t,q.current]))]}),
      ]),
      display(reading('时间常数',r.tau,'s'),reading('物理时间',t,'s'),reading('此时电压',current?.voltage,'V'),reading('此时电流',current?.current,'mA')),
    ];
  }

  function charges(potential){
    const r=data();
    if(potential){
      const marker=nearest(r.profile,read('position',0),'x');
      const mid=r.landmarks?.find(point=>Math.abs(point.x)<1e-10&&Math.abs(point.y)<1e-10);
      return [
        row(button('等量同号',()=>set({scene:'like'})),button('等量异号',()=>set({scene:'unlike'})),
          button('探针回到中点',()=>put('position',0),true),
          field('剖面探针 x（m）','position',0,{min:r.profile[0].x,max:r.profile.at(-1).x,step:.002,type:'range'})),
        renderPlot({title:'电荷连线上的电势剖面',xLabel:'位置 x（m）',yLabel:'电势（V）',cursor:marker?.x,
          series:[curve('电势',r.profile.map(point=>[point.x,point.phi]))]}),
        display(reading('中点电势',mid?.phi??nearest(r.profile,0,'x')?.phi,'V'),reading('中点场强',mid?.eMag??nearest(r.profile,0,'x')?.eField,'V/m'),
          reading('探针处电势',marker?.phi,'V'),reading('探针处场强',marker?.eField,'V/m')),
        p('从中点向右移动探针。剖面越陡，沿这个方向的场强分量越大。场强的方向沿电势降低的方向。'),
      ];
    }
    const probe=r.probe;
    return [
      row(button('同号电荷中点',()=>set({preset:'like',probeX:0,probeY:0})),
        button('异号电荷中点',()=>set({preset:'unlike',probeX:0,probeY:0})),
        field('探针 x（m）','probeLocalX',probe.x,{min:-.4,max:.4,step:.01,type:'range'}),
        field('探针 y（m）','probeLocalY',probe.y,{min:-.4,max:.4,step:.01,type:'range'}),
        button('移动二维探针',()=>set({probeX:read('probeLocalX',probe.x),probeY:read('probeLocalY',probe.y)}),true)),
      renderPlot({title:'二维探针与场强方向',xBounds:[-.42,.42],yBounds:[-.42,.42],xLabel:'x（m）',yLabel:'y（m）',series:[
        curve('正电荷',r.charges.filter(q=>q.q>0).map(q=>[q.x,q.y]),{dots:true}),
        curve('负电荷',r.charges.filter(q=>q.q<0).map(q=>[q.x,q.y]),{dots:true}),
        curve('探针',[[probe.x,probe.y]],{dots:true}),
        ...(probe.fieldMagnitude>0&&probe.fieldDir?
          [chord([probe.x,probe.y],[probe.x+.11*probe.fieldDir.x,probe.y+.11*probe.fieldDir.y],'场强方向',{arrow:true})]:[])]}),
      display(reading('电势',probe.potential,'V'),reading('场强',probe.fieldMagnitude,'N/C'),
        reading('场强横向分量',probe.fieldX,'N/C'),reading('场强纵向分量',probe.fieldY,'N/C')),
    ];
  }

  function deflection(){
    const r=data();
    const exit=r.events.find(event=>event.id==='exit');
    const last=r.trajectory.at(-1);
    const x=read('position',last.x);
    const marker=nearest(r.trajectory,x,'x');
    return [
      row(field('侧视位置（m）','position',x,{min:0,max:last.x,step:last.x/100,type:'range'}),
        button('读板出口',()=>put('position',exit?.x??last.x),false,!exit),button('读光屏落点',()=>put('position',last.x))),
      renderPlot({title:'平行极板与光屏 · 带刻度侧视图',xLabel:'水平位置（m）',yLabel:'横向偏移（mm）',cursor:marker?.x,
        series:[curve('粒子轨迹',r.trajectory.map(pt=>[pt.x,pt.y*1e3])),
          curve('极板出口与终点',[exit&&[exit.x,exit.y*1e3],[last.x,last.y*1e3]].filter(Boolean),{dots:true})]}),
      display(reading('板内偏移',exit?.y*1e3,'mm'),reading(r.hitsPlate?'撞板点偏移':'屏上总偏移',last.y*1e3,'mm'),
        reading('选中位置偏移',marker?.y*1e3,'mm')),
    ];
  }

  function magnetic(){
    const r=data();
    return [
      row(button('垂直入射 90°',()=>set({incidentAngleDeg:90}),true),
        button('斜入射 60°',()=>set({incidentAngleDeg:60})),
        button('反向平行 180°',()=>set({incidentAngleDeg:180})),
        button('翻转电荷正负',()=>set({charge:-experiment.parameters.charge}))),
      renderPlot({title:'沿磁场方向观察的轨迹投影', xLabel:'x（cm）',yLabel:'y（cm）',
        series:[curve('轨迹横截面',samples(r.trajectory).map(point=>[point.x*100,point.y*100]))]}),
      renderPlot({title:'沿磁场方向的位置随时间', xLabel:'时间（ns）',yLabel:'z（cm）',
        series:[curve('纵向位置',samples(r.trajectory).map(point=>[point.t*1e9,point.z*100]))]}),
      display(reading('回旋半径',r.radius*100,'cm'),reading('平行分速度',r.parallelSpeed,'m/s'),reading('垂直分速度',r.perpendicularSpeed,'m/s')),
      p('沿磁场看横截面，再看纵向位移。翻转电荷后比较转向与半径。'),
    ];
  }

  function rail(){
    const r=data(),rows=r.trajectory;
    const t=Math.min(rows.at(-1).t,read('position',0));
    const point=nearest(rows,t);
    return [
      row(button('恒定拉力驱动',()=>set({driveMode:'force'}),true),
        field('同步物理时间（s）','position',t,{min:0,max:rows.at(-1).t,step:.02,type:'range'})),
      renderPlot({title:'导体棒速度',xLabel:'时间（s）',yLabel:'速度（m/s）',cursor:t,series:[curve('速度',samples(rows).map(p=>[p.t,p.v]))]}),
      renderPlot({title:'感应电流',xLabel:'时间（s）',yLabel:'电流（A）',cursor:t,series:[curve('感应电流',samples(rows).map(p=>[p.t,p.current]))]}),
      display('统一正方向：导体棒向右。',reading('速度',point?.v,'m/s'),reading('动生电动势',point?.emf,'V'),
        reading('感应电流',point?.current,'A'),reading('安培力（带方向）',point?.ampereForce,'N'),reading('理论稳态速度',r.steadySpeed,'m/s')),
    ];
  }

  function generator(){
    const r=data(),rows=r.trajectory;
    const stop=read('position',0);
    const selected=nearest(rows,stop);
    const sample=fraction=>put('position',r.period*fraction);
    return [
      row(button('停在中性面',()=>{set({initialPhaseDeg:0});sample(0);},true),
        button('停在磁通量为零的位置',()=>{set({initialPhaseDeg:0});sample(.25);}),
        field('同一物理时间（s）','position',stop,{min:0,max:r.period,step:r.period/160,type:'range'})),
      renderPlot({title:'线圈转角、磁通量、电动势的同步相位 · 纵轴归一化',xLabel:'时间（s）',yBounds:[-1.1,1.2],cursor:stop,
        series:[curve('磁通量 / 峰值',samples(rows.filter(p=>p.t<=r.period)).map(p=>[p.t,p.flux/r.peakFlux])),
          curve('电动势 / 峰值',samples(rows.filter(p=>p.t<=r.period)).map(p=>[p.t,p.emf/r.peakEmf])),
          curve('转角（圈）',samples(rows.filter(p=>p.t<=r.period)).map(p=>[p.t,p.angleDeg/360]))]}),
      display(reading('线圈角度',selected?.angleDeg,'°'),reading('磁通量',selected?.flux,'Wb'),
        reading('感应电动势',selected?.emf,'V')),
    ];
  }

  function doubleSlit(){
    const r=data();
    const unknown=read('unknownWave',520);
    const spacing=unknown*1e-9*r.screenDistance/r.slitSeparation*1e3;
    const from=Math.min(read('fringeA',-2),read('fringeB',2)), to=Math.max(read('fringeA',-2),read('fringeB',2));
    const difference=to-from;
    const distance=spacing*difference;
    const estimate=read('wavelengthAnswer','');
    return [
      p('未知光源任务。现用测量屏独立显示课堂光源。选两条亮纹，记录相隔的间隔数和距离，再用给出的缝距与屏距推算波长。'),
      row(field('起点级数','fringeA',-2,{min:-5,max:5,step:1,type:'range'}),
        field('终点级数','fringeB',2,{min:-5,max:5,step:1,type:'range'}),
        field('学生计算的波长（nm）','wavelengthAnswer','')),
      renderPlot({title:'未知光源的亮纹测量尺',xLabel:'光屏横坐标（mm）',yBounds:[-.1,1.1],
        series:[curve('亮纹',Array.from({length:11},(_,i)=>[(i-5)*spacing,.8]),{dots:true}),
          chord([from*spacing,.35],[to*spacing,.35],'选中的测量区间')] }),
      display(reading('缝距',r.slitSeparation*1e3,'mm'),reading('屏距',r.screenDistance,'m'),
        reading('两亮纹距离',distance,'mm'),reading('亮纹间隔数',difference,'个')),
      row(button('核对并保存测量',()=>{
        if(!difference || !Number.isFinite(estimate)){status.value='先选两条不同的亮纹并填写计算结果。';return;}
        if(Math.abs(estimate-unknown)>Math.max(1,unknown*.03)){status.value='核对距离、单位和亮纹间隔数。';return;}
        save('双缝法测未知光源波长',[reading('跨间隔数',difference),reading('屏上距离',distance,'mm'),reading('学生测得波长',estimate,'nm')]);
      },true),button('更换一盏未知光源',()=>{put('unknownWave',unknown===520?610:520);put('wavelengthAnswer','');status.value='已更换课堂光源。';})),
    ];
  }

  function collision(){
    const m1=read('m1',1),m2=read('m2',1.5),v1=read('v1',2),v2=read('v2',-.5),e=read('restitution',1);
    const valid = [m1,m2].every(mass=>mass>=.1&&mass<=6) &&
      [v1,v2].every(speed=>Number.isFinite(speed)&&Math.abs(speed)<=5);
    const total=m1*v1+m2*v2;
    const nextV1=e*(v2-v1)/ (1+m1/m2)+total/(m1+m2);
    const nextV2=(total-m1*nextV1)/m2;
    const after=read('tab','before')==='after';
    const current=after?[nextV1,nextV2]:[v1,v2];
    return [
      p('在水平气垫导轨上取两个滑块为系统，向右为正。选碰撞前、后冻结时刻，用质量与带符号的速度分别算总动量。高级板块碰撞可以在原实验台继续操作。'),
      row(field('滑块 A 质量（kg）','m1',1,{min:.1,max:6,step:.1}),
        field('滑块 B 质量（kg）','m2',1.5,{min:.1,max:6,step:.1}),
        field('碰前 A 速度（m/s）','v1',2,{min:-5,max:5,step:.1}),
        field('碰前 B 速度（m/s）','v2',-.5,{min:-5,max:5,step:.1}),
        button('弹性碰撞',()=>put('restitution',1),e===1),button('完全非弹性碰撞',()=>put('restitution',0),e===0)),
      row(button('冻结在碰前',()=>put('tab','before'),!after),button('冻结在碰后',()=>put('tab','after'),after)),
      ...(!valid?[p('请输入 0.1–6 kg 的质量，以及 −5 至 5 m/s 范围内的速度。')]:
        v1<=v2?[p('左滑块追不上右滑块。请让 A 的速度大于 B。')]:[
        renderPlot({title:after?'碰后测速':'碰前测速',xLabel:'相对位置（m）',yBounds:[-.3,.8],
          series:[chord([-2,0],[3,0],'气垫导轨'),
            chord([-.4,.25],[-.4+current[0]*.28,.25],'滑块 A 速度',{arrow:true}),
            chord([.6,.25],[.6+current[1]*.28,.25],'滑块 B 速度',{arrow:true})]}),
        table(['时刻','A 速度（m/s）','B 速度（m/s）'],[[after?'碰后':'碰前',...current.map(pretty)]]),
        row(field('你计算的碰前动量（kg·m/s）','momentumBefore',''),
          field('你计算的碰后动量（kg·m/s）','momentumAfter',''),
          button('核对并保存动量',()=>{
            const expected=total;
            if(['momentumBefore','momentumAfter'].some(key=>{
              const value=read(key,'');return !Number.isFinite(value)||Math.abs(value-expected)>.03;
            })){status.value='重新核对正负号、质量以及两滑块的速度。';return;}
            save('双滑块碰撞动量核对',[reading('碰前 A 速度',v1,'m/s'),reading('碰前 B 速度',v2,'m/s'),
              reading('碰后 A 速度',nextV1,'m/s'),reading('碰后 B 速度',nextV2,'m/s'),
              reading('碰前总动量',read('momentumBefore'),'kg·m/s'),reading('碰后总动量',read('momentumAfter'),'kg·m/s')]);
          },true))
      ]),
    ];
  }

  const labs={
    'mechanics.inclined_plane':['斜面读数与能量账本',incline],
    'optics.prism_dispersion':['二维光路与玻璃砖插针',prism],
    'mechanics.linear_motion':['纸带取点与速度测量',linear],
    'mechanics.projectile':['平抛与自由落体同步对照',projectile],
    'mechanics.force_composition':['俯视力的平行四边形',forces],
    'mechanics.pendulum':['秒表测周期与重力加速度',pendulum],
    'mechanics.hooke':['弹簧标尺与多组读数',hooke],
    'mechanics.circular':['圆轨道事件与向心力',circular],
    'electricity.capacitor':['开关、时间常数与充放电',capacitor],
    'electricity.point_charge':['点电荷二维探针',()=>charges(false)],
    'electricity.deflection':['极板偏转侧视测量',deflection],
    'electricity.magnetic_particle':['磁场粒子入射与轨迹投影',magnetic],
    'electricity.rail':['导轨速度与电流同步对照',rail],
    'electricity.generator':['发电机同步相位与停靠',generator],
    'optics.double_slit':['未知光源波长测量',doubleSlit],
    'mechanics.collision':['双滑块碰前碰后测速',collision],
    'electricity.potential':['从中点探针读电势与场强',()=>charges(true)],
  };
  const lab=labs[id];
  return ()=>h('div',{class:'classroom-backdrop',onClick:event=>{if(event.target===event.currentTarget)onClose();}},[
    h('section',{class:'classroom-modal',role:'dialog','aria-label':'课堂测量台'},[
      h('header',null,[h('div',null,[p(experiment.plugin?.metadata.name??'课堂测量',true),h('h2',null,lab?.[0]??'课堂测量台')]),
        button('关闭测量台',onClose)]),
      h('div',{class:'classroom-body'},data()&&lab?lab[1]().filter(Boolean):[p('当前实验还没有可用的测量数据。')]),
      status.value?h('p',{class:'classroom-status',role:'status'},status.value):null,
      storageFailed.value?h('p',{class:'classroom-status',role:'alert'},'浏览器暂时无法保存草稿。请先保存实验报告或导出读数，再刷新页面。'):null,
    ]),
  ]);
}
