(()=>{
const $=s=>document.querySelector(s),T=window.FaxT30;
const F={ctx:null,stream:null,src:null,node:null,silent:null,role:null,state:'idle',timer:null,osc:null,gain:null,decoder:null,cng:0,ced:0,file:null,page:null,busy:false};
function setState(t,d){$('#faxState').textContent=t;$('#faxDesc').textContent=d||''}
function log(t){const el=$('#faxLog'),r=document.createElement('div');r.textContent=new Date().toLocaleTimeString()+' · '+t;el.prepend(r);while(el.children.length>18)el.lastChild.remove()}
function energy(a,sr,f){let re=0,im=0;for(let i=0;i<a.length;i++){const w=2*Math.PI*f*i/sr;re+=a[i]*Math.cos(w);im-=a[i]*Math.sin(w)}return re*re+im*im}
async function openAudio(){if(F.ctx)return;F.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});const A=window.AudioContext||window.webkitAudioContext;F.ctx=new A();await F.ctx.audioWorklet.addModule('./modem-worklet.js');await F.ctx.resume();F.src=F.ctx.createMediaStreamSource(F.stream);F.node=new AudioWorkletNode(F.ctx,'modem-capture');F.silent=F.ctx.createGain();F.silent.gain.value=0;F.src.connect(F.node);F.node.connect(F.silent).connect(F.ctx.destination);F.decoder=new T.V21Decoder(F.ctx.sampleRate,onFrame);F.node.port.onmessage=e=>onAudio(new Float32Array(e.data))}
function onAudio(a){if(!F.ctx)return;const sr=F.ctx.sampleRate,e11=energy(a,sr,1100),e21=energy(a,sr,2100),tot=Math.max(1e-9,a.reduce((s,v)=>s+v*v,0));if(e11/tot>60)F.cng++;else F.cng=Math.max(0,F.cng-1);if(e21/tot>60)F.ced++;else F.ced=Math.max(0,F.ced-1);if(F.ced===5&&F.role==='tx'){log('CED 2100 Hz 응답 감지');setState('상대 팩스 응답','DIS 제어 프레임을 기다립니다.')}if(F.cng===5&&F.role==='rx'){log('CNG 1100 Hz 호출 감지');if(F.state==='wait-cng')answerAsFax()}F.decoder?.push(a)}
function stopTone(){clearInterval(F.timer);F.timer=null;try{F.osc?.stop()}catch{}F.osc=null}
function tone(freq,sec=.5){return new Promise(res=>{const o=F.ctx.createOscillator(),g=F.ctx.createGain();o.frequency.value=freq;g.gain.value=.3;o.connect(g).connect(F.ctx.destination);o.onended=res;o.start();o.stop(F.ctx.currentTime+sec)})}
function delay(ms){return new Promise(r=>setTimeout(r,ms))}
async function prepareFile(file){F.file=file;$('#faxFileName').textContent=file.name;$('#faxFileMeta').textContent=(file.type||'알 수 없음')+' · '+Math.ceil(file.size/1024)+' KB · 변환 중';setState('문서 변환 중','팩스용 1728px 흑백 T.4 MH 페이지를 만들고 있습니다.');try{F.page=await T.imageToMH(file);$('#faxFileMeta').textContent=`T.4 MH · ${F.page.width}×${F.page.height} · ${Math.ceil(F.page.bits.length/8/1024)} KB`;log(`페이지 준비 완료 ${F.page.width}×${F.page.height}`);setState('문서 준비 완료','실제 팩스 송신을 시작할 수 있습니다.')}catch(e){F.page=null;$('#faxFileMeta').textContent=e.message;setState('문서 변환 실패',e.message)}}
async function sendControl(fr,label){log(label+' V.21 전송');await T.sendV21(F.ctx,fr);await delay(90)}
async function onFrame(fr){const type=fr[2]&0xfe,name=T.NAMES[type]||('0x'+type.toString(16));log(`V.21 ${name} 수신 (${fr.length}B)`);$('#faxFreq').textContent='V.21 '+name;
 if(F.role==='tx'){
  if(type===T.FCF.DIS&&(F.state==='calling'||F.state==='wait-dis')){stopTone();F.state='negotiating';setState('DIS 수신','2400bps · T.4 1D 조건으로 DCS를 전송합니다.');await sendControl(T.makeDCS(),'DCS');await delay(75);setState('TCF 훈련 전송','V.27ter 2400bps 훈련 확인 신호를 전송합니다.');log('V.27ter TCF 시작');await T.sendV27(F.ctx,[],true);F.state='wait-cfr';setState('CFR 대기','상대 팩스의 훈련 성공 응답을 기다립니다.');return}
  if(type===T.FCF.CFR&&F.state==='wait-cfr'){F.state='page';setState('페이지 전송 중',`T.4 MH ${F.page.width}×${F.page.height} · V.27ter 2400bps`);log('CFR 수신 · 페이지 캐리어 시작');await T.sendV27(F.ctx,F.page.bits,false);await delay(250);F.state='wait-mcf';await sendControl(T.frame(T.FCF.EOP),'EOP');setState('MCF 대기','상대 팩스가 페이지를 정상 수신했는지 확인 중입니다.');return}
  if(type===T.FCF.FTT&&F.state==='wait-cfr'){F.state='failed';setState('훈련 실패(FTT)','전화망에서 V.27ter 훈련이 통과하지 못했습니다.');log('FTT 수신');return}
  if(type===T.FCF.MCF&&F.state==='wait-mcf'){await sendControl(T.frame(T.FCF.DCN),'DCN');F.state='done';setState('팩스 전송 완료','상대 팩스에서 MCF(정상 수신 확인)를 받았습니다.');log('MCF 수신 · 실제 팩스 전송 완료');return}
 }
 if(F.role==='rx'){
  if(type===T.FCF.DCS&&F.state==='wait-dcs'){F.state='rx-training';setState('DCS 수신','상대가 페이지 전송을 요청했습니다. 현재 수신기는 제어 프레임까지 실제 해석합니다.');log('DCS 해석 완료 · V.27ter 수신 디코더 필요');await sendControl(T.frame(T.FCF.FTT),'FTT');F.state='rx-unsupported';setState('페이지 수신 보류','현재 빌드는 V.27ter 페이지 수신 복조기가 없어 FTT로 안전하게 재훈련을 요청했습니다.');return}
 }
}
async function startTx(){if(!F.page)throw Error('먼저 JPG/PNG/WebP 이미지를 선택해 팩스 페이지로 변환하세요.');await openAudio();F.role='tx';F.state='calling';F.cng=F.ced=0;stopTone();setState('팩스 호출 중','실제 팩스 번호로 전화 연결 후 스피커폰 상태를 유지하세요. CNG를 보내며 DIS를 기다립니다.');log('실제 FAX TX 시작');const pulse=async()=>{if(F.state!=='calling')return;await tone(1100,.5);log('CNG 1100 Hz')};pulse();F.timer=setInterval(pulse,3500);$('#faxStop').classList.remove('hidden')}
async function startRx(){await openAudio();F.role='rx';F.state='wait-cng';F.cng=F.ced=0;setState('실제 팩스 수신 대기','상대 송신기의 CNG를 기다립니다.');log('실제 FAX RX 시작');$('#faxStop').classList.remove('hidden')}
async function answerAsFax(){if(F.busy)return;F.busy=true;try{F.state='answering';setState('팩스 응답 중','CED 2100 Hz를 전송합니다.');await tone(2100,3);log('CED 2100 Hz 3초');await delay(120);await sendControl(T.makeDIS(),'DIS');F.state='wait-dcs';setState('DCS 대기','상대 송신기의 전송 조건 선택을 기다립니다.')}finally{F.busy=false}}
async function sendCed(){await openAudio();await tone(2100,3);log('CED 수동 전송')}
function stop(){stopTone();F.stream?.getTracks().forEach(t=>t.stop());try{F.ctx?.close()}catch{}F.ctx=F.stream=F.src=F.node=F.silent=F.decoder=null;F.role=null;F.state='idle';$('#faxStop').classList.add('hidden');setState('중지됨','팩스 오디오 세션을 종료했습니다.');log('FAX Lab 중지')}
$('#faxTxStart')?.addEventListener('click',()=>startTx().catch(e=>setState('시작 실패',e.message)));
$('#faxRxStart')?.addEventListener('click',()=>startRx().catch(e=>setState('시작 실패',e.message)));
$('#faxSendCed')?.addEventListener('click',()=>sendCed().catch(e=>setState('전송 실패',e.message)));
$('#faxStop')?.addEventListener('click',stop);
$('#faxFile')?.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)prepareFile(f)});
})();