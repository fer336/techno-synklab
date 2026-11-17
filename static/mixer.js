/* SYNK//LAB v0.2 Auto DJ · Web Audio / local files / official embed previews.
 * No streaming ripping, invented tracks, or unlicensed third-party audio extraction.
 */
'use strict';
const djMedia = new Map();
const djUrls = new Map();
const djPeaks = new Map();
const djReady = new Set();
let djDBPromise;
let djCtx=null, djMaster=null, djCompressor=null, djRecordingStream=null, djMasterAnalyser=null;
let djRecorder=null, djChunks=[];
let djPreviewUrl=null, djPreviewKind=null;
const djDecks={A:{id:null,el:$('#djAudioA'),audio:$('#djAudioA'),media:null,mode:'file',kill:{low:false,mid:false,high:false},loop:null,loading:false},B:{id:null,el:$('#djAudioB'),audio:$('#djAudioB'),media:null,mode:'file',kill:{low:false,mid:false,high:false},loop:null,loading:false}};
for(const k of ['A','B'])djDecks[k].media=djDecks[k].audio;
const djAuto={enabled:false,active:'A',currentId:null,transition:null,pending:false,failed:new Set(),epoch:0,ramp:null,plan:null};
const djMaxFile=100*1024*1024;
function djDB(){
 if(!('indexedDB' in window))return Promise.reject(new Error('IndexedDB no está disponible'));
 if(djDBPromise)return djDBPromise;
 djDBPromise=new Promise((resolve,reject)=>{
  const r=indexedDB.open('synklab_audio_02',1);
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('files'))r.result.createObjectStore('files')};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('Error de IndexedDB'));
 });
 return djDBPromise;
}
async function djStorage(action,id,data){
 const db=await djDB();return new Promise((resolve,reject)=>{
  const tx=db.transaction('files',action==='get'||action==='keys'?'readonly':'readwrite');
  const st=tx.objectStore('files');let req;
  if(action==='put')req=st.put(data,id);
  else if(action==='get')req=st.get(id);
  else if(action==='keys')req=st.getAllKeys();
  else if(action==='delete')req=st.delete(id);
  else if(action==='clear')req=st.clear();
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  tx.onerror=()=>reject(tx.error);
 });
}
async function registerDJFile(track,blob){
 if(!track||!blob)return;
 djMedia.set(track.id,blob);djReady.add(track.id);
 try{await djStorage('put',track.id,blob)}
 catch(e){toast('Audio disponible solo hasta cerrar esta pestaña (almacenamiento no disponible).',true)}
 renderDJ();
}
async function removeDJFile(id){
 if(!id)return;
 for(const letter of ['A','B'])if(djDecks[letter].id===id){djDecks[letter].el.pause();djDecks[letter].el.removeAttribute('src');djDecks[letter].el.load();djDecks[letter].id=null;djDecks[letter].loop=null;}
 djMedia.delete(id);djReady.delete(id);djPeaks.delete(id);
 if(djUrls.has(id)){URL.revokeObjectURL(djUrls.get(id));djUrls.delete(id)}
 try{await djStorage('delete',id)}catch(e){}
 renderDJ();
}
async function djBlobFor(id){if(djMedia.has(id))return djMedia.get(id);try{const blob=await djStorage('get',id);if(blob){djMedia.set(id,blob);djReady.add(id)}return blob||null}catch(e){return null}}
async function djFileURL(id){if(djUrls.has(id))return djUrls.get(id);const blob=await djBlobFor(id);if(!blob)return null;const u=URL.createObjectURL(blob);djUrls.set(id,u);return u}
async function djLoadStoredFiles(){try{const ids=await djStorage('keys');const valid=new Set(tracks.map(x=>x.id));for(const id of ids)if(valid.has(id))djReady.add(id)}catch(e){/* session-only fallback */}renderDJ()}
function djTrack(id){return tracks.find(x=>x.id===id)||null}
function djAvailable(){return tracks.filter(x=>djPlayable(x))}
function djNextTrack(id){const current=tracks.findIndex(t=>t.id===id);return tracks.slice(current+1).find(x=>djPlayable(x)&&!djAuto.failed.has(x.id))||null}
function djClock(seconds){if(!Number.isFinite(seconds))return '--:--';const s=Math.max(0,Math.floor(seconds));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')}
function djLink(href){try{const u=new URL(href);return ['http:','https:'].includes(u.protocol)?u.href:null}catch(e){return null}}
function renderDJ(){
 const count=djAvailable().length;
 $('#djImportStatus').textContent=`${count} archivo${count!==1?'s':''} mezclable${count!==1?'s':''}`;
 $('#djQueueCount').textContent=`${count} AUDIO DISPONIBLES · ${tracks.length} TRACKS EN EL SET`;
 $('#djSetTitle').textContent=$('#setName').value||'Mi DJ set';
 for(const deck of ['A','B']){
  const select=$('#djSelect'+deck),old=djDecks[deck].id;
  select.innerHTML='<option value="">Seleccionar archivo...</option>'+djAvailable().map(t=>`<option value="${escAttr(t.id)}">${escapeHTML((t.artist?t.artist+' — ':'')+t.title)}</option>`).join('');
  if(old&&djReady.has(old))select.value=old;
 }
 if(!tracks.length){$('#djQueue').innerHTML=emptyArea('Tu set está vacío','Importá archivos MP3/WAV para crear el running order y reproducirlo con Auto DJ.','▤');return}
 $('#djQueue').innerHTML=tracks.map((t,i)=>{
  const file=djReady.has(t.id),extKind=file?null:djExternalKind(t),ready=file||!!extKind,link=djLink(t.externalUrl),state=file?'● AUDIO LISTO':extKind?'◐ '+(extKind==='stream'?'URL':extKind.toUpperCase())+' · SOLO VOLUMEN':link?'↗ REFERENCIA':'○ SIN AUDIO';
  return `<div class="dj-queue-track"><div class="dj-queue-n">${i+1}</div><div><strong>${escapeHTML((t.artist?t.artist+' — ':'')+t.title)}</strong><small>${escapeHTML(t.label||t.source||'Sin fuente')} · ${t.bpm?(Number(t.bpm).toFixed(1)+' BPM'+(t.bpmEstimated?' ~':'')):'BPM —'} · ${escapeHTML(t.key||'KEY —')}</small></div><span class="dj-queue-state${ready?'':' missing'}">${state}</span><span class="dj-queue-time">${durationText(t.duration)}</span><div class="rowbuttons"><button class="btn sm ghost djMove" data-i="${i}" data-dir="-1" title="Subir">↑</button><button class="btn sm ghost djMove" data-i="${i}" data-dir="1" title="Bajar">↓</button>${ready?`<button class="btn sm ghost djLoad" data-id="${escAttr(t.id)}" data-deck="A">A</button><button class="btn sm ghost djLoad" data-id="${escAttr(t.id)}" data-deck="B">B</button>`:link?`<a class="btn sm ghost" href="${escAttr(link)}" target="_blank" rel="noopener noreferrer">VER ↗</a>`:''}</div></div>`
 }).join('');
 $$('.djMove').forEach(el=>el.addEventListener('click',()=>{const i=+el.dataset.i,j=i+(+el.dataset.dir);if(j<0||j>=tracks.length)return;[tracks[i],tracks[j]]=[tracks[j],tracks[i]];persist();renderSet();renderDJ()}));
 $$('.djLoad').forEach(el=>el.addEventListener('click',async()=>{djStopAuto();await djLoadDeck(el.dataset.deck,el.dataset.id)}));
}
async function djAudioDuration(blob){const src=URL.createObjectURL(blob);try{return await new Promise((resolve,reject)=>{
 const a=new Audio();let finished=false;
 const complete=(value,error)=>{if(finished)return;finished=true;clearTimeout(timeout);a.removeAttribute('src');a.load();error?reject(error):resolve(value)};
 const timeout=setTimeout(()=>complete(null,new Error('Audio metadata timeout')),12000);
 a.onloadedmetadata=()=>complete(Number.isFinite(a.duration)?a.duration*1000:null);
 a.onerror=()=>complete(null,new Error('Formato de audio no admitido'));
 a.preload='metadata';a.src=src;
})}finally{URL.revokeObjectURL(src)}}
// Intro features for the Set Advisor: how loud/dense the first ~45 s are relative to the whole track.
function djIntroFeatures(buffer){
 const x=buffer.getChannelData(0),rate=buffer.sampleRate,frame=1024,introEnd=Math.min(x.length,Math.floor(rate*45));
 const rms=(a,b)=>{let sum=0,n=0,step=Math.max(1,Math.floor((b-a)/200000));for(let i=a;i<b;i+=step){sum+=x[i]*x[i];n++}return n?Math.sqrt(sum/n):0};
 const total=rms(0,x.length),intro=rms(0,introEnd);if(!total||introEnd<rate*5)return null;
 const env=[];for(let i=0;i+frame<=introEnd;i+=frame){let s2=0;for(let j=i;j<i+frame;j+=4)s2+=x[j]*x[j];env.push(Math.sqrt(s2/(frame/4)))}
 let onsets=0;for(let i=4;i<env.length;i++){const prev=(env[i-1]+env[i-2]+env[i-3]+env[i-4])/4;if(env[i]>prev*1.6&&env[i]>total*.25)onsets++}
 return {rmsDb:20*Math.log10(total+1e-9),introRatio:intro/total,onsetDensity:onsets/(introEnd/rate)};
}
async function djAnalyzeBlob(id,blob,doBpm){
 const ctx=new (window.AudioContext||window.webkitAudioContext)();
 try{
  const decoded=await ctx.decodeAudioData(await blob.arrayBuffer());
  const sample=decoded.getChannelData(0),bins=380,step=Math.max(1,Math.floor(sample.length/bins));
  const peaks=[];
  for(let i=0;i<bins;i++){
   let peak=0,start=i*step,end=Math.min(sample.length,start+step),skip=Math.max(1,Math.floor(step/160));
   for(let j=start;j<end;j+=skip)peak=Math.max(peak,Math.abs(sample[j]));
   peaks.push(peak);
  }
  djPeaks.set(id,peaks);
  return {duration:decoded.duration*1000,bpm:doBpm?analyzeAudio(decoded).bpm:null,intro:djIntroFeatures(decoded)};
 }finally{await ctx.close().catch(()=>{})}
}
async function djImportFiles(list,source='Imported audio'){
 const files=[...list].filter(Boolean);if(!files.length)return;
 const accepted=files.slice(0,35);
 if(files.length>35)toast('Se importan hasta 35 archivos por operación.',true);
 for(let i=0;i<accepted.length;i++){
  const file=accepted[i];$('#djImportStatus').textContent=`IMPORTANDO ${i+1}/${accepted.length}: ${file.name.slice(0,35)}`;
  if(file.size>djMaxFile||file.size===0||(!/^audio\//.test(file.type)&&!/\.(mp3|wav|flac|m4a|ogg|aac)$/i.test(file.name))){toast('Archivo inválido o demasiado grande: '+file.name,true);continue}
  let duration=null;
  try{duration=await djAudioDuration(file)}catch(e){toast('No se pudo leer el audio: '+file.name,true);continue}
  const base=file.name.replace(/\.[^.]+$/,''),split=/^(.{1,80}?) - (.+)$/.exec(base);
  const t=addTrack({artist:split?split[1]:'',title:split?split[2]:base,duration,source});if(!t)break;
  await registerDJFile(t,file);
  $('#djImportStatus').textContent=`ANALIZANDO ${i+1}/${accepted.length}`+($('#djEstimateBPM').checked?' · BPM orientativo':'');
  try{const analysis=await djAnalyzeBlob(t.id,file,$('#djEstimateBPM').checked);if(analysis.bpm){t.bpm=analysis.bpm;t.bpmEstimated=true}if(analysis.intro)t.intro=analysis.intro;t.duration=analysis.duration;persist()}catch(e){/* playable still, no fake BPM */}
  renderDJ();
 }
 renderSet();renderDJ();djRunAdvisor();toast('Importación terminada. Revisá las sugerencias de apertura (04 / Set Advisor).');
}
const djDrop=$('#djDrop');
djDrop.addEventListener('click',()=>$('#djFileInput').click());
djDrop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#djFileInput').click()}});
$('#djFileInput').addEventListener('change',async e=>{await djImportFiles(e.target.files);e.target.value=''});
for(const evt of ['dragenter','dragover'])djDrop.addEventListener(evt,e=>{e.preventDefault();djDrop.classList.add('over')});
for(const evt of ['dragleave','drop'])djDrop.addEventListener(evt,e=>{e.preventDefault();djDrop.classList.remove('over')});
djDrop.addEventListener('drop',e=>djImportFiles(e.dataTransfer.files));
// Provider links can be embedded or searched, not passed into Web Audio.
function djIdentifySource(raw){
 const href=djLink(raw);if(!href)return null;
 const url=new URL(href),host=url.hostname.toLowerCase();
 if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtu.be','www.youtube-nocookie.com'].includes(host)){
  const parts=url.pathname.split('/').filter(Boolean);
  const vid=host.includes('youtu.be')?parts[0]:(parts[0]==='shorts'||parts[0]==='embed'||parts[0]==='live'?parts[1]:url.searchParams.get('v'));
  return vid&&/^[\w-]{11}$/.test(vid)?{kind:'youtube',url:href,id:vid,src:`https://www.youtube-nocookie.com/embed/${vid}`}:{kind:'unsupported',url:href};
 }
 if(['soundcloud.com','www.soundcloud.com','m.soundcloud.com'].includes(host)&&url.pathname!=='/'){
  return{kind:'soundcloud',url:href,src:'https://w.soundcloud.com/player/?url='+encodeURIComponent(href)+'&color=%23caff1a&auto_play=false&show_artwork=true&show_user=true'};
 }
 if(/\.(mp3|wav|flac|m4a|ogg|aac)(?:$|[?#])/i.test(url.pathname+url.search))return{kind:'file',url:href};
 return{kind:'unsupported',url:href};
}
async function djFetchDirectFile(source){
 $('#djPreview').hidden=false;$('#djPreview').innerHTML='<h3>IMPORTANDO ARCHIVO DIRECTO...</h3><p class="note">El servidor debe permitir CORS. No se utilizan proxies ni se descargan streams de YouTube/SoundCloud.</p>';
 try{
  const r=await fetch(source.url,{mode:'cors',credentials:'omit',redirect:'follow'});
  if(!r.ok)throw new Error('HTTP '+r.status);
  const length=Number(r.headers.get('Content-Length'))||0;
  if(length>djMaxFile)throw new Error('Archivo mayor de 100 MB');
  const blob=await r.blob();if(blob.size>djMaxFile)throw new Error('Archivo mayor de 100 MB');
  if(/text\/html|application\/json/i.test(blob.type))throw new Error('El enlace no devolvió un archivo de audio');
  const name=decodeURIComponent(new URL(source.url).pathname.split('/').pop()||'audio-remoto.mp3').slice(0,160);
  await djImportFiles([new File([blob],name,{type:blob.type||'audio/mpeg'})],'Direct audio URL');
  $('#djPreview').innerHTML='<div class="modebadge">✓ AUDIO DIRECTO IMPORTADO</div><p class="note">El archivo se descargó en este navegador desde una URL que lo permite. Aparece en el set y en los decks.</p>';
 }catch(e){djPreviewKind='stream';$('#djSaveReference').disabled=false;$('#djPreview').innerHTML='<h3>NO SE PUDO IMPORTAR AL MIXER</h3><p class="note">'+escapeHTML(e.message)+'. Si el enlace es un audio reproducible, podés agregarlo con + REFERENCIA: se mezcla solo por volumen (sin EQ ni efectos). Para procesarlo, subí el archivo desde tu equipo.</p>';toast('Sin CORS: se puede agregar como stream (solo volumen)',true)}
}
$('#djLinkForm').addEventListener('submit',async e=>{
 e.preventDefault();const source=djIdentifySource($('#djLink').value.trim());if(!source){toast('URL no válida',true);return}
 djPreviewUrl=source.url;djPreviewKind=source.kind;
 const preview=$('#djPreview');preview.hidden=false;
 $('#djSaveReference').disabled=source.kind==='file';$('#djDownload').disabled=!(djDownloadOK&&(source.kind==='youtube'||source.kind==='soundcloud'));
 if(source.kind==='file'){await djFetchDirectFile(source);return}
 if(source.kind==='youtube'){
  fetch('/api/youtube?url='+encodeURIComponent(source.url)).then(r=>r.ok?r.json():null).then(j=>{if(j?.title&&!$('#djLinkTitle').value.trim())$('#djLinkTitle').value=j.title}).catch(()=>{});
  preview.innerHTML='<h3>YOUTUBE / REPRODUCTOR OFICIAL</h3><iframe class="youtube" src="'+escAttr(source.src)+'" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen title="YouTube preview"></iframe><small>Podés agregarlo al set (+ REFERENCIA): Auto DJ lo mezcla solo por volumen. No se puede ecualizar ni aplicar efectos porque YouTube no entrega su audio al mixer, y no entra en la grabación.</small>';
 }else if(source.kind==='soundcloud'){
  preview.innerHTML='<h3>SOUNDCLOUD / REPRODUCTOR OFICIAL</h3><iframe src="'+escAttr(source.src)+'" allow="autoplay" title="SoundCloud preview"></iframe><small>Podés agregarlo al set (+ REFERENCIA): Auto DJ lo mezcla solo por volumen. No se puede ecualizar ni aplicar efectos porque SoundCloud no entrega su audio al mixer, y no entra en la grabación.</small>';
 }else{
  preview.innerHTML='<h3>ENLACE EXTERNO</h3><a class="btn sm ghost" target="_blank" rel="noopener noreferrer" href="'+escAttr(source.url)+'">ABRIR FUENTE ORIGINAL ↗</a><p class="note">No es un audio directo compatible ni un enlace de YouTube/SoundCloud embebible.</p>';
 }
});
// Optional download (yt-dlp on the local server): imports the file into the full mixer (EQ, FX, loops, recording).
let djDownloadOK=false;
fetch('/api/download/status').then(r=>r.ok?r.json():null).then(j=>{djDownloadOK=!!j?.enabled;if(!djDownloadOK){$('#djDownloadNote').textContent='Descargar no está disponible (el servidor no tiene yt-dlp o no es local). Los temas se agregan como referencia y se mezclan solo por volumen.'}else{$('#djDownloadNote').title='Se guarda también en '+j.inbox}}).catch(()=>{djDownloadOK=false});
$('#djDownload').addEventListener('click',async()=>{
 if(!djPreviewUrl||!['youtube','soundcloud'].includes(djPreviewKind))return;
 const btn=$('#djDownload'),status=$('#djImportStatus'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
 btn.disabled=true;
 try{
  status.textContent='DESCARGANDO...';
  const start=await fetch('/api/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:djPreviewUrl})});
  const job=await start.json();if(!start.ok)throw new Error(job.detail||'No se pudo iniciar la descarga');
  const t0=Date.now();let info;
  while(true){
   await sleep(1200);const r=await fetch('/api/download/'+job.id);const s=await r.json();if(!r.ok)throw new Error(s.detail||'Descarga perdida');
   if(s.status==='done'){info=s;break}
   if(s.status==='error')throw new Error(s.error||'Falló la descarga');
   if(Date.now()-t0>620000)throw new Error('Tiempo agotado');
   status.textContent=(s.status==='queued'?'EN COLA':'DESCARGANDO')+' · '+Math.round((Date.now()-t0)/1000)+'s';
  }
  const file=await fetch(`/api/download/${job.id}/file`);if(!file.ok)throw new Error('No se pudo recuperar el archivo');
  await djImportFiles([new File([await file.blob()],info.name,{type:'audio/mpeg'})],'Downloaded (yt-dlp)');
 }catch(e){status.textContent='DESCARGA FALLIDA';toast('Descarga no disponible: '+e.message,true)}
 finally{btn.disabled=!djDownloadOK}
});
$('#djSaveReference').addEventListener('click',()=>{
 if(!djPreviewUrl||djPreviewKind==='file')return;
 let title=$('#djLinkTitle').value.trim();
 if(!title&&djPreviewKind==='stream'){try{title=decodeURIComponent(new URL(djPreviewUrl).pathname.split('/').pop()||'').replace(/\.[^.]+$/,'')}catch(e){}}
 if(!title){toast('Escribí el título del track (SoundCloud no lo entrega automáticamente).',true);$('#djLinkTitle').focus();return}
 const label=djPreviewKind==='youtube'?'YouTube':djPreviewKind==='soundcloud'?'SoundCloud':'Direct URL';
 const added=addTrack({title,source:djPreviewKind==='stream'?'Direct URL stream':label+' reference',externalUrl:djPreviewUrl});
 if(added){$('#djLinkTitle').value='';renderSet();renderDJ();toast(label+': agregado al set. Se mezcla solo por volumen; cargá el BPM en el Set Builder si querés usar beat jump.')}
});
function djSearchURLs(){const q=$('#djFindQuery').value.trim();$('#djBeatportSearch').href='https://www.beatport.com/search'+(q?'?q='+encodeURIComponent(q):'');$('#djSoundcloudSearch').href='https://soundcloud.com/search'+(q?'?q='+encodeURIComponent(q):'');$('#djYoutubeSearch').href='https://www.youtube.com/results?search_query='+encodeURIComponent(q||'techno')}
$('#djFindQuery').addEventListener('input',djSearchURLs);
// Graph setup: media element -> HP -> LP -> low/mid/high EQ -> analyser -> gain -> master.
// Echo branch: EQ -> send -> delay -> feedback (capped) -> wet -> gain.
function djReverbImpulse(ctx){const len=Math.floor(ctx.sampleRate*2.2),buf=ctx.createBuffer(2,len,ctx.sampleRate);
 for(let c=0;c<2;c++){const ch=buf.getChannelData(c);for(let i=0;i<len;i++)ch[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.6)}return buf}
async function djEnsureMixer(){
 if(djCtx){if(djCtx.state==='suspended')await djCtx.resume();return}
 const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('Web Audio no disponible');
 djCtx=new AC();
 djMaster=djCtx.createGain();djMaster.gain.value=.82;
 djMasterAnalyser=djCtx.createAnalyser();djMasterAnalyser.fftSize=512;
 djCompressor=djCtx.createDynamicsCompressor();djCompressor.threshold.value=-4;djCompressor.knee.value=0;djCompressor.ratio.value=16;djCompressor.attack.value=.004;djCompressor.release.value=.16;
 djRecordingStream=djCtx.createMediaStreamDestination();
 djMaster.connect(djMasterAnalyser);djMasterAnalyser.connect(djCompressor);djCompressor.connect(djCtx.destination);djCompressor.connect(djRecordingStream);
 for(const deck of ['A','B']){
  const d=djDecks[deck];d.source=djCtx.createMediaElementSource(d.audio);
  d.hp=djCtx.createBiquadFilter();d.hp.type='highpass';d.hp.frequency.value=20;
  d.lp=djCtx.createBiquadFilter();d.lp.type='lowpass';d.lp.frequency.value=19000;
  d.low=djCtx.createBiquadFilter();d.low.type='lowshelf';d.low.frequency.value=180;
  d.mid=djCtx.createBiquadFilter();d.mid.type='peaking';d.mid.frequency.value=1100;d.mid.Q.value=.7;
  d.high=djCtx.createBiquadFilter();d.high.type='highshelf';d.high.frequency.value=5500;
  d.analyser=djCtx.createAnalyser();d.analyser.fftSize=256;
  d.gain=djCtx.createGain();d.trim=djCtx.createGain();
  d.echoSend=djCtx.createGain();d.echoSend.gain.value=0;
  d.echoDelay=djCtx.createDelay(2);d.echoDelay.delayTime.value=.32;
  d.echoFeedback=djCtx.createGain();d.echoFeedback.gain.value=.29;
  d.echoWet=djCtx.createGain();d.echoWet.gain.value=.7;
  d.source.connect(d.hp);d.hp.connect(d.lp);d.lp.connect(d.low);d.low.connect(d.mid);d.mid.connect(d.high);
  d.high.connect(d.analyser);d.analyser.connect(d.gain);
  d.gain.connect(d.echoSend);d.echoSend.connect(d.echoDelay);d.echoDelay.connect(d.echoFeedback);d.echoFeedback.connect(d.echoDelay);d.echoDelay.connect(d.echoWet);d.echoWet.connect(d.trim);
  // Reverb: high -> send -> convolver -> wet -> gain
  d.revSend=djCtx.createGain();d.revSend.gain.value=0;d.conv=djCtx.createConvolver();d.conv.buffer=djReverbImpulse(djCtx);d.revWet=djCtx.createGain();d.revWet.gain.value=.9;
  d.gain.connect(d.revSend);d.revSend.connect(d.conv);d.conv.connect(d.revWet);d.revWet.connect(d.trim);
  // Flanger: short delay swept by an LFO, feedback capped below 0.5
  d.flDelay=djCtx.createDelay(.05);d.flDelay.delayTime.value=.004;d.flFb=djCtx.createGain();d.flFb.gain.value=.45;d.flWet=djCtx.createGain();d.flWet.gain.value=0;
  d.flLfo=djCtx.createOscillator();d.flLfo.type='sine';d.flLfo.frequency.value=.22;d.flDepth=djCtx.createGain();d.flDepth.gain.value=.0025;
  d.flLfo.connect(d.flDepth);d.flDepth.connect(d.flDelay.delayTime);d.flLfo.start();
  d.gain.connect(d.flDelay);d.flDelay.connect(d.flFb);d.flFb.connect(d.flDelay);d.flDelay.connect(d.flWet);d.flWet.connect(d.trim);
  d.gain.connect(d.trim);d.trim.connect(djMaster);
  djBindMedia(deck,d.audio);
  djApplyFX(deck);
 }
 djSetCrossfader(0);
 $('#djEngineStatus').textContent='AUDIO ENGINE READY';
}
function djApplyFX(deck){
 const d=djDecks[deck],suffix=deck;
 const rate=+$('#djRate'+suffix).value/100;
 if(d.mode!=='embed'){d.el.playbackRate=rate*(d.pll||1);d.el.preservesPitch=$('#djKeyLock'+suffix).checked}
 $('#djRateVal'+suffix).textContent=(Math.round(rate*1000)/10)+'%';
 if(!djCtx)return;
 const hp=+$('#djHp'+suffix).value,lp=+$('#djLp'+suffix).value;
 d.hp.frequency.setTargetAtTime(20*Math.pow(100,hp/100),djCtx.currentTime,.015);
 d.lp.frequency.setTargetAtTime(19000*Math.pow(19000/500, -lp/100),djCtx.currentTime,.015);
 $('#djHpVal'+suffix).textContent=hp?Math.round(20*Math.pow(100,hp/100))+'Hz':'OFF';
 $('#djLpVal'+suffix).textContent=lp?Math.round(19000*Math.pow(19000/500,-lp/100))+'Hz':'OFF';
 for(const [ctrl,node] of [['Low','low'],['Mid','mid'],['High','high']]){
  const val=+$('#dj'+ctrl+suffix).value;d[node].gain.setTargetAtTime(d.kill[node]?-40:val,djCtx.currentTime,.015);
  $('#dj'+ctrl+'Val'+suffix).textContent=(val>0?'+':'')+val+' dB';
 }
 const echo=+$('#djEcho'+suffix).value;d.echoSend.gain.setTargetAtTime(echo/100*.6,djCtx.currentTime,.015);$('#djEchoVal'+suffix).textContent=echo+'%';
 const rev=+$('#djReverb'+suffix).value;d.revSend.gain.setTargetAtTime(rev/100*.9,djCtx.currentTime,.02);$('#djReverbVal'+suffix).textContent=rev+'%';
 const fl=+$('#djFlanger'+suffix).value;d.flWet.gain.setTargetAtTime(fl/100*.7,djCtx.currentTime,.02);$('#djFlangerVal'+suffix).textContent=fl+'%';
 d.flLfo.frequency.setTargetAtTime(.22,djCtx.currentTime,.1);d.trim.gain.setTargetAtTime(djTrimFor(d),djCtx.currentTime,.05);
}
for(const deck of ['A','B'])$('#djRate'+deck).addEventListener('input',()=>{djAuto.ramp=null});
for(const deck of ['A','B'])for(const n of ['Rate','Hp','Lp','Low','Mid','High','Echo','Reverb','Flanger']){
 $('#dj'+n+deck).addEventListener('input',()=>djApplyFX(deck));
}
function djSetCrossfader(value){const v=Math.max(0,Math.min(100,Number(value)));$('#djCrossfade').value=v;$('#djFaderLabel').textContent=`A ${Math.round(100-v)}% · B ${Math.round(v)}%`;
 const theta=v/100*Math.PI/2;djApplyMediaVolumes(Math.cos(theta),Math.sin(theta));if(!djCtx)return;djDecks.A.gain.gain.setTargetAtTime(Math.cos(theta),djCtx.currentTime,.008);djDecks.B.gain.gain.setTargetAtTime(Math.sin(theta),djCtx.currentTime,.008);
}
$('#djCrossfade').addEventListener('input',e=>{djStopAuto();djSetCrossfader(e.target.value)});
function djDrawWave(deck){
 const d=djDecks[deck],canvas=$('#djWave'+deck),ctx=canvas.getContext('2d');const w=canvas.width,h=canvas.height;
 ctx.clearRect(0,0,w,h);ctx.fillStyle='#0b150d';ctx.fillRect(0,0,w,h);
 ctx.strokeStyle='#2d432b';ctx.lineWidth=1;
 for(let i=1;i<8;i++){ctx.beginPath();ctx.moveTo(w*i/8,0);ctx.lineTo(w*i/8,h);ctx.stroke()}
 const p=d.id?djPeaks.get(d.id):null;
 if(!p){ctx.fillStyle='#618360';ctx.font='14px monospace';ctx.textAlign='center';ctx.fillText(d.id?(d.mode==='file'?'FORMA DE ONDA NO DISPONIBLE':'FUENTE EXTERNA · SOLO VOLUMEN'):'LOAD A TRACK',w/2,h/2+4);return}
 const prog=d.el.duration?Math.min(1,d.el.currentTime/d.el.duration):0,barW=w/p.length;
 for(let i=0;i<p.length;i++){
  const height=Math.max(1,p[i]*(h-16)*.94),x=i*barW;
  ctx.fillStyle=i/p.length<=prog?'#e1ff8d':'#76a83c';ctx.fillRect(x,(h-height)/2,Math.max(1,barW-.6),height);
 }
 if(d.loop){const x=d.loop.start/d.el.duration*w,xe=d.loop.end/d.el.duration*w;ctx.fillStyle='#b9ff2540';ctx.fillRect(x,0,xe-x,h)}
 ctx.strokeStyle='#eaffbd';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(prog*w,0);ctx.lineTo(prog*w,h);ctx.stroke();
}
async function djLoadDeck(deck,id){
 const d=djDecks[deck];if(d.loading)return false;
 if(!id){djSetDeckMode(deck,'file');d.el.pause();d.el.removeAttribute('src');d.el.load();d.id=null;d.loop=null;djDrawWave(deck);djRefreshCues(deck);return false}
 const t=djTrack(id);if(!t||!djPlayable(t)){toast('Este track no tiene audio mezclable',true);return false}
 d.loading=true;
 try{
  const ext=djReady.has(id)?null:djExternalKind(t);
  if(ext){
   const info=ext==='stream'?null:djIdentifySource(t.externalUrl);
   djSetDeckMode(deck,ext==='stream'?'stream':'embed',host=>ext==='stream'?djMakeStream(t.externalUrl):ext==='youtube'?new DJYouTube(info,host):new DJSoundCloud(info,host));
   d.loop=null;d.id=id;const media=d.media;
   media.ready.then(()=>{if(d.id!==id)return;const dur=media.duration;if(Number.isFinite(dur)&&dur>0&&!t.duration){t.duration=dur*1000;persist();renderDJ()}$('#djState'+deck).textContent='LOADED · '+(t.source||'EXTERNAL')})
    .catch(e=>{if(d.id!==id)return;$('#djState'+deck).textContent='ERROR';toast('No se pudo cargar "'+t.title+'": '+(e?.message||'fuente externa no disponible'),true)});
  }else{
   djSetDeckMode(deck,'file');
   const url=await djFileURL(id);if(!url)throw new Error('Archivo no encontrado, volvé a importarlo');
   d.el.pause();d.el.src=url;d.el.load();d.loop=null;d.id=id;
  }
  $('#djSelect'+deck).value=id;$('#djTrack'+deck).textContent=(t.artist?t.artist+' — ':'')+t.title;
  djShowBpm(deck);
  $('#djState'+deck).textContent=ext?'CARGANDO · '+(t.source||'EXTERNAL'):'LOADED · '+(t.source||'AUDIO');
  $('#djTime'+deck).textContent='00:00 / '+durationText(t.duration);
  if(!ext&&!djPeaks.has(id))djAnalyzeBlob(id,await djBlobFor(id),false).then(a=>{if(!t.duration){t.duration=a.duration;persist();renderDJ()}if(!t.intro&&a.intro){t.intro=a.intro;persist()}djDrawWave(deck);djApplyFX(deck)}).catch(()=>{});
  djDrawWave(deck);djUpdateLoopUI(deck);djRefreshCues(deck);djSetCrossfader($('#djCrossfade').value);djApplyFX(deck);
  return true;
 }catch(e){toast('No se pudo cargar deck '+deck+': '+e.message,true);return false}
 finally{d.loading=false}
}
for(const deck of ['A','B']){
 $('#djSelect'+deck).addEventListener('change',async e=>{djStopAuto();await djLoadDeck(deck,e.target.value)});
 $('#djPlay'+deck).addEventListener('click',async()=>{
  try{await djEnsureMixer();const d=djDecks[deck];if(!d.id){const id=$('#djSelect'+deck).value;if(!id||!await djLoadDeck(deck,id))return}
   if(d.el.paused){djStopAuto();await d.el.play()}else d.el.pause();djUpdateDeckStatus(deck)
  }catch(e){toast('Reproducción bloqueada: '+e.message,true)}
 });
 $('#djCue'+deck).addEventListener('click',()=>{const d=djDecks[deck];if(!d.id)return;d.el.pause();d.el.currentTime=0;d.loop=null;djUpdateLoopUI(deck);djDrawWave(deck);djUpdateDeckStatus(deck)});
 $('#djSync'+deck).addEventListener('click',()=>djMatchTempo(deck));
 $('#djEchoOut'+deck).addEventListener('click',()=>djEchoOut(deck));
 $('#djWave'+deck).addEventListener('click',e=>{const d=djDecks[deck];if(!d.id||!d.el.duration)return;const r=e.currentTarget.getBoundingClientRect();d.el.currentTime=(e.clientX-r.left)/r.width*d.el.duration;djDrawWave(deck)});
}
function djUpdateDeckStatus(deck){const d=djDecks[deck];$('#djPlay'+deck).textContent=d.el.paused?'▶ PLAY':'❚❚ PAUSE';$('#deck'+deck).classList.toggle('dj-playing',!d.el.paused&&!!d.id);
 if(d.id)$('#djState'+deck).textContent=d.el.paused?'PAUSED':'ON AIR';
 $('#djTime'+deck).textContent=djClock(d.el.currentTime)+' / '+djClock(d.el.duration);
}
function djOnTimeUpdate(deck){const d=djDecks[deck];if(d.loop&&d.el.currentTime>=d.loop.end-.04){d.el.currentTime=d.loop.start}djUpdateDeckStatus(deck);djDrawWave(deck)}
function djOnEnded(deck){const d=djDecks[deck];d.loop=null;djUpdateDeckStatus(deck);if(djAuto.enabled&&djAuto.active===deck&&!djAuto.transition){if(djNextTrack(d.id))djBeginTransition(1);else{djAuto.enabled=false;djAuto.currentId=null;$('#djEngineStatus').textContent='SET TERMINADO';toast('Set terminado');$('#djEngineStatus').textContent='SET TERMINADO';djAgentEmit('set_ended',{})}}}
function djUpdateLoopUI(deck){const d=djDecks[deck];$$(`.dj-loop-btn[data-deck="${deck}"]`).forEach(b=>b.classList.toggle('active',!!d.loop&&+b.dataset.beats===d.loop.beats))}
$$('.dj-loop-btn').forEach(button=>button.addEventListener('click',()=>{
 const deck=button.dataset.deck,beats=+button.dataset.beats,d=djDecks[deck],t=djTrack(d.id);
 if(!beats){d.loop=null;djUpdateLoopUI(deck);return}
 if(d.mode==='embed'){toast('Los loops no están disponibles en YouTube/SoundCloud',true);return}
 if(!t?.bpm){toast('Para loops por beats necesitás BPM verificado o estimado',true);return}
 if(!Number.isFinite(d.el.duration)){toast('Primero cargá y reproducí un audio',true);return}
 const duration=beats*60/Number(t.bpm);
 const start=Math.max(0,Math.min(d.el.currentTime,Math.max(0,d.el.duration-duration)));
 d.loop={beats,start,end:Math.min(d.el.duration,start+duration)};djUpdateLoopUI(deck);
 toast(`Loop libre de ${beats} beats (sin beatgrid, puede no caer exacto)`);
}));
function djShowBpm(deck){const d=djDecks[deck],t=djTrack(d.id),i=$('#djBpmSet'+deck);
 $('#djBpm'+deck).textContent=t?.bpm?(t.bpm.toFixed(1)+' BPM'+(t.bpmEstimated?' ~':'')):'BPM —';
 i.disabled=!t;if(document.activeElement!==i)i.value=t?.bpm?+t.bpm.toFixed(1):'';i.classList.remove('need')}
function djMatchTempo(deck,quiet){const a=djDecks[deck],other=deck==='A'?'B':'A',b=djDecks[other],ta=djTrack(a.id),tb=djTrack(b.id);
 if(a.mode==='embed'||b.mode==='embed'){toast('SYNC no está disponible con YouTube/SoundCloud',true);return false}
 if(!ta||!tb){toast('Cargá un tema en cada deck para sincronizar',true);return false}
 const missing=[[deck,ta],[other,tb]].filter(([,t])=>!t.bpm);
 if(missing.length){missing.forEach(([k])=>$('#djBpmSet'+k).classList.add('need'));toast('SYNC necesita el BPM de ambos temas: escribilo en el campo BPM del deck marcado',true);$('#djBpmSet'+missing[0][0]).focus();return false}
 const base=djBpmFor(tb)*b.el.playbackRate;let target=base/djBpmFor(ta);
 for(const k of [2,.5]){const c=base*k/djBpmFor(ta);if(Math.abs(c-1)<Math.abs(target-1))target=c}
 if(target<.88||target>1.12){toast(`BPM muy distintos (${ta.bpm} vs ${tb.bpm}): no se puede igualar el tempo sin pasar ±12%`,true);return false}
 $('#djRate'+deck).value=Math.round(target*1000)/10;djApplyFX(deck);if(!quiet)toast(`SYNC: deck ${deck} a ${(ta.bpm*target).toFixed(1)} BPM (tempo; la fase se alinea en el Auto DJ)`);return true
}
for(const deck of ['A','B'])$('#djBpmSet'+deck).addEventListener('change',e=>{
 const t=djTrack(djDecks[deck].id);if(!t)return;const raw=e.target.value.trim(),v=parseFloat(raw);
 if(raw===''){t.bpm=null}else if(v>=40&&v<=220){t.bpm=Math.round(v*10)/10;t.bpmEstimated=false}else{toast('BPM fuera de rango (40–220)',true);djShowBpm(deck);return}
 delete t.grid;djEnsureGrid(t);persist();renderSet();for(const k of ['A','B'])djShowBpm(k);toast(t.bpm?`BPM de "${t.title}": ${t.bpm}`:'BPM borrado')});
function djEchoOut(deck){$('#djEcho'+deck).value=65;djApplyFX(deck);setTimeout(()=>{$('#djEcho'+deck).value=0;djApplyFX(deck)},2800)}
function djSlideFX(deck,name,from,to,ms,done){const el=$('#dj'+name+deck),t0=performance.now();clearInterval(el._anim);
 el._anim=setInterval(()=>{const k=Math.min(1,(performance.now()-t0)/ms);el.value=from+(to-from)*k;djApplyFX(deck);if(k>=1){clearInterval(el._anim);el._anim=null;done&&done()}},40)}
async function djPad(deck,fn){try{await djEnsureMixer();fn(djDecks[deck])}catch(e){toast('Efecto no disponible: '+e.message,true)}}
for(const deck of ['A','B']){
 $('#djThrow'+deck).addEventListener('click',()=>djPad(deck,()=>{const el=$('#djReverb'+deck);if(el._anim)return;const prev=+el.value;el.value=100;djApplyFX(deck);setTimeout(()=>djSlideFX(deck,'Reverb',100,prev,1800),600)}));
 $('#djSweep'+deck).addEventListener('click',()=>djPad(deck,()=>{const el=$('#djHp'+deck);if(el._anim)return;const prev=+el.value;djSlideFX(deck,'Hp',prev,90,4000,()=>setTimeout(()=>djSlideFX(deck,'Hp',90,prev,350),150))}));
 $('#djBrake'+deck).addEventListener('click',()=>djPad(deck,d=>{
  if(!d.id||d.el.paused||d.braking)return;d.braking=true;const from=d.el.playbackRate,t0=performance.now();
  const iv=setInterval(()=>{const k=Math.min(1,(performance.now()-t0)/1400);d.el.playbackRate=Math.max(.25,from*(1-k*.8));
   if(k>=1){clearInterval(iv);d.el.pause();d.braking=false;djApplyFX(deck);djUpdateDeckStatus(deck)}},40)}));
}
// rAF watcher: timeupdate fires only ~4x/s, too coarse for 1/2 and 1 beat loops.
function djLoopWatch(){for(const k of ['A','B']){const d=djDecks[k];if(d.loop&&!d.el.paused&&d.el.currentTime>=d.loop.end-.02)d.el.currentTime=d.loop.start}requestAnimationFrame(djLoopWatch)}
requestAnimationFrame(djLoopWatch);
function djRestoreBase(tr){for(const k of [tr.from,tr.to]){for(const n of DJ_CTL)$('#dj'+n+k).value=tr.base[k][n];djDecks[k].pll=1;djApplyFX(k)}}
function djStopAuto(){const hadTransition=!!djAuto.transition;if(hadTransition)djRestoreBase(djAuto.transition);djAuto.epoch++;djAuto.ramp=null;djAuto.enabled=false;djAuto.pending=false;djAuto.transition=null;if(hadTransition)for(const k of ['A','B'])djApplyFX(k);$('#djEngineStatus').textContent=djCtx?'MANUAL MIX MODE':'ENGINE STANDBY'}
function djStopAll(){djStopAuto();for(const deck of ['A','B']){const d=djDecks[deck];d.el.pause();if(d.id)d.el.currentTime=0;d.loop=null;djUpdateLoopUI(deck);djUpdateDeckStatus(deck);djDrawWave(deck)}djSetCrossfader(0);djAuto.currentId=null}
async function djBeginSet(){
 try{
  await djEnsureMixer();const playable=djAvailable();if(!playable.length){toast('Primero importá un archivo de audio al set',true);return}
  djStopAll();djAuto.failed.clear();const t=playable[0];if(!await djLoadDeck('A',t.id))return;
  djSetCrossfader(0);djAuto.active='A';djAuto.currentId=t.id;djAuto.enabled=true;
  await djDecks.A.el.play();djUpdateDeckStatus('A');
  const next=djNextTrack(t.id);if(next)await djLoadDeck('B',next.id);
  $('#djEngineStatus').textContent='AUTO DJ RUNNING';toast('Auto DJ en marcha. La mezcla comienza al final de cada tema.');
 }catch(e){djStopAuto();toast('No se pudo iniciar Auto DJ: '+e.message,true)}
}
async function djBeginTransition(customSeconds){
 if(djAuto.pending||djAuto.transition)return;
 const from=djAuto.active,to=from==='A'?'B':'A',current=djDecks[from],next=djNextTrack(current.id);
 if(!next){djAuto.enabled=false;toast('No quedan más archivos mezclables en el set');return}
 djAuto.pending=true;djAuto.ramp=null;const epoch=djAuto.epoch;
 try{
  await djEnsureMixer();
  const dest=djDecks[to];if(dest.loading)return;
  if(dest.id!==next.id&&!await djLoadDeck(to,next.id)){djAuto.failed.add(next.id);toast('Auto DJ saltó un tema que no se pudo cargar: '+next.title,true);return}
  const tc=djTrack(current.id),tn=djTrack(next.id),both=current.mode==='file'&&dest.mode==='file'&&!customSeconds;
  if(both)await Promise.all([djEnsureGrid(tc),djEnsureGrid(tn)]);
  if(epoch!==djAuto.epoch)return;
  dest.el.currentTime=0;dest.loop=null;djUpdateLoopUI(to);dest.pll=1;current.pll=1;
  $('#djRate'+to).value=100;djApplyFX(to);
  // Meet in the middle: when both decks are close in tempo (e.g. 127 and 129) both end at the average (128).
  if($('#djAutoSync').checked&&tc?.bpm&&tn?.bpm&&current.mode==='file'&&dest.mode==='file'&&!customSeconds){
   const eo=djBpmFor(tc)*(+$('#djRate'+from).value/100);let ni=djBpmFor(tn);
   for(const k of [2,.5])if(Math.abs(djBpmFor(tn)*k-eo)<Math.abs(ni-eo))ni=djBpmFor(tn)*k;
   if(Math.abs(ni-eo)/eo<=.06){const ro=(eo+ni)/2/djBpmFor(tc);if(ro>=.88&&ro<=1.12){$('#djRate'+from).value=Math.round(ro*1000)/10;djApplyFX(from)}}
  }
  let matched=false;
  if($('#djAutoSync').checked&&tc?.bpm&&tn?.bpm&&current.mode!=='embed'&&dest.mode!=='embed')matched=djMatchTempo(to,true);
  const grid=both&&matched&&djGridOK(tc)&&djGridOK(tn);let delay=0;
  if(grid){ // wait for the outgoing deck's next bar line and start the incoming deck on its first beat
   const per=60/tc.grid.bpm/current.el.playbackRate,pos=djBeatsAt(tc,current.el.currentTime);let nb=Math.ceil(pos/4)*4;if((nb-pos)*per<.3)nb+=4;
   delay=(nb-pos)*per;dest.el.currentTime=djEntryTime(tc,tn,current.el.currentTime+delay*current.el.playbackRate);
  }
  const remaining=(current.el.duration-current.el.currentTime)/Math.max(.1,current.el.playbackRate)-delay;
  const clash=!customSeconds&&$('#djAutoSync').checked&&tc?.bpm&&tn?.bpm&&!matched&&current.mode!=='embed'&&dest.mode!=='embed';
  const stale=djAuto.plan?.from&&djAuto.plan.from!==current.id; // plan made for another pair of tracks
  const plan=stale?{}:(djAuto.plan||{});if(djAuto.plan&&(stale||!plan.repeat))djAuto.plan=null;
  const want=customSeconds||(clash?Math.min(6,plan.fade||Number($('#djFadeSeconds').value)):(plan.fade||Number($('#djFadeSeconds').value))),dur=Number.isFinite(remaining)?Math.min(want,Math.max(.7,remaining-.2)):want;
  if(dest.mode==='embed'&&dest.media.ready)await Promise.race([dest.media.ready,new Promise(r=>setTimeout(r,12000))]);
  if(delay>0){await new Promise(r=>setTimeout(r,Math.max(0,delay*1000-35)));if(epoch!==djAuto.epoch)return}
  const base={};for(const k of [from,to]){base[k]={};for(const n of DJ_CTL)base[k][n]=+$('#dj'+n+k).value}
  await dest.el.play();
  const currentValue=Number($('#djCrossfade').value),targetValue=to==='B'?100:0;
  djAuto.transition={from,to,start:performance.now(),duration:dur*1000,initial:currentValue,target:targetValue,fx:clash?'echo':(plan.fx?(plan.fx==='random'?['echo','reverb','flanger'][Math.floor(Math.random()*3)]:plan.fx):djPickFX()),eq:plan.eq||$('#djAutoEQ').value,filter:plan.filter!=null?plan.filter:$('#djAutoFilter').checked,fxAmt:plan.fxAmt!=null?plan.fxAmt:1,base,lock:grid,tc,tn,err:null};
  djAgentEmit('transition_start',{from:djTrackInfo(tc),to:djTrackInfo(tn),fx:djAuto.transition.fx,eq:djAuto.transition.eq,seconds:Math.round(dur),beat_aligned:!!grid,entry_s:Math.round(dest.el.currentTime),from_s:Math.round(current.el.currentTime)});
  djAuto.enabled=true;$('#djEngineStatus').textContent='AUTO MIXING · '+Math.round(dur)+'s'+(grid?' · BEATS ALINEADOS':clash?' · BPM MUY DISTINTOS: MEZCLA CORTA':'')+(djAuto.transition.fx!=='off'?' · '+djAuto.transition.fx.toUpperCase():'')+(djAuto.transition.eq!=='off'?' · EQ':'');
 }catch(e){toast('No se pudo iniciar la transición: '+e.message,true)}
 finally{djAuto.pending=false}
}
function djTick(){
 if(djCtx&&djCtx.state==='running'){
  const buffer=new Uint8Array(256);
  for(const letter of ['A','B']){
   const d=djDecks[letter];if(!d.analyser)continue;
   d.analyser.getByteTimeDomainData(buffer);let sum=0;for(const s of buffer)sum+=((s-128)/128)**2;
   const rms=Math.sqrt(sum/buffer.length),level=Math.min(100,Math.max(0,(20*Math.log10(rms+1e-7)+50)*2.2));
   $('#djMeter'+letter+' span').style.height=level+'%';
  }
  const bytes=new Uint8Array(djMasterAnalyser.frequencyBinCount);djMasterAnalyser.getByteTimeDomainData(bytes);
  const rms=Math.sqrt(bytes.reduce((acc,x)=>acc+((x-128)/128)**2,0)/bytes.length);
  $('#djMasterDisplay').textContent=Math.max(-90,20*Math.log10(rms+1e-8)).toFixed(1)+' dBFS';
 }
 if(djAuto.transition){
  const tr=djAuto.transition,t=Math.min(1,(performance.now()-tr.start)/tr.duration);
  djSetCrossfader(tr.initial+(tr.target-tr.initial)*t);
  if(t<1)djAutoMix(tr,t);
  if(tr.lock){ // phase lock: nudge the incoming deck's speed so its beats land on the outgoing deck's beats
   const f=djDecks[tr.from],i=djDecks[tr.to],bf=djBeatsAt(tr.tc,f.el.currentTime),bt=djBeatsAt(tr.tn,i.el.currentTime);
   let e=((bt-bf)%1+1)%1;if(e>.5)e-=1;tr.err=e;
   i.pll=1-Math.max(-.04,Math.min(.04,e*.4));i.el.playbackRate=+$('#djRate'+tr.to).value/100*i.pll;
  }
  if(t>=1){
   djRestoreBase(tr);
   djDecks[tr.from].el.pause();djDecks[tr.from].loop=null;
   djUpdateDeckStatus(tr.from);djAuto.active=tr.to;djAuto.currentId=djDecks[tr.to].id;
   const rv=+$('#djRate'+tr.to).value;if(Math.abs(rv-100)>.3&&djDecks[tr.to].mode==='file')djAuto.ramp={deck:tr.to,from:rv,start:performance.now(),ms:24000};
   djAuto.transition=null;$('#djEngineStatus').textContent='AUTO DJ RUNNING';djAgentEmit('transition_end',{now_playing:djTrackInfo(djTrack(djAuto.currentId))});
  }
 }else if(djAuto.ramp){
  const r=djAuto.ramp,k=Math.min(1,(performance.now()-r.start)/r.ms);$('#djRate'+r.deck).value=r.from+(100-r.from)*k;djApplyFX(r.deck);if(k>=1)djAuto.ramp=null;
  djAutoWatch();
 }else if(djAuto.enabled&&!djAuto.pending){
  djAutoWatch();
 }
}
function djAutoWatch(){
 if(!djAuto.enabled||djAuto.pending||djAuto.transition)return;
 const d=djDecks[djAuto.active],next=djNextTrack(d.id),fade=djAuto.plan?.fade||Number($('#djFadeSeconds').value);
 if(djAuto.exit?.id!==d.id&&Number.isFinite(d.el.duration)&&!d.el.paused){djAuto.exit={id:d.id,at:$('#djAutoPhrase').checked?djExitTime(djTrack(d.id),d.el.duration,d.el.currentTime,fade):null}}
 // "remaining" counts to the planned hand-over point (a phrase boundary) or, without one, to the end of the track.
 const remaining=((djAuto.exit?.id===d.id&&djAuto.exit.at!=null?djAuto.exit.at:d.el.duration)-d.el.currentTime)/Math.max(.1,d.el.playbackRate);
 if(!next||d.el.paused||!Number.isFinite(remaining))return;
 if(remaining<=70&&djAgent.endingFor!==d.id){djAgent.endingFor=d.id;djAgentEmit('track_ending',{track:djTrackInfo(djTrack(d.id)),remaining_s:Math.round(remaining),next:djTrackInfo(next)})}
 const idle=djAuto.active==='A'?'B':'A';
 if(remaining<=fade+30){
  if(djDecks[idle].id!==next.id&&!djDecks[idle].loading)djLoadDeck(idle,next.id);
  djEnsureGrid(djTrack(d.id));djEnsureGrid(next);
 }
 if(d.loop&&remaining<=fade+8){d.loop=null;djUpdateLoopUI(djAuto.active)}
 // With a beatgrid the mix starts on the next bar line (up to ~2 s later), so begin a little earlier.
 const tn=djTrack(d.id),aligned=tn?.bpm&&next.bpm&&d.mode==='file'&&!djExternalKind(next);
 if(!d.loop&&remaining<=fade+(aligned?4.6:.15))djBeginTransition();
}
setInterval(djTick,50);
$('#djStart').addEventListener('click',djPrepareThenStart);
$('#djNext').addEventListener('click',async()=>{
 try{await djEnsureMixer();if(!djDecks[djAuto.active].id){await djBeginSet();return}djAuto.enabled=true;await djBeginTransition()}catch(e){toast(e.message,true)}
});
$('#djStop').addEventListener('click',djStopAll);
$('#djGoSets').addEventListener('click',()=>view('sets'));
$('#djClearSet').addEventListener('click',async()=>{
 if(!tracks.length)return;
 if(!confirm('¿Vaciar el set y borrar los archivos de audio almacenados para esta sesión?'))return;
 djStopAll();tracks.length=0;djMedia.clear();djReady.clear();djPeaks.clear();for(const u of djUrls.values())URL.revokeObjectURL(u);djUrls.clear();
 try{await djStorage('clear')}catch(e){}persist();renderSet();renderDJ();djRunAdvisor();
 for(const d of ['A','B']){djSetDeckMode(d,'file');const dk=djDecks[d];dk.el.removeAttribute('src');dk.el.load();dk.id=null;$('#djTrack'+d).textContent='NO TRACK LOADED';$('#djBpm'+d).textContent='BPM —';{const i=$('#djBpmSet'+d);i.value='';i.disabled=true}djDrawWave(d)}
});
// Record the actual master output, not the provider embeds.
$('#djRecord').addEventListener('click',async()=>{
 if(djRecorder&&djRecorder.state==='recording'){$('#djRecStatus').textContent='EXPORTING...';djRecorder.stop();return}
 try{
  await djEnsureMixer();if(!('MediaRecorder' in window))throw new Error('Este navegador no admite grabación');
  const candidates=['audio/webm;codecs=opus','audio/mp4','audio/webm'];
  const supported=candidates.find(x=>MediaRecorder.isTypeSupported(x));djChunks=[];
  djRecorder=new MediaRecorder(djRecordingStream.stream,supported?{mimeType:supported}:undefined);
  djRecorder.ondataavailable=e=>{if(e.data.size)djChunks.push(e.data)};
  djRecorder.onstop=()=>{
   const mime=djRecorder.mimeType||'audio/webm',extension=mime.includes('mp4')?'m4a':'webm';
   if(djChunks.length)download(new Blob(djChunks,{type:mime}),mime,($('#setName').value||'synklab-set').replace(/[^a-z0-9_-]/gi,'-').slice(0,60)+'.'+extension);
   djChunks=[];$('#djRecord').textContent='● GRABAR SET';$('#djRecord').classList.remove('dj-rec-on');$('#djRecStatus').classList.remove('dj-rec-status');$('#djRecStatus').textContent='SET EXPORTADO';
  };
  djRecorder.start(1000);$('#djRecord').textContent='■ DETENER GRABACIÓN';$('#djRecord').classList.add('dj-rec-on');$('#djRecStatus').classList.add('dj-rec-status');$('#djRecStatus').textContent='● REC LIVE';toast('Grabando la salida real del mixer. No incluye embeds externos.');
 }catch(e){toast('Grabación no disponible: '+e.message,true)}
});
// Supplement existing set table with deck loading shortcuts, preserving editor behavior.
const djOriginalRenderSet=renderSet;
renderSet=function(){
 djOriginalRenderSet();
 if(tracks.length){
  $$('#setArea .rowbuttons').forEach((row,i)=>{
   const t=tracks[i];if(!djPlayable(t))return;
   const button=document.createElement('button');button.className='btn sm ghost';button.textContent='LOAD A';button.title='Cargar audio en Deck A';
   button.addEventListener('click',async()=>{view('autodj');djStopAuto();await djLoadDeck('A',t.id)});row.prepend(button);
  });
 }
 if(typeof renderDJ==='function')renderDJ();
};
$('#setName').addEventListener('input',renderDJ);
// ---- Set Advisor: heuristic opening suggestions (intro softness, BPM position, key/BPM compatibility) ----
const djAdvice={order:[],top:[]};
function djCamelot(k){const m=/^(\d{1,2})([AB])$/.exec(k||'');return m?{n:+m[1],l:m[2]}:null}
function djKeyCompat(a,b){const x=djCamelot(a),y=djCamelot(b);if(!x||!y)return null;if(x.n===y.n)return true;const d=Math.min((x.n-y.n+12)%12,(y.n-x.n+12)%12);return d===1&&x.l===y.l}
function djClamp01(v){return Math.max(0,Math.min(1,v))}
function djSuggestOpening(list){
 const bpms=list.map(t=>t.bpm).filter(Boolean).sort((a,b)=>a-b);
 return list.map(t=>{
  const parts=[],reasons=[];
  const add=(w,v)=>parts.push([w,djClamp01(v)]);
  if(t.energy){add(.45,1-(t.energy-1)/9);if(t.energy<=5)reasons.push(`energía ${t.energy}/10 (cargada por vos)`)}
  else if(t.intro){const soft=(1.1-t.intro.introRatio)/.7,sparse=1-t.intro.onsetDensity/6;add(.30,soft);add(.15,sparse);
   if(soft>.55)reasons.push('intro más suave que el resto del tema (estimado)');if(sparse>.6)reasons.push('intro poco densa en golpes (estimado)')}
  if(t.bpm&&bpms.length>1){const rank=bpms.indexOf(t.bpm)/(bpms.length-1);add(.20,1-rank);if(rank<=.34)reasons.push(`${t.bpm.toFixed(0)} BPM, tercio más lento del set`)}
  if(t.duration)add(.10,t.duration/300000);
  const others=list.filter(o=>o.id!==t.id);let keyOk=0,keyN=0,bpmOk=0,bpmN=0;
  for(const o of others){const c=djKeyCompat(t.key,o.key);if(c!==null){keyN++;if(c)keyOk++}if(t.bpm&&o.bpm){bpmN++;if(Math.abs(t.bpm-o.bpm)<=4)bpmOk++}}
  const compat=[keyN?keyOk/keyN:null,bpmN?bpmOk/bpmN:null].filter(v=>v!==null);
  if(compat.length){add(.25,compat.reduce((a,b)=>a+b,0)/compat.length);if(keyN&&keyOk)reasons.push(`${t.key} mezcla con ${keyOk} track${keyOk>1?'s':''} del set`);if(bpmOk)reasons.push(`${bpmOk} track${bpmOk>1?'s':''} a ±4 BPM`)}
  const w=parts.reduce((a,p)=>a+p[0],0);
  return {t,score:w?parts.reduce((a,p)=>a+p[0]*p[1],0)/w:0,reasons,confident:parts.length>=3};
 }).sort((a,b)=>b.score-a.score);
}
function djSuggestOrder(scored){
 if(!scored.length)return [];
 const pool=scored.map(x=>x.t),order=[pool.shift()];
 while(pool.length){const cur=order[order.length-1];let best=0,bestCost=Infinity;
  pool.forEach((c,i)=>{const cost=djPairCost(cur,c);if(cost<bestCost){bestCost=cost;best=i}});
  order.push(pool.splice(best,1)[0])}
 return order;
}
function djRunAdvisor(){
 const box=$('#djAdvisor');if(!box)return;const list=djAvailable();djAdvice.order=[];djAdvice.top=[];
 $('#djApplyOrder').disabled=true;
 if(list.length<2){box.innerHTML='<p class="note">Importá al menos 2 audios para evaluar cómo arrancar.</p>';return}
 const scored=djSuggestOpening(list),top=scored.slice(0,3);djAdvice.top=top.map(x=>x.t.id);
 const order=djSuggestOrder(scored);djAdvice.order=order.map(t=>t.id);
 const name=t=>escapeHTML((t.artist?t.artist+' — ':'')+t.title);
 box.innerHTML=top.map((x,i)=>`<div class="dj-adv-card${i===0?' top':''}"><div class="dj-adv-rank">${i+1}</div><div><strong>${name(x.t)}</strong><small>${x.reasons.length?escapeHTML(x.reasons.join(' · ')):'Sin datos suficientes: cargá BPM/key/energía para afinar la sugerencia'}${x.confident?'':' (confianza baja)'}</small></div><div class="rowbuttons"><button class="btn sm lime djAdvLoad" data-id="${escAttr(x.t.id)}">CARGAR EN DECK A</button><button class="btn sm ghost djAdvOpen" data-id="${escAttr(x.t.id)}">USAR COMO APERTURA</button></div></div>`).join('')
  +`<div class="dj-adv-order"><b>ORDEN SUGERIDO:</b> ${order.map((t,i)=>`${i+1}. ${name(t)}${t.bpm?' ('+t.bpm.toFixed(0)+(t.key?' · '+escapeHTML(t.key):'')+')':''}`).join(' → ')}<br>Pista: abrí con el track 1 con el filtro HP un poco subido y bajalo durante la intro; mezclá el siguiente recién cuando el BPM esté dentro de ±4.</div>`;
 $('#djApplyOrder').disabled=false;
 $$('.djAdvLoad').forEach(b=>b.addEventListener('click',async()=>{djStopAuto();await djLoadDeck('A',b.dataset.id)}));
 $$('.djAdvOpen').forEach(b=>b.addEventListener('click',()=>{const i=tracks.findIndex(t=>t.id===b.dataset.id);if(i<=0){toast('Ya es el primer track del set');return}tracks.unshift(tracks.splice(i,1)[0]);persist();renderSet();renderDJ();toast('Movido al inicio del set. Auto DJ arrancará con este tema.')}));
}
function djApplyAdvisedOrder(){
 const byId=new Map(tracks.map(t=>[t.id,t])),head=djAdvice.order.map(id=>byId.get(id)).filter(Boolean),rest=tracks.filter(t=>!djAdvice.order.includes(t.id));
 if(!head.length||!confirm('¿Reordenar el set con el orden sugerido? Podés ajustarlo después con ↑ ↓.'))return;
 tracks.splice(0,tracks.length,...head,...rest);persist();renderSet();renderDJ();toast('Orden aplicado');
}
$('#djAnalyzeSet').addEventListener('click',async()=>{
 // Backfill intro features for tracks imported before the advisor existed.
 const missing=djAvailable().filter(t=>!t.intro);
 if(missing.length){$('#djAnalyzeSet').disabled=true;for(const t of missing){try{const b=await djBlobFor(t.id);if(b){const a=await djAnalyzeBlob(t.id,b,false);if(a.intro)t.intro=a.intro}}catch(e){}}persist();$('#djAnalyzeSet').disabled=false}
 djRunAdvisor();
});
$('#djApplyOrder').addEventListener('click',djApplyAdvisedOrder);

// Browser session storage can persist bytes locally; audio is never included in JSON/CSV exports.
window.addEventListener('beforeunload',()=>{for(const url of djUrls.values())URL.revokeObjectURL(url)});

// ---- External sources: YouTube / SoundCloud embeds and direct-URL streams (volume-only mixing) ----
// Their audio never reaches Web Audio (cross-origin iframe / no CORS), so no EQ, filters, FX, loops or recording.
const djScripts=new Map();
function djScript(src){
 if(djScripts.has(src))return djScripts.get(src);
 const p=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.async=true;s.onload=resolve;s.onerror=()=>{djScripts.delete(src);reject(new Error('No se pudo cargar '+new URL(src).hostname))};document.head.appendChild(s)});
 djScripts.set(src,p);return p;
}
let djYTPromise=null;
function djYouTubeAPI(){
 if(window.YT&&window.YT.Player)return Promise.resolve(window.YT);
 if(djYTPromise)return djYTPromise;
 djYTPromise=new Promise((resolve,reject)=>{
  const prev=window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady=()=>{if(prev)prev();resolve(window.YT)};
  djScript('https://www.youtube.com/iframe_api').catch(e=>{djYTPromise=null;reject(e)});
 });
 return djYTPromise;
}
class DJEmbedMedia extends EventTarget{
 constructor(info,host){
  super();this.info=info;this.host=host;this._t=0;this._dur=NaN;this._paused=true;this._vol=1;this._want=false;this._ready=false;this._dead=false;
  this.ready=new Promise((res,rej)=>{this._res=res;this._rej=rej});this.ready.catch(()=>{});
  this._init().catch(e=>this._fail(e));
  this._poll=setInterval(()=>{if(this._ready){this._pollTime();this.dispatchEvent(new Event('timeupdate'))}},250);
 }
 get currentTime(){return this._t}
 set currentTime(v){this._t=v;if(this._ready)this._seek(v)}
 get duration(){return this._dur}
 get paused(){return this._paused}
 get playbackRate(){return 1}
 set playbackRate(v){}
 removeAttribute(){}
 load(){}
 setVolume(v){this._vol=Math.max(0,Math.min(1,v));if(this._ready)this._applyVol()}
 async play(){this._want=true;this._paused=false;if(this._ready)this._play()}
 pause(){this._want=false;this._paused=true;if(this._ready)this._pause()}
 _ended(){this._want=false;this._paused=true;this.dispatchEvent(new Event('ended'))}
 _fail(err){this.error=err;this._rej(err);this.dispatchEvent(new Event('error'))}
 destroy(){this._dead=true;clearInterval(this._poll);try{this._destroy()}catch(e){}}
}
class DJYouTube extends DJEmbedMedia{
 async _init(){
  const YT=await djYouTubeAPI();if(this._dead)return;
  const slot=document.createElement('div');this.host.appendChild(slot);
  await new Promise((resolve,reject)=>{
   this.player=new YT.Player(slot,{width:'100%',height:'100%',videoId:this.info.id,
    playerVars:{playsinline:1,rel:0,modestbranding:1,origin:location.origin},
    events:{
     onReady:()=>{this._ready=true;const d=this.player.getDuration();if(d)this._dur=d;this._applyVol();if(this._want)this.player.playVideo();this._res();resolve()},
     onStateChange:e=>{if(e.data===YT.PlayerState.ENDED)this._ended();else if(e.data===YT.PlayerState.PLAYING){const d=this.player.getDuration();if(d)this._dur=d}},
     onError:e=>reject(new Error('YouTube no permite reproducir este video aquí (código '+e.data+')'))
    }});
  });
 }
 _pollTime(){this._t=this.player.getCurrentTime()||0}
 _seek(v){this.player.seekTo(v,true)}
 _applyVol(){this.player.setVolume(Math.round(this._vol*100))}
 _play(){this.player.playVideo()}
 _pause(){this.player.pauseVideo()}
 _destroy(){this.player&&this.player.destroy()}
}
class DJSoundCloud extends DJEmbedMedia{
 async _init(){
  await djScript('https://w.soundcloud.com/player/api.js');if(this._dead)return;
  const f=document.createElement('iframe');f.allow='autoplay';f.src=this.info.src;this.host.appendChild(f);
  const w=this.w=window.SC.Widget(f),Ev=window.SC.Widget.Events;
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('SoundCloud no respondió')),15000);
   w.bind(Ev.READY,()=>{clearTimeout(timer);this._ready=true;w.getDuration(ms=>{if(ms)this._dur=ms/1000});this._applyVol();if(this._want)w.play();this._res();resolve()});
   w.bind(Ev.PLAY_PROGRESS,e=>{this._t=e.currentPosition/1000});
   w.bind(Ev.PLAY,()=>w.getDuration(ms=>{if(ms)this._dur=ms/1000}));
   w.bind(Ev.FINISH,()=>this._ended());
   w.bind(Ev.ERROR,()=>this._fail(new Error('SoundCloud no puede reproducir este enlace')));
  });
 }
 _pollTime(){if(!Number.isFinite(this._dur))this.w.getDuration(ms=>{if(ms)this._dur=ms/1000})}
 _seek(v){this.w.seekTo(v*1000)}
 _applyVol(){this.w.setVolume(Math.round(this._vol*100))}
 _play(){this.w.play()}
 _pause(){this.w.pause()}
 _destroy(){}
}
// Direct URL without CORS: a plain <audio> element kept OUT of the Web Audio graph (tainted media would output silence).
function djMakeStream(url){
 const a=new Audio();a.preload='auto';a.src=url;
 a.setVolume=v=>{a.volume=Math.max(0,Math.min(1,v))};
 a.destroy=()=>{a.pause();a.removeAttribute('src');a.load()};
 a.ready=new Promise((resolve,reject)=>{a.addEventListener('loadedmetadata',resolve,{once:true});a.addEventListener('error',()=>reject(new Error('El enlace no es un audio reproducible')),{once:true})});
 a.ready.catch(()=>{});
 return a;
}
function djExternalKind(t){
 if(!t||!t.externalUrl)return null;const s=djIdentifySource(t.externalUrl);if(!s)return null;
 return s.kind==='youtube'||s.kind==='soundcloud'?s.kind:s.kind==='file'?'stream':null;
}
function djPlayable(t){return !!t&&(djReady.has(t.id)||!!djExternalKind(t))}
function djBindMedia(deck,m){
 m.addEventListener('timeupdate',()=>djOnTimeUpdate(deck));
 m.addEventListener('ended',()=>djOnEnded(deck));
 m.addEventListener('error',()=>{const d=djDecks[deck];if(d.id&&d.media===m)toast('No se pudo reproducir: '+(djTrack(d.id)?.title||deck),true)});
}
function djSetDeckMode(deck,mode,make){
 const d=djDecks[deck];
 if(d.media&&d.media!==d.audio){try{d.media.destroy()}catch(e){}}
 d.audio.pause();
 const host=$('#djEmbed'+deck);host.innerHTML='';host.hidden=mode!=='embed';
 d.media=make?make(host):d.audio;d.el=d.media;d.mode=mode;
 if(d.media!==d.audio)djBindMedia(deck,d.media);
 const note=$('#djEmbedNote'+deck);note.hidden=mode==='file';
 note.textContent=mode==='embed'?'YOUTUBE / SOUNDCLOUD: se mezcla solo por volumen (crossfader y Auto DJ). EQ, filtros, efectos, loops y SYNC no están disponibles porque el reproductor externo no entrega su audio al mixer. No se incluye en la grabación.'
  :mode==='stream'?'URL DIRECTA SIN CORS: suena y se mezcla por volumen. EQ, filtros y efectos no están disponibles (el navegador no permite procesar ese audio). No se incluye en la grabación.':'';
 $('#deck'+deck).classList.toggle('dj-ext',mode!=='file');
 const fx=mode==='file';
 for(const n of ['Hp','Lp','Low','Mid','High','Echo','Reverb','Flanger'])$('#dj'+n+deck).disabled=!fx;
 for(const n of ['Throw','Sweep','EchoOut'])$('#dj'+n+deck).disabled=!fx;
 $$(`.dj-kill[data-deck="${deck}"]`).forEach(b=>b.disabled=!fx);
 const emb=mode==='embed';
 $('#djRate'+deck).disabled=emb;$('#djKeyLock'+deck).disabled=emb;
 for(const n of ['Brake','Sync'])$('#dj'+n+deck).disabled=emb;
 $$(`.dj-loop-btn[data-deck="${deck}"],.dj-nudge[data-deck="${deck}"]`).forEach(b=>b.disabled=emb);
}
function djApplyMediaVolumes(a,b){
 for(const [k,v] of [['A',a],['B',b]]){const d=djDecks[k];if(d.mode!=='file'&&d.media&&d.media.setVolume)d.media.setVolume(v)}
}
// ---- Auto mix: EQ bass swap / blend and one automatic effect per transition ----
function djPickFX(){const v=$('#djAutoFX').value;return v==='random'?['echo','reverb','flanger'][Math.floor(Math.random()*3)]:v}
const DJ_CTL=['Hp','Lp','Low','Mid','High','Echo','Reverb','Flanger'];
function djAutoMix(tr,t){
 if(!djCtx)return;
 const f=tr.from,i=tr.to,B=tr.base,set=(k,n,v)=>{$('#dj'+n+k).value=v};
 const step=(a,b,x)=>Math.max(0,Math.min(1,(x-a)/(b-a)));
 if(tr.eq==='bass'||tr.eq==='blend'){
  const swap=step(.45,.6,t);
  set(f,'Low',B[f].Low+(-18-B[f].Low)*swap);set(i,'Low',-18+(B[i].Low+18)*swap);
  if(tr.eq==='blend'){set(f,'Mid',B[f].Mid-6*t);set(f,'High',B[f].High-12*t);set(i,'High',B[i].High-12*(1-step(0,.6,t)))}
 }
 if(tr.filter){set(f,'Lp',Math.max(B[f].Lp,100*Math.pow(t,1.2)));set(i,'Hp',Math.max(B[i].Hp,80*(1-t)))}
 const hold=step(0,.45,t),wave=Math.sin(Math.PI*Math.min(1,t*1.05));
 if(tr.fx==='echo')set(f,'Echo',Math.max(B[f].Echo,75*hold*tr.fxAmt));
 else if(tr.fx==='reverb')set(f,'Reverb',Math.max(B[f].Reverb,85*hold*tr.fxAmt));
 else if(tr.fx==='flanger')set(f,'Flanger',Math.max(B[f].Flanger,75*wave*tr.fxAmt));
 djApplyFX(f);djApplyFX(i);
}
// ---- Beatgrid estimate: phase of the kick grid so the Auto DJ can land beats on beats ----
const djGridJobs=new Map();
function djGridOK(t){return !!(t&&t.bpm&&t.grid&&t.grid.src===t.bpm&&t.grid.anchors&&!t.grid.weak)}
function djBpmFor(t){return djGridOK(t)?t.grid.bpm:t.bpm}
function djBeatsAt(t,time){const A=t.grid.anchors;let a=A[0];for(const x of A)if(Math.abs(x.t-time)<Math.abs(a.t-time))a=x;return (time-a.ph)/(60/t.grid.bpm)}
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
 return {bpm:Math.round(b*1000)/1000,anchors:f.A.map(o=>({t:+o.t.toFixed(2),ph:+o.ph.toFixed(4)})),rms:Math.round(resid*1000),weak:resid>.025};
}
async function djEnsureGrid(t){
 if(!t||!t.bpm)return null;if(t.grid&&t.grid.v===2&&t.grid.src===t.bpm)return t.grid;if(djGridJobs.has(t.id))return djGridJobs.get(t.id);
 const job=(async()=>{try{const blob=await djBlobFor(t.id);if(!blob)return null;
  const buf=await new OfflineAudioContext(1,1,44100).decodeAudioData(await blob.arrayBuffer());
  const g=djComputeGrid(buf,t.bpm);if(g){g.src=t.bpm;g.v=2;t.grid=g;persist()}return g}catch(e){return null}finally{djGridJobs.delete(t.id)}})();
 djGridJobs.set(t.id,job);return job;
}
// ---- Phrase map: energy per 16-beat phrase, used to enter the next track past its intro and leave the current one early.
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
function djPhraseTime(t,i){ // time of the beat that starts phrase i, snapped to the nearest local beat phase
 const s=t.sect,A=t.grid.anchors,x=s.p0+i*16*s.per;let a=A[0];for(const q of A)if(Math.abs(q.t-x)<Math.abs(a.t-x))a=q;
 return a.ph+Math.round((x-a.ph)/s.per)*s.per;
}
function djSectOK(t){return !!(t&&djGridOK(t)&&t.sect&&t.sect.g===t.grid.bpm)}
// Where the current track should hand over: the first phrase boundary (after half the track) where its energy drops. null = play to the end.
function djExitTime(t,dur,from,fade){
 if(!djSectOK(t))return null;
 const s=t.sect,len=16*s.per,min=Math.max(dur*.5,100,from+fade+8);
 for(let k=Math.max(1,Math.ceil((min-s.p0)/len));k<s.db.length;k++){
  const at=s.p0+k*len;if(at+fade+2>dur)break;
  if(s.db[k]<s.db[k-1]-1.5||s.bass[k]<s.bass[k-1]*.6)return at;
 }
 return null;
}
// Where the next track should come in: its first phrase with the bass on whose level is within 3 dB of the outgoing track at that moment.
function djEntryTime(tc,tn,tOut){
 const first=tn.grid.anchors[0].ph;
 if(!$('#djAutoPhrase').checked||!djSectOK(tc)||!djSectOK(tn))return first;
 const c=tc.sect,s=tn.sect,lvl=c.db[Math.max(0,Math.min(c.db.length-1,Math.floor((tOut-1-c.p0)/(16*c.per))))]; // level just before the hand-over point
 const med=[...s.bass].sort((p,q)=>p-q)[s.bass.length>>1],last=s.db.length>>1;let best=-1,bd=1e9;
 for(let i=0;i<=last;i++){
  if(s.bass[i]<med*.6)continue;const d=Math.abs(s.db[i]-lvl);
  if(d<=3)return i?djPhraseTime(tn,i):first;if(d<bd){bd=d;best=i}
 }
 return best>0?djPhraseTime(tn,best):first;
}
function djTrimFor(d){
 if(!$('#djAutoGain').checked)return 1;
 const t=djTrack(d.id);if(!t?.intro)return 1;
 const vals=tracks.map(x=>x.intro?.rmsDb).filter(Number.isFinite).sort((a,b)=>a-b);if(vals.length<2)return 1;
 const med=vals[Math.floor(vals.length/2)],db=Math.max(-8,Math.min(6,med-t.intro.rmsDb));
 return Math.pow(10,db/20);
}
// ---- Performance helpers (Traktor / VirtualDJ style): hot cues, beat jump, nudge, EQ kill, key lock, auto gain ----
for(const deck of ['A','B'])$('#djKeyLock'+deck).addEventListener('change',()=>djApplyFX(deck));
$('#djAutoGain').addEventListener('change',()=>{djApplyFX('A');djApplyFX('B')});
$$('.dj-kill').forEach(b=>b.addEventListener('click',()=>{
 const deck=b.dataset.deck,d=djDecks[deck];d.kill[b.dataset.band]=!d.kill[b.dataset.band];
 b.classList.toggle('active',d.kill[b.dataset.band]);djApplyFX(deck);
}));
$$('.dj-nudge').forEach(b=>{
 const deck=b.dataset.deck,dir=+b.dataset.dir,rate=()=>+$('#djRate'+deck).value/100;
 const on=e=>{e.preventDefault();const d=djDecks[deck];if(d.mode==='embed')return;if(b.setPointerCapture)b.setPointerCapture(e.pointerId);d.el.playbackRate=Math.max(.5,Math.min(1.5,rate()*(1+dir*.05)))};
 const off=()=>{const d=djDecks[deck];if(d.mode!=='embed')d.el.playbackRate=rate()};
 b.addEventListener('pointerdown',on);b.addEventListener('pointerup',off);b.addEventListener('pointercancel',off);b.addEventListener('lostpointercapture',off);
});
$$('.dj-jump-btn').forEach(b=>b.addEventListener('click',()=>{
 const deck=b.dataset.deck,d=djDecks[deck],t=djTrack(d.id);if(!d.id)return;
 if(!t?.bpm){toast('Beat jump necesita el BPM del track (cargalo en el Set Builder)',true);return}
 let target=d.el.currentTime+(+b.dataset.beats)*60/Number(t.bpm);
 if(Number.isFinite(d.el.duration))target=Math.min(d.el.duration-.1,target);
 d.el.currentTime=Math.max(0,target);djDrawWave(deck);
}));
function djRefreshCues(deck){const t=djTrack(djDecks[deck].id);$$(`.dj-cue-btn[data-deck="${deck}"]`).forEach(b=>b.classList.toggle('set',!!t?.cues&&Number.isFinite(t.cues[+b.dataset.i])))}
$$('.dj-cue-btn').forEach(b=>{
 const deck=b.dataset.deck,i=+b.dataset.i;
 b.addEventListener('contextmenu',e=>{e.preventDefault();const t=djTrack(djDecks[deck].id);if(t?.cues){t.cues[i]=null;persist();djRefreshCues(deck)}});
 b.addEventListener('click',()=>{
  const d=djDecks[deck],t=djTrack(d.id);if(!t)return;t.cues=t.cues||[null,null,null,null];
  if(Number.isFinite(t.cues[i])){d.el.currentTime=t.cues[i];djDrawWave(deck)}
  else if(Number.isFinite(d.el.currentTime)){t.cues[i]=d.el.currentTime;persist();djRefreshCues(deck);toast(`Hot cue ${i+1} en ${djClock(t.cues[i])}`)}
 });
});
for(const deck of ['A','B']){djSetDeckMode(deck,'file');djDrawWave(deck);djRefreshCues(deck)}
djLoadStoredFiles();renderDJ();

