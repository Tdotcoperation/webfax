const $=s=>document.querySelector(s);
const tabs=[...document.querySelectorAll('.tab')];
tabs.forEach(t=>t.onclick=()=>{
  tabs.forEach(x=>x.classList.toggle('active',x===t));
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===t.dataset.tab));
});
for(let i=0;i<28;i++){const x=document.createElement('i');x.style.animationDelay=(i*.035)+'s';x.style.animationDuration=(.3+Math.random()*.45)+'s';$('#wave').appendChild(x)}

const enc=new TextEncoder(),dec=new TextDecoder();
const MAX_FILE=256*1024,FREQS=[900,1300,1700,2100],LEADER=2500;
let chosen=null,txCtx=null,txNode=null,sending=false;

function fmt(n){if(n<1024)return n+' B';if(n<1024*1024)return(n/1024).toFixed(1)+' KB';return(n/1024/1024).toFixed(2)+' MB'}
function eta(bytes,ms){const meta=24+(chosen?.name?.length||0)+(chosen?.type?.length||0),sec=(bytes+meta)*4*ms/1000+1.5;if(sec<60)return Math.ceil(sec)+'초';if(sec<3600)return Math.floor(sec/60)+'분 '+Math.ceil(sec%60)+'초';return Math.floor(sec/3600)+'시간 '+Math.ceil((sec%3600)/60)+'분'}
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^0xffffffff)>>>0}
function u32be(n){return[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]}
function readU32(a,o){return((a[o]<<24)>>>0)+(a[o+1]<<16)+(a[o+2]<<8)+a[o+3]}
async function buildPacket(file){
  const name=enc.encode(file.name),mime=enc.encode(file.type||'application/octet-stream');
  if(name.length>255||mime.length>255)throw new Error('파일명 또는 MIME 정보가 너무 깁니다.');
  if(file.size>MAX_FILE)throw new Error('현재 버전은 최대 256 KB 파일까지 전송할 수 있습니다.');
  const payload=new Uint8Array(await file.arrayBuffer());
  const header=new Uint8Array([87,77,70,49,name.length,mime.length,...u32be(payload.length)]);
  const packetNoCrc=new Uint8Array(header.length+name.length+mime.length+payload.length);
  let o=0;packetNoCrc.set(header,o);o+=header.length;packetNoCrc.set(name,o);o+=name.length;packetNoCrc.set(mime,o);o+=mime.length;packetNoCrc.set(payload,o);
  const packet=new Uint8Array(packetNoCrc.length+4);packet.set(packetNoCrc);packet.set(u32be(crc32(payload)),packetNoCrc.length);return packet;
}
function refreshFileState(){
  chosen=$('#file').files?.[0]||null;const btn=$('#sendBtn');
  if(!chosen){btn.disabled=true;return}
  $('#fileName').textContent=chosen.name;const tooBig=chosen.size>MAX_FILE;
  $('#fileInfo').textContent=fmt(chosen.size)+' · '+(chosen.type||'알 수 없는 형식')+(tooBig?' · 256 KB 초과':'');
  btn.disabled=false;$('#eta').textContent=eta(chosen.size,+$('#speed').value);
}
$('#file').addEventListener('change',refreshFileState);$('#file').addEventListener('input',refreshFileState);
$('#speed').onchange=()=>{if(chosen)$('#eta').textContent=eta(chosen.size,+$('#speed').value)};

$('#sendBtn').onclick=async()=>{
  if(!chosen||sending)return;
  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)throw new Error('Web Audio API를 지원하지 않는 브라우저입니다.');
    const packet=await buildPacket(chosen);txCtx=new AudioCtx();
    if(!txCtx.audioWorklet)throw new Error('AudioWorklet을 지원하지 않습니다.');
    await txCtx.audioWorklet.addModule('./modem-worklet.js');await txCtx.resume();
    txNode=new AudioWorkletNode(txCtx,'modem-modulator');txNode.connect(txCtx.destination);
    txNode.port.onmessage=e=>{
      if(e.data.type==='progress'){const p=Math.min(100,Math.round(e.data.done/e.data.total*100));$('#sendPct').textContent=p+'%';$('#sendBar').style.width=p+'%';$('#sendState').textContent=p<5?'시작 신호 전송 중':p<99?'파일 데이터 전송 중':'마무리 중'}
      if(e.data.type==='done')finishSend(true);
    };
    sending=true;$('#sendBox').classList.remove('hidden');$('#stopSendBtn').classList.remove('hidden');$('#sendBtn').classList.add('hidden');$('#sendState').textContent='시작 신호 전송 중';$('#sendPct').textContent='0%';$('#sendBar').style.width='0%';
    const copy=packet.slice();txNode.port.postMessage({type:'start',bytes:copy.buffer,symbolMs:+$('#speed').value},[copy.buffer]);
  }catch(err){showErr('전송 시작 실패: '+(err?.message||err));alert('전송 시작 실패: '+(err?.message||err));finishSend(false)}
};
$('#stopSendBtn').onclick=()=>finishSend(false);
function finishSend(ok){if(txNode)try{txNode.port.postMessage({type:'stop'})}catch{};if(txCtx)try{txCtx.close()}catch{};txNode=null;txCtx=null;sending=false;$('#stopSendBtn').classList.add('hidden');$('#sendBtn').classList.remove('hidden');if(ok){$('#sendState').textContent='전송 완료';$('#sendPct').textContent='100%';$('#sendBar').style.width='100%'}}

