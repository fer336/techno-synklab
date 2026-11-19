// Main-thread side of the analysis worker pool. Decodes audio (async, browser-native), copies channel 0 and
// transfers it to a worker. Exposes window.SynkAnalysis; callers get promises and never run DSP themselves.
'use strict';
(()=>{
 const WORKER_URL='/static/analysis-worker.js';
 const size=Math.max(1,Math.min(2,(navigator.hardwareConcurrency||2)-1));
 const pool=[];let seq=0;
 function spawn(i){
  const slot={i,w:new Worker(WORKER_URL),pending:new Map()};
  slot.w.onmessage=e=>{const {id,ok,result,error}=e.data,p=slot.pending.get(id);if(!p)return;slot.pending.delete(id);ok?p.resolve(result):p.reject(new Error(error))};
  slot.w.onerror=ev=>{ // a crashed worker rejects what it held and is replaced
   const err=new Error('analysis worker failed'+(ev&&ev.message?': '+ev.message:''));
   for(const p of slot.pending.values())p.reject(err);slot.pending.clear();
   try{slot.w.terminate()}catch(_){}pool[i]=spawn(i);
  };
  return slot;
 }
 // Urgent jobs (the beatgrid needed for the next transition) may use any worker; bulk jobs (set preparation,
 // import analysis) leave the last worker free when there is more than one, so they can never delay a transition.
 function pick(urgent){
  if(!pool.length)for(let i=0;i<size;i++)pool.push(spawn(i));
  const cand=urgent||pool.length===1?pool:pool.slice(0,-1);
  return cand.reduce((a,b)=>b.pending.size<a.pending.size?b:a);
 }
 function runRaw(op,x,rate,params,urgent){
  return new Promise((resolve,reject)=>{
   let slot;try{slot=pick(urgent)}catch(e){reject(e);return}
   const id=++seq;slot.pending.set(id,{resolve,reject});
   try{slot.w.postMessage({id,op,payload:{...params,x,rate}},[x.buffer])}catch(e){slot.pending.delete(id);reject(e)}
  });
 }
 async function run(op,blob,params={},urgent=false){
  const buf=await new OfflineAudioContext(1,1,44100).decodeAudioData(await blob.arrayBuffer());
  return runRaw(op,buf.getChannelData(0).slice(),buf.sampleRate,params,urgent);
 }
 window.SynkAnalysis={run,runRaw,fromBuffer:(op,audioBuffer,params,urgent)=>runRaw(op,audioBuffer.getChannelData(0).slice(),audioBuffer.sampleRate,params,urgent)};
})();
