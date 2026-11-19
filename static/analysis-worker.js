// SYNK//LAB analysis worker: all heavy DSP (BPM, beatgrid, phrase map, key, intro features, peaks) runs here,
// off the main thread, so the Web Audio mix (crossfader, phase lock, meters) never stalls.
// Input is always a mono Float32Array transferred from the main thread (decodeAudioData is not available in workers).
'use strict';
function analyzeAudio(buffer){const samples=buffer.getChannelData(0),rate=buffer.sampleRate,segStart=Math.min(Math.floor(rate*20),Math.max(0,Math.floor(samples.length/5))),segEnd=Math.min(samples.length,segStart+Math.floor(rate*74)),frame=256;let energy=[],sum=0,count=0,filter=0,total=0,n=0;const alpha=Math.min(.1,2*Math.PI*150/rate);for(let i=segStart;i<segEnd;i++){let s=samples[i];filter+=alpha*(s-filter);sum+=filter*filter;count++;if(count>=frame){energy.push(Math.sqrt(sum/count));sum=0;count=0}}for(let i=0;i<samples.length;i+=Math.max(1,Math.floor(samples.length/300000))){total+=samples[i]*samples[i];n++}let db=n?20*Math.log10(Math.sqrt(total/n)+1e-10):null;const flux=[];for(let i=2;i<energy.length;i++)flux.push(Math.max(0,energy[i]-((energy[i-1]+energy[i-2])/2)));if(flux.length<200)return {db,bpm:null,confidence:0};const mean=flux.reduce((s,x)=>s+x,0)/flux.length,centered=flux.map(x=>Math.max(0,x-mean*.7));const hz=rate/frame;let best={score:-1,lag:null};const scoreByLag=new Map(), vals=[];for(let lag=Math.floor(hz*60/170);lag<=Math.ceil(hz*60/100);lag++){let score=0;for(let i=lag;i<centered.length;i++)score+=centered[i]*centered[i-lag];const norm=score/(centered.length-lag);vals.push(norm);scoreByLag.set(lag,norm);if(norm>best.score)best={score:norm,lag}}const avg=vals.reduce((s,x)=>s+x,0)/vals.length;const conf=best.score/(avg+1e-9);const y0=scoreByLag.get(best.lag-1),y1=best.score,y2=scoreByLag.get(best.lag+1);let shift=0;if(Number.isFinite(y0)&&Number.isFinite(y2)&&Math.abs(y0-2*y1+y2)>1e-15)shift=Math.max(-1,Math.min(1,.5*(y0-y2)/(y0-2*y1+y2)));const tempo=60*hz/(best.lag+shift);return{db,bpm:best.score>0&&conf>=1.07?Math.round(tempo*10)/10:null,confidence:Math.round(conf*100)/100}}
function djIntroFeatures(buffer){
 const x=buffer.getChannelData(0),rate=buffer.sampleRate,frame=1024,introEnd=Math.min(x.length,Math.floor(rate*45));
 const rms=(a,b)=>{let sum=0,n=0,step=Math.max(1,Math.floor((b-a)/200000));for(let i=a;i<b;i+=step){sum+=x[i]*x[i];n++}return n?Math.sqrt(sum/n):0};
 const total=rms(0,x.length),intro=rms(0,introEnd);if(!total||introEnd<rate*5)return null;
 const env=[];for(let i=0;i+frame<=introEnd;i+=frame){let s2=0;for(let j=i;j<i+frame;j+=4)s2+=x[j]*x[j];env.push(Math.sqrt(s2/(frame/4)))}
 let onsets=0;for(let i=4;i<env.length;i++){const prev=(env[i-1]+env[i-2]+env[i-3]+env[i-4])/4;if(env[i]>prev*1.6&&env[i]>total*.25)onsets++}
 return {rmsDb:20*Math.log10(total+1e-9),introRatio:intro/total,onsetDensity:onsets/(introEnd/rate)};
}
function djGridOK(t){return !!(t&&t.bpm&&t.grid&&t.grid.src===t.bpm&&t.grid.anchors&&!t.grid.weak)}
function djSectOK(t){return !!(t&&djGridOK(t)&&t.sect&&t.sect.g===t.grid.bpm)}
function djKickFlux(x,rate,i0,i1,hop){
 const alpha=Math.min(.2,2*Math.PI*150/rate),n=Math.max(0,Math.floor((i1-i0)/hop)),e=new Float32Array(n);let f=0;
 for(let k=0;k<n;k++){let s=0;for(let j=i0+k*hop,end=j+hop;j<end;j++){f+=alpha*(x[j]-f);s+=f*f}e[k]=Math.sqrt(s/hop)}
 const fl=new Float32Array(n);for(let k=1;k<n;k++)fl[k]=Math.max(0,e[k]-e[k-1]);
 const sm=new Float32Array(n);for(let k=1;k<n-1;k++)sm[k]=.25*fl[k-1]+.5*fl[k]+.25*fl[k+1];return sm;
}
function djBestPhase(fl,P){
 let best={score:-1,phase:0,on:0};
 for(let ph=0;ph<P;ph+=.25){let s=0,c=0;for(let p=ph;p<fl.length-1;p+=P){s+=fl[Math.round(p)];c++}s/=Math.max(1,c);if(s>best.score)best={score:s,phase:ph,on:s}}
 return best;
}
function djKickClarity(fl,hz,A,per){
 const nearest=t=>{let a=A[0];for(const x of A)if(Math.abs(x.t-t)<Math.abs(a.t-t))a=x;return a};
 const dur=fl.length/hz;let on=0,off=0;
 for(let t=A[0].t;t<dur-2;t+=per){const a=nearest(t),bt=a.ph+Math.round((t-a.ph)/per)*per;if(bt<1||bt>dur-1)continue;
  on+=fl[Math.min(fl.length-1,Math.round(bt*hz))];off+=fl[Math.min(fl.length-1,Math.round((bt+per/2)*hz))]}
 return Math.round(on/Math.max(1e-9,off)*100)/100;
}
function djComputeGrid(buf,bpm){
 const x=buf.getChannelData(0),rate=buf.sampleRate,hop=128,dur=x.length/rate;if(dur<30)return null;
 const fl=djKickFlux(x,rate,0,x.length,hop),hz=rate/hop,len=Math.round(40*hz),stepH=Math.round(20*hz);
 const measure=(b,par2)=>{const per=60/b,P=per*hz,out=[];
  for(let st=0;;st+=stepH){const a=Math.min(st,Math.max(0,fl.length-len)),r=djBestPhase(fl.subarray(a,a+len),P);
   out.push({t:(a+len/2)/hz,ph:((((a+r.phase)/hz)%per)+per)%per,score:r.on});if(a+len>=fl.length)break}
  const sc=out.map(o=>o.score).sort((p,q)=>p-q),med=sc[Math.floor(sc.length/2)],strong=out.filter(o=>o.score>=med*.6);
  // Windows that locked onto the off-beat (half a beat away from the majority) are dropped.
  const half=per/2,par=[];let m=0;for(let i=0;i<strong.length;i++){if(i){let d=strong[i].ph-strong[i-1].ph;m+=Math.round(d/half)}par.push(((m%2)+2)%2)}
  if(!par2)return strong;const ones=par.filter(p=>p).length,keep=ones*2>par.length?1:0;return strong.filter((_,i)=>par[i]===keep)};
 const fit=(b,par2)=>{const A=measure(b,par2);if(A.length<3)return null;const per=60/b;let D=0;const pts=[[A[0].t,0]];
  for(let i=1;i<A.length;i++){let d=A[i].ph-A[i-1].ph;d-=Math.round(d/per)*per;D+=d;pts.push([A[i].t,D])}
  const n=pts.length,mt=pts.reduce((q,p)=>q+p[0],0)/n,md=pts.reduce((q,p)=>q+p[1],0)/n;let num=0,den=0;
  for(const [tt,dd] of pts){num+=(tt-mt)*(dd-md);den+=(tt-mt)**2}
  const slope=den?num/den:0,rms=Math.sqrt(pts.reduce((q,[tt,dd])=>q+(dd-md-slope*(tt-mt))**2,0)/n);return {A,slope,rms,per}};
 const solve=par2=>{let b=bpm,f=null;
  for(let pass=0;pass<3;pass++){f=fit(b,par2);if(!f)return null;if(pass<2)b=60/(f.per*(1+f.slope))}
  const sn=Math.round(b);if(Math.abs(b-sn)<.03&&sn!==Math.round(b*1000)/1000){const g=fit(sn,par2);if(g&&g.rms<=f.rms+.004){b=sn;f=g}}
  return {b,f}};
 const r1=solve(false),r2=solve(true);if(!r1&&!r2)return null;
 const pick=!r2||(r1&&(r1.f.rms<r2.f.rms-.003||(Math.abs(r1.f.rms-r2.f.rms)<=.003&&r1.f.A.length>=r2.f.A.length)))?r1:r2;
 const b=pick.b,f=pick.f;
 const resid=f.rms;
 // Kick clarity: flux on the predicted beats vs. halfway between them. A clear kick makes the phase trustworthy even when the anchors
 // scatter (35 ms rms on a steady 4/4 kick is fine; 59 ms on a track with no steady kick is not).
 const clar=djKickClarity(fl,hz,f.A,60/b);
 return {bpm:Math.round(b*1000)/1000,anchors:f.A.map(o=>({t:+o.t.toFixed(2),ph:+o.ph.toFixed(4)})),rms:Math.round(resid*1000),clar,weak:resid>.025&&!(resid<=.045&&clar>=2.5)};
}
function djSections(buf,grid){
 const x=buf.getChannelData(0),rate=buf.sampleRate,per=60/grid.bpm,len=16*per,p0=grid.anchors[0].ph,n=Math.floor((x.length/rate-p0)/len);
 if(n<4)return null;
 const alpha=Math.min(.2,2*Math.PI*150/rate),db=[],bass=[];let f=0;
 for(let k=0;k<n;k++){
  const i0=Math.floor((p0+k*len)*rate),i1=Math.min(x.length,Math.floor((p0+(k+1)*len)*rate));let s=0,b=0;
  for(let j=i0;j<i1;j++){f+=alpha*(x[j]-f);s+=x[j]*x[j];b+=f*f}
  const c=Math.max(1,i1-i0);db.push(Math.round(20*Math.log10(Math.sqrt(s/c)+1e-6)*10)/10);bass.push(Math.round(Math.sqrt(b/c)*1000)/1000);
 }
 return {v:1,g:grid.bpm,p0,per,db,bass};
}
function djFFT(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]]}}
 for(let len=2;len<=n;len<<=1){const ang=-2*Math.PI/len,wr=Math.cos(ang),wi=Math.sin(ang);for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let k=0;k<len/2;k++){const a=i+k,b=a+len/2,tr=re[b]*cr-im[b]*ci,ti=re[b]*ci+im[b]*cr;re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;const nr=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=nr}}}}