let rxCtx=null,rxNode=null,rxStream=null,rxSilent=null,receiving=false;
let phase='leader',leaderHits=0,dataHits=0,dataBuf=[],symbolSamples=0,decoded=[],dibits=[],expectedTotal=null;
let lastLevel=0;

function goertzel(samples,freq,sr,start=0,end=samples.length){const N=end-start;if(N<=4)return 0;const k=Math.round(N*freq/sr),w=2*Math.PI*k/N,coeff=2*Math.cos(w);let s0=0,s1=0,s2=0;for(let i=start;i<end;i++){s0=samples[i]+coeff*s1-s2;s2=s1;s1=s0}return s1*s1+s2*s2-coeff*s1*s2}
function rms(a){let s=0;for(const x of a)s+=x*x;return Math.sqrt(s/a.length)}
function spectrum(a,sr){const data=FREQS.map(f=>goertzel(a,f,sr));const le=goertzel(a,LEADER,sr);let bi=0;for(let i=1;i<data.length;i++)if(data[i]>data[bi])bi=i;return{leader:le,best:data[bi],idx:bi,freq:FREQS[bi]}}
function resetRx(){phase='leader';leaderHits=0;dataHits=0;dataBuf=[];decoded=[];dibits=[];expectedTotal=null;lastLevel=0;$('#rxBytes').textContent='0 B';$('#rxPhase').textContent='시작음 탐색';$('#rxFreq').textContent='— Hz';$('#result').classList.add('hidden');$('#errorBox').classList.add('hidden')}

$('#rxBtn').onclick=async()=>{
  if(receiving){stopRx();return}
  resetRx();
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('마이크 입력을 사용할 수 없습니다. HTTPS로 접속하세요.');
    rxStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
    const AudioCtx=window.AudioContext||window.webkitAudioContext;rxCtx=new AudioCtx();
    await rxCtx.audioWorklet.addModule('./modem-worklet.js');await rxCtx.resume();
    const src=rxCtx.createMediaStreamSource(rxStream);rxNode=new AudioWorkletNode(rxCtx,'modem-capture');rxSilent=rxCtx.createGain();rxSilent.gain.value=0;src.connect(rxNode);rxNode.connect(rxSilent).connect(rxCtx.destination);
    rxNode.port.onmessage=e=>processChunk(new Float32Array(e.data));
    receiving=true;symbolSamples=Math.round(rxCtx.sampleRate*(+$('#rxSpeed').value)/1000);
    $('#rxBtn').textContent='수신 중지';$('#rxBox').classList.remove('hidden');$('#rxRing').classList.add('listening');$('#rxState').textContent='수신 대기';$('#rxDesc').textContent='마이크가 켜졌습니다. 송신을 시작하세요.';
  }catch(err){showErr('마이크 시작 실패: '+(err?.message||err));rxStream?.getTracks().forEach(t=>t.stop())}
};
function stopRx(){receiving=false;rxStream?.getTracks().forEach(t=>t.stop());try{rxCtx?.close()}catch{};rxCtx=rxNode=rxStream=rxSilent=null;$('#rxBtn').textContent='수신 시작';$('#rxRing').classList.remove('listening');if($('#rxState').textContent!=='수신 완료'){$('#rxState').textContent='대기 중';$('#rxDesc').textContent='수신 시작을 누른 뒤 송신을 시작하세요.'}}