// ---- Tonal analysis (key + bass weight), full-set preparation and ordering ----
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
function djNeedsPrep(t){return !t.tonal||t.tonal.v!==1||!t.intro||!t.duration||!t.bpm||!(t.grid&&t.grid.v===2&&t.grid.src===t.bpm)||(djGridOK(t)&&!djSectOK(t))}
async function djPrepareTrack(t){
 const blob=await djBlobFor(t.id);if(!blob)return false;
 const buf=await new OfflineAudioContext(1,1,44100).decodeAudioData(await blob.arrayBuffer());
 if(!t.duration)t.duration=buf.duration*1000;
 if(!t.bpm){const a=analyzeAudio(buf);if(a.bpm){t.bpm=a.bpm;t.bpmEstimated=true}}
 if(!t.intro)t.intro=djIntroFeatures(buf);
 if(t.bpm&&!(t.grid&&t.grid.v===2&&t.grid.src===t.bpm)){
  const g=djComputeGrid(buf,t.bpm);
  if(g){g.v=2;if(t.bpmEstimated&&!g.weak)t.bpm=Math.round(g.bpm*10)/10;g.src=t.bpm;t.grid=g}
 }
 if(djGridOK(t)&&!djSectOK(t)){const s=djSections(buf,t.grid);if(s)t.sect=s}
 if(!t.tonal||t.tonal.v!==1){const ton=djTonal(buf);if(ton)t.tonal=ton}
 if(t.tonal&&!t.key&&keys.includes(t.tonal.key)){t.key=t.tonal.key;t.keyEstimated=true}
 return true;
}
let djPrepBusy=null;
function djPrepareAll(opts={}){
 if(djPrepBusy)return djPrepBusy;
 djPrepBusy=(async()=>{
  const list=djAvailable().filter(t=>!djExternalKind(t)),todo=list.filter(t=>opts.force||djNeedsPrep(t)),failed=[];
  for(let i=0;i<todo.length;i++){
   $('#djEngineStatus').textContent=`ANALIZANDO ${i+1}/${todo.length} · ${todo[i].title.slice(0,28)}`;
   await new Promise(r=>setTimeout(r,20));
   try{if(opts.force){delete todo[i].grid;delete todo[i].tonal}if(!await djPrepareTrack(todo[i]))failed.push(todo[i].title)}catch(e){failed.push(todo[i].title)}
  }
  if(todo.length){persist();renderSet();renderDJ()}
  $('#djEngineStatus').textContent=djCtx?'MANUAL MIX MODE':'ENGINE STANDBY';
  djAgentEmit('prepared',{analyzed:todo.length,failed});
  return {analyzed:todo.length,failed,total:list.length};
 })().finally(()=>{djPrepBusy=null});
 return djPrepBusy;
}
function djPairCost(cur,c){
 let cost=0;const bf=cur.bpm&&djBpmFor(cur),bc=c.bpm&&djBpmFor(c);
 if(bf&&bc){const d=bc-bf,ad=Math.abs(d);cost+=ad>bf*.12?12:ad*.8+(d<-1?.8:0)}else cost+=4;
 const k=djKeyCompat(cur.key,c.key),weak=(cur.keyEstimated&&(cur.tonal?.conf||0)<.5)||(c.keyEstimated&&(c.tonal?.conf||0)<.5);
 cost+=k===null?1.5:k?0:(weak?1.2:3);
 if(cur.tonal&&c.tonal)cost+=Math.abs(cur.tonal.bass-c.tonal.bass)*10;
 if(cur.energy&&c.energy&&c.energy<cur.energy)cost+=1.5*(cur.energy-c.energy);
 if(djGridOK(cur)&&djGridOK(c))cost-=.5;
 return cost;
}
function djPairNote(a,b){
 const bf=a.bpm&&djBpmFor(a),bc=b.bpm&&djBpmFor(b),k=djKeyCompat(a.key,b.key);
 return {from:a.id,to:b.id,bpm_delta:bf&&bc?+(bc-bf).toFixed(1):null,key:a.key&&b.key?`${a.key}→${b.key}`:null,key_compatible:k,bass_delta:a.tonal&&b.tonal?+(b.tonal.bass-a.tonal.bass).toFixed(2):null,beat_aligned:djGridOK(a)&&djGridOK(b),cost:+djPairCost(a,b).toFixed(2)};
}
function djApplyOrderSilent(){
 djRunAdvisor();const byId=new Map(tracks.map(t=>[t.id,t])),head=djAdvice.order.map(id=>byId.get(id)).filter(Boolean);
 if(head.length<2)return false;const rest=tracks.filter(t=>!djAdvice.order.includes(t.id));
 tracks.splice(0,tracks.length,...head,...rest);persist();renderSet();renderDJ();djRunAdvisor();return true;
}
async function djPrepareThenStart(){
 try{
  if($('#djAutoPrep').checked){const r=await djPrepareAll();const reordered=djApplyOrderSilent();toast(`Set analizado (${r.total} temas)${reordered?' y ordenado por armonía, BPM y graves':''}.`)}
 }catch(e){toast('Falló el análisis previo: '+e.message,true)}
 await djBeginSet();
}