const DJ_MAJOR=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],DJ_MINOR=[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
const DJ_CAM_MAJ=[8,3,10,5,12,7,2,9,4,11,6,1];
function djCorr(a,b){const n=a.length,ma=a.reduce((s,x)=>s+x,0)/n,mb=b.reduce((s,x)=>s+x,0)/n;let num=0,da=0,db=0;for(let i=0;i<n;i++){num+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2}return num/Math.sqrt(da*db||1)}
function djTonal(buf){
 const x=buf.getChannelData(0),rate=buf.sampleRate,N=8192,f=Math.max(1,Math.round(rate/11025)),er=rate/f,total=x.length;
 if(total<N*f*4)return null;
 const hann=new Float64Array(N);for(let i=0;i<N;i++)hann[i]=.5-.5*Math.cos(2*Math.PI*i/(N-1));
 const re=new Float64Array(N),im=new Float64Array(N),chroma=new Float64Array(12),frames=40;let low=0,all=0;
 const first=Math.floor(total*.08),span=Math.floor(total*.84)-N*f;
 for(let k=0;k<frames;k++){
  const st=first+Math.floor(span*k/(frames-1));
  for(let i=0;i<N;i++){let s=0;for(let j=0;j<f;j++)s+=x[st+i*f+j];re[i]=s/f*hann[i];im[i]=0}
  djFFT(re,im);
  for(let b=1;b<N/2;b++){const fr=b*er/N,m=re[b]*re[b]+im[b]*im[b];
   if(fr>=30&&fr<=5000){all+=m;if(fr<=150)low+=m}
   if(fr>=60&&fr<=1600){const pc=(((Math.round(12*Math.log2(fr/440))+69)%12)+12)%12;chroma[pc]+=Math.sqrt(m)}}
 }
 const cands=[];for(let p=0;p<12;p++){
  const maj=DJ_MAJOR.map((_,i)=>DJ_MAJOR[(i-p+12)%12]),min=DJ_MINOR.map((_,i)=>DJ_MINOR[(i-p+12)%12]);
  cands.push({key:DJ_CAM_MAJ[p]+'B',r:djCorr(Array.from(chroma),maj)});
  cands.push({key:DJ_CAM_MAJ[(p+3)%12]+'A',r:djCorr(Array.from(chroma),min)});
 }
 cands.sort((a,b)=>b.r-a.r);
 return {v:1,key:cands[0].key,conf:+cands[0].r.toFixed(2),margin:+(cands[0].r-cands[1].r).toFixed(3),alt:cands[1].key,bass:+(low/Math.max(1e-9,all)).toFixed(3)};
}

const mk=(x,rate)=>({getChannelData:()=>x,sampleRate:rate,duration:x.length/rate});
function peaksOf(sample){
 const bins=380,step=Math.max(1,Math.floor(sample.length/bins)),peaks=[];
 for(let i=0;i<bins;i++){
  let peak=0,start=i*step,end=Math.min(sample.length,start+step),skip=Math.max(1,Math.floor(step/160));
  for(let j=start;j<end;j+=skip)peak=Math.max(peak,Math.abs(sample[j]));
  peaks.push(peak);
 }
 return peaks;
}
// 100 peaks per second (max |sample| per 10 ms) for the scrolling mix view on the phone; ~144 KB for a 6 min track.
function peaksHi(x,rate){
 const per=Math.max(1,Math.floor(rate/100)),n=Math.ceil(x.length/per),out=new Float32Array(n);
 for(let i=0;i<n;i++){let p=0;const e=Math.min(x.length,(i+1)*per);for(let j=i*per;j<e;j++){const v=x[j]<0?-x[j]:x[j];if(v>p)p=v}out[i]=p}
 return out;
}
const handlers={
 bpm:({x,rate})=>analyzeAudio(mk(x,rate)),
 analyze:({x,rate,doBpm})=>{const b=mk(x,rate);return {duration:b.duration*1000,peaks:peaksOf(x),hi:peaksHi(x,rate),bpm:doBpm?analyzeAudio(b).bpm:null,intro:djIntroFeatures(b)}},
 grid:({x,rate,bpm})=>{const g=djComputeGrid(mk(x,rate),bpm);if(g){g.src=bpm;g.v=3}return g},
 // Same sequence as the former main-thread djPrepareTrack; t is a plain snapshot of the track fields and is returned updated.
 prepare:({x,rate,t})=>{
  const b=mk(x,rate);
  if(!t.duration)t.duration=b.duration*1000;
  if(!t.bpm){const a=analyzeAudio(b);if(a.bpm){t.bpm=a.bpm;t.bpmEstimated=true}}
  if(!t.intro)t.intro=djIntroFeatures(b);
  if(t.bpm&&!(t.grid&&t.grid.v===3&&t.grid.src===t.bpm)){
   const g=djComputeGrid(b,t.bpm);
   if(g){g.v=3;if(t.bpmEstimated&&!g.weak)t.bpm=Math.round(g.bpm*10)/10;g.src=t.bpm;t.grid=g}
  }
  if(djGridOK(t)&&!djSectOK(t)){const s=djSections(b,t.grid);if(s)t.sect=s}
  if(!t.tonal||t.tonal.v!==1){const ton=djTonal(b);if(ton)t.tonal=ton}
  return t;
 }
};
self.onmessage=e=>{
 const {id,op,payload}=e.data;
 try{const h=handlers[op];if(!h)throw new Error('unknown op '+op);self.postMessage({id,ok:true,result:h(payload)})}
 catch(err){self.postMessage({id,ok:false,error:String(err&&err.message||err)})}
};