function processChunk(a){
  if(!receiving||!rxCtx)return;
  const level=rms(a),db=level>1e-8?20*Math.log10(level):-Infinity;lastLevel=level;
  $('#rxBar').style.width=Math.max(0,Math.min(100,(db+60)/60*100))+'%';$('#rxLevel').textContent=isFinite(db)?db.toFixed(0)+' dB':'-∞ dB';
  const sp=spectrum(a,rxCtx.sampleRate);const leaderWins=sp.leader>sp.best*1.08;const dataWins=sp.best>sp.leader*1.08;
  $('#rxFreq').textContent=(leaderWins?LEADER:sp.freq)+' Hz';

  if(phase==='leader'){
    if(level>.004&&leaderWins)leaderHits++;else leaderHits=Math.max(0,leaderHits-1);
    if(leaderHits>=8){phase='armed';dataHits=0;$('#rxPhase').textContent='시작음 감지됨';$('#rxState').textContent='신호 연결됨';$('#rxDesc').textContent='데이터 시작을 기다리는 중입니다.';return}
    return;
  }

  if(phase==='armed'){
    if(level>.003&&dataWins)dataHits++;else dataHits=Math.max(0,dataHits-1);
    if(dataHits>=2){
      const onset=findToneOnset(a);dataBuf.push(...a.slice(onset));phase='data';$('#rxPhase').textContent='데이터 수신 중';$('#rxState').textContent='파일 수신 중';$('#rxDesc').textContent='소리에서 파일을 복원하고 있습니다.';decodeAvailable();
    }
    return;
  }

  if(phase==='data'){dataBuf.push(...a);decodeAvailable()}
}
function findToneOnset(a){
  const win=32;let noise=0,count=0;for(let i=0;i<Math.min(a.length,96);i++){noise+=a[i]*a[i];count++}noise=Math.sqrt(noise/Math.max(1,count));const threshold=Math.max(.003,noise*1.8);
  for(let i=0;i+win<=a.length;i+=8){let s=0;for(let j=i;j<i+win;j++)s+=a[j]*a[j];if(Math.sqrt(s/win)>threshold)return i}return 0;
}
function decodeAvailable(){
  if(!rxCtx)return;const sr=rxCtx.sampleRate;
  while(dataBuf.length>=symbolSamples){
    const arr=Float32Array.from(dataBuf.slice(0,symbolSamples));const st=Math.floor(symbolSamples*.15),en=Math.floor(symbolSamples*.85);let best=-1,bi=0;
    for(let i=0;i<4;i++){const e=goertzel(arr,FREQS[i],sr,st,en);if(e>best){best=e;bi=i}}
    dibits.push(bi);$('#rxFreq').textContent=FREQS[bi]+' Hz';dataBuf=dataBuf.slice(symbolSamples);
    if(dibits.length===4){
      decoded.push((dibits[0]<<6)|(dibits[1]<<4)|(dibits[2]<<2)|dibits[3]);dibits=[];$('#rxBytes').textContent=fmt(decoded.length);
      if(decoded.length===4&&!(decoded[0]===87&&decoded[1]===77&&decoded[2]===70&&decoded[3]===49)){
        showErr('신호는 받았지만 첫 데이터가 맞지 않습니다. 송신/수신 속도를 동일하게 맞추고 다시 시도하세요.');stopRx();return;
      }
      if(decoded.length===10){const nameLen=decoded[4],mimeLen=decoded[5],size=readU32(decoded,6);if(size>MAX_FILE){showErr('헤더가 손상되었습니다.');stopRx();return}expectedTotal=10+nameLen+mimeLen+size+4}
      if(expectedTotal&&decoded.length>=expectedTotal){finishRx();return}
    }
  }
}
function finishRx(){
  const a=Uint8Array.from(decoded.slice(0,expectedTotal)),nameLen=a[4],mimeLen=a[5],size=readU32(a,6);let o=10;const name=dec.decode(a.slice(o,o+nameLen));o+=nameLen;const mime=dec.decode(a.slice(o,o+mimeLen));o+=mimeLen;const payload=a.slice(o,o+size);o+=size;const got=readU32(a,o),calc=crc32(payload);
  if(got!==calc){showErr('CRC 오류: 신호를 받았지만 일부 데이터가 손상되었습니다. 일반 또는 안정적 모드로 다시 시도하세요.');stopRx();return}
  const url=URL.createObjectURL(new Blob([payload],{type:mime||'application/octet-stream'}));$('#download').href=url;$('#download').download=name||'received.bin';$('#resultName').textContent=name||'received.bin';$('#resultMeta').textContent=fmt(size)+' · '+(mime||'application/octet-stream');$('#result').classList.remove('hidden');$('#rxState').textContent='수신 완료';$('#rxDesc').textContent='CRC 검사까지 통과했습니다.';stopRx();$('#rxState').textContent='수신 완료';
}
function showErr(msg){$('#errorBox').textContent=msg;$('#errorBox').classList.remove('hidden')}