// ---- Agent control API (driven through /api/agent, see AGENT_API.md) ----
const djAgent={on:false,polling:false,endingFor:null,orderPlan:null};
function djAgentEmit(type,data){if(!djAgent.on)return;fetch('/api/agent/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,data:data||{}})}).catch(()=>{})}
function djTrackInfo(t){if(!t)return null;return {id:t.id,title:t.title,artist:t.artist||'',bpm:t.bpm||null,bpm_estimated:!!t.bpmEstimated,key:t.key||null,key_estimated:!!t.keyEstimated,energy:t.energy||null,duration_s:t.duration?Math.round(t.duration/1000):null,mixable:djPlayable(t),external:djExternalKind(t)||null,
 beatgrid:t.grid&&t.grid.anchors?{reliable:djGridOK(t),bpm:t.grid.bpm,error_ms:t.grid.rms}:null,tonal:t.tonal?{key:t.tonal.key,confidence:t.tonal.conf,bass_ratio:t.tonal.bass}:null,intro:t.intro?{softness:+(1.1-t.intro.introRatio).toFixed(2),onset_density:+t.intro.onsetDensity.toFixed(2)}:null}}
function djDeckInfo(k){const d=djDecks[k],t=djTrack(d.id),ctl={};for(const n of [...DJ_CTL,'Rate'])ctl[n]=+$('#dj'+n+k).value;
 return {track:djTrackInfo(t),playing:!d.el.paused,mode:d.mode,position_s:+(d.el.currentTime||0).toFixed(1),duration_s:Number.isFinite(d.el.duration)?+d.el.duration.toFixed(1):null,remaining_s:Number.isFinite(d.el.duration)?+(d.el.duration-d.el.currentTime).toFixed(1):null,controls:ctl,kill:{...d.kill},loop:d.loop?{beats:d.loop.beats}:null}}
function djAgentState(){const tr=djAuto.transition;
 return {engine:$('#djEngineStatus').textContent,crossfader:+$('#djCrossfade').value,
  auto:{running:djAuto.enabled,active_deck:djAuto.active,pending_plan:djAuto.plan||null,transition:tr?{from:tr.from,to:tr.to,progress:+Math.min(1,(performance.now()-tr.start)/tr.duration).toFixed(2),fx:tr.fx,eq:tr.eq,beat_aligned:!!tr.lock,beat_error_ms:tr.err!=null&&tr.tc?.grid?Math.round(tr.err*60/tr.tc.grid.bpm*1000):null}:null,
   settings:{fade_s:+$('#djFadeSeconds').value,eq:$('#djAutoEQ').value,fx:$('#djAutoFX').value,filter_sweep:$('#djAutoFilter').checked,sync:$('#djAutoSync').checked,phrase:$('#djAutoPhrase').checked,auto_gain:$('#djAutoGain').checked}},
  decks:{A:djDeckInfo('A'),B:djDeckInfo('B')},queue:tracks.filter(t=>djPlayable(t)).map(t=>t.id),tracks:tracks.map(djTrackInfo)}}
const djNum=(v,lo,hi,name)=>{const n=Number(v);if(!Number.isFinite(n))throw new Error(`${name} debe ser numérico`);return Math.max(lo,Math.min(hi,n))};
const djDeckArg=a=>{const d=String(a.deck||'').toUpperCase();if(d!=='A'&&d!=='B')throw new Error('deck debe ser "A" o "B"');return d};
const djTrackArg=(id)=>{const t=djTrack(id);if(!t)throw new Error('track inexistente: '+id);return t};
async function djAgentRun(action,a){
 await djEnsureMixer().catch(()=>{});
 switch(action){
  case 'state':return djAgentState();
  case 'list_tracks':return tracks.map(djTrackInfo);
  case 'analyze':{const r=await djPrepareAll({force:!!a.force});return {...r,tracks:tracks.map(djTrackInfo)}}
  case 'plan_set':{await djPrepareAll();const scored=djSuggestOpening(djAvailable()),order=djSuggestOrder(scored);djAgent.orderPlan=order.map(t=>t.id);
   return {order:order.map(djTrackInfo),pairs:order.slice(1).map((t,i)=>djPairNote(order[i],t)),opener_candidates:scored.slice(0,3).map(x=>({id:x.t.id,title:x.t.title,score:+x.score.toFixed(2),reasons:x.reasons}))}}
  case 'apply_plan':{if(!djAgent.orderPlan)throw new Error('primero llamá a plan_set');const ids=djAgent.orderPlan;return djAgentRun('set_order',{ids})}
  case 'set_order':{const ids=(a.ids||[]);if(!Array.isArray(ids)||!ids.length)throw new Error('ids debe ser una lista');const by=new Map(tracks.map(t=>[t.id,t]));
   for(const id of ids)if(!by.has(id))throw new Error('track inexistente: '+id);const head=ids.map(id=>by.get(id)),rest=tracks.filter(t=>!ids.includes(t.id));
   tracks.splice(0,tracks.length,...head,...rest);persist();renderSet();renderDJ();return {queue:tracks.map(t=>t.id)}}
  case 'start':{if(a.first_id){const i=tracks.findIndex(t=>t.id===a.first_id);if(i<0)throw new Error('first_id inexistente');tracks.unshift(tracks.splice(i,1)[0]);persist();renderSet();renderDJ()}
   if(a.prepare!==false)await djPrepareAll();await djBeginSet();return djAgentState()}
  case 'stop':djStopAll();return djAgentState();
  case 'next':{if(a.plan)await djAgentRun('plan_transition',a.plan);djAuto.enabled=true;if(!djDecks[djAuto.active].id){await djBeginSet();return djAgentState()}await djBeginTransition(a.fade?djNum(a.fade,2,60,'fade'):undefined);return djAgentState()}
  case 'plan_transition':{
   if(a.from_id){if(djAuto.pending||djAuto.transition||djDecks[djAuto.active].id!==a.from_id)throw new Error('plan tardío: la transición de ese tema ya empezó');}
   const p={};if(a.from_id)p.from=a.from_id;if(a.fade!=null)p.fade=djNum(a.fade,4,60,'fade');
   if(a.eq!=null){if(!['off','bass','blend'].includes(a.eq))throw new Error('eq: off|bass|blend');p.eq=a.eq}
   if(a.fx!=null){if(!['off','echo','reverb','flanger','random'].includes(a.fx))throw new Error('fx: off|echo|reverb|flanger|random');p.fx=a.fx}
   if(a.fx_amount!=null)p.fxAmt=djNum(a.fx_amount,0,100,'fx_amount')/100;
   if(a.filter!=null)p.filter=!!a.filter;if(a.repeat)p.repeat=true;
   if(a.next_id){const nt=djTrackArg(a.next_id);if(!djPlayable(nt))throw new Error('ese track no es mezclable');
    const cur=djTrack(djDecks[djAuto.active].id);if(cur&&cur.id!==nt.id){const i=tracks.findIndex(t=>t.id===nt.id);tracks.splice(i,1);tracks.splice(tracks.findIndex(t=>t.id===cur.id)+1,0,nt);persist();renderSet();renderDJ();
     const idle=djAuto.active==='A'?'B':'A';if(!djDecks[idle].loading&&djDecks[idle].id!==nt.id&&djAuto.enabled)djLoadDeck(idle,nt.id)}
    p.next=nt.id}
   djAuto.plan=p;return {plan:p}}
  case 'clear_plan':djAuto.plan=null;return {plan:null};
  case 'set_auto':{const set=(id,v)=>{const el=$(id);el.value=v;el.dispatchEvent(new Event('change'))};
   if(a.fade!=null){const n=djNum(a.fade,8,48,'fade'),opts=[8,16,24,32,48];set('#djFadeSeconds',String(opts.reduce((b,o)=>Math.abs(o-n)<Math.abs(b-n)?o:b)))}
   if(a.eq!=null){if(!['off','bass','blend'].includes(a.eq))throw new Error('eq: off|bass|blend');set('#djAutoEQ',a.eq)}
   if(a.fx!=null){if(!['off','echo','reverb','flanger','random'].includes(a.fx))throw new Error('fx: off|echo|reverb|flanger|random');set('#djAutoFX',a.fx)}
   for(const [k,id] of [['filter','#djAutoFilter'],['sync','#djAutoSync'],['phrase','#djAutoPhrase'],['auto_gain','#djAutoGain']])if(a[k]!=null){$(id).checked=!!a[k];$(id).dispatchEvent(new Event('change'))}
   return djAgentState().auto.settings}
  case 'load':{const d=djDeckArg(a);djTrackArg(a.id);djStopAuto();const ok=await djLoadDeck(d,a.id);return {loaded:ok,deck:djDeckInfo(d)}}
  case 'play':case 'pause':{const d=djDeckArg(a),dk=djDecks[d];if(!dk.id)throw new Error('el deck está vacío');if(action==='play'===dk.el.paused)$('#djPlay'+d).click();await new Promise(r=>setTimeout(r,150));return djDeckInfo(d)}
  case 'seek':{const d=djDeckArg(a),dk=djDecks[d];if(!dk.id||!Number.isFinite(dk.el.duration))throw new Error('deck sin duración');dk.el.currentTime=djNum(a.seconds,0,dk.el.duration-.5,'seconds');djDrawWave(d);return djDeckInfo(d)}
  case 'set_control':{const d=djDeckArg(a),n=String(a.name||'');if(![...DJ_CTL,'Rate'].includes(n))throw new Error('name: '+[...DJ_CTL,'Rate'].join('|'));
   const el=$('#dj'+n+d),v=djNum(a.value,+el.min,+el.max,'value'),ms=a.ms?djNum(a.ms,50,60000,'ms'):0;if(n==='Rate')djAuto.ramp=null;
   if(ms)djSlideFX(d,n,+el.value,v,ms);else{clearInterval(el._anim);el._anim=null;el.value=v;djApplyFX(d)}return {deck:d,name:n,target:v,ramp_ms:ms}}
  case 'kill':{const d=djDeckArg(a),b=String(a.band||'');if(!['low','mid','high'].includes(b))throw new Error('band: low|mid|high');djDecks[d].kill[b]=!!a.on;
   $$(`.dj-kill[data-deck="${d}"][data-band="${b}"]`).forEach(x=>x.classList.toggle('active',!!a.on));djApplyFX(d);return {deck:d,band:b,on:!!a.on}}
  case 'pad':{const d=djDeckArg(a),m={throw:'#djThrow',sweep:'#djSweep',brake:'#djBrake',echo_out:'#djEchoOut'}[a.name];if(!m)throw new Error('name: throw|sweep|brake|echo_out');$(m+d).click();return {deck:d,pad:a.name}}
  case 'crossfade':{const v=djNum(a.value,0,100,'value'),ms=a.ms?djNum(a.ms,50,60000,'ms'):0;djStopAuto();
   if(!ms){djSetCrossfader(v);return {crossfader:v}}const from=+$('#djCrossfade').value,t0=performance.now();clearInterval(djAgent.xf);
   djAgent.xf=setInterval(()=>{const k=Math.min(1,(performance.now()-t0)/ms);djSetCrossfader(from+(v-from)*k);if(k>=1)clearInterval(djAgent.xf)},40);return {crossfader_target:v,ramp_ms:ms}}
  case 'loop':{const d=djDeckArg(a),b=$(`.dj-loop-btn[data-deck="${d}"][data-beats="${a.beats}"]`);if(!b)throw new Error('beats: 0.5|1|2|4|8|16');b.click();return djDeckInfo(d).loop||{loop:null}}
  case 'jump':{const d=djDeckArg(a),b=$(`.dj-jump-btn[data-deck="${d}"][data-beats="${a.beats}"]`);if(!b)throw new Error('beats: -8|-4|4|8');b.click();return djDeckInfo(d)}
  case 'cue':{const d=djDeckArg(a),i=djNum(a.index,0,3,'index'),b=$(`.dj-cue-btn[data-deck="${d}"][data-i="${i}"]`);if(a.delete)b.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));else b.click();return djDeckInfo(d)}
  case 'set_track':{const t=djTrackArg(a.id);
   if(a.bpm!=null){const v=a.bpm===null?null:djNum(a.bpm,40,220,'bpm');t.bpm=v;t.bpmEstimated=false;delete t.grid;djEnsureGrid(t)}
   if(a.key!=null){if(!keys.includes(a.key))throw new Error('key inválida (Camelot, ej. 8A)');t.key=a.key;t.keyEstimated=false}
   if(a.energy!=null)t.energy=djNum(a.energy,1,10,'energy');persist();renderSet();renderDJ();return djTrackInfo(t)}
  default:throw new Error('acción desconocida: '+action);
 }
}
const djSleep=ms=>new Promise(r=>setTimeout(r,ms));
async function djAgentLoop(){
 if(djAgent.polling)return;djAgent.polling=true;$('#djAgentNote').textContent='Agente: esperando comandos (API local /api/agent)';
 while(djAgent.on){
  try{
   const r=await fetch('/api/agent/poll');if(r.status===204)continue;if(!r.ok){await djSleep(2500);continue}
   const cmd=await r.json();let out;
   try{out={id:cmd.id,ok:true,result:await djAgentRun(cmd.action,cmd.args||{})}}catch(e){out={id:cmd.id,ok:false,error:String(e&&e.message||e)}}
   await fetch('/api/agent/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(out)});
  }catch(e){await djSleep(2500)}
 }
 djAgent.polling=false;$('#djAgentNote').textContent='Control por agente desactivado.';
}
$('#djAgentOn').addEventListener('change',e=>{djAgent.on=e.target.checked;try{localStorage.setItem('synklab_agent_on',djAgent.on?'1':'0')}catch(_){}if(djAgent.on)djAgentLoop()});
try{if(localStorage.getItem('synklab_agent_on')==='1'){$('#djAgentOn').checked=true;djAgent.on=true;djAgentLoop()}}catch(_){}
window.synklab={run:(action,args)=>djAgentRun(action,args||{}),state:djAgentState};
$('#djAnalyzeSet').addEventListener('click',async()=>{$('#djAnalyzeSet').disabled=true;try{await djPrepareAll();djRunAdvisor()}finally{$('#djAnalyzeSet').disabled=false}});
