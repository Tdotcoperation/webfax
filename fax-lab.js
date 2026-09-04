(()=>{
const $=s=>document.querySelector(s);
const FAX={ctx:null,stream:null,src:null,an:null,raf:0,osc:null,gain:null,timer:null,role:null,cngHits:0,cedHits:0,v21Hits:0};
function setState(t,d){$('#faxState').textContent=t;$('#faxDesc').textContent=d||''}
function log(t){const el=$('#faxLog');const row=document.createElement('div');row.textContent=new Date().toLocaleTimeString()+' · '+t;el.prepend(row);while(el.children.length>12)el.lastChild.remove()}
function toneEnergy(data,sr,f){let re=0,im=0;const N=data.length;for(let i=0;i<N;i++){const w=2*Math.PI*f*i/sr;re+=data[i]*Math.cos(w);im-=data[i]*Math.sin(w)}return re*re+im*im}
async function openAudio(){if(FAX.ctx)return;FAX.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});const A=window.AudioContext||window.webkitAudioContext;FAX.ctx=new A();await FAX.ctx.resume();FAX.src=FAX.ctx.createMediaStreamSource(FAX.stream);FAX.an=FAX.ctx.createAnalyser();FAX.an.fftSize=2048;FAX.src.connect(FAX.an);monitor()}
function monitor(){if(!FAX.an)return;const data=new Float32Array(FAX.an.fftSize);FAX.an.getFloatTimeDomainData(data);const sr=FAX.ctx.sampleRate;const e1100=toneEnergy(data,sr,1100),e2100=toneEnergy(data,sr,2100),e1650=toneEnergy(data,sr,1650),e1850=toneEnergy(data,sr,1850);let total=0;for(const v of data)total+=v*v;total=Math.max(total,1e-9);const cng=e1100/total,ced=e2100/total,v21=Math.max(e1650,e1850)/total;$('#faxFreq').textContent=ced>cng&&ced>v21?'2100 Hz':v21>cng?'V.21 1650/1850 Hz':'1100 Hz';if(cng>85)FAX.cngHits++;else FAX.cngHits=Math.max(0,FAX.cngHits-1);if(ced>85)FAX.cedHits++;else FAX.cedHits=Math.max(0,FAX.cedHits-1);if(v21>55)FAX.v21Hits++;else FAX.v21Hits=Math.max(0,FAX.v21Hits-1);
if(FAX.cedHits===5){log('CED 2100 Hz 응답 감지');setState('상대 팩스 응답 감지','실제 팩스의 CED 응답음이 감지되었습니다. 다음 단계는 V.21 DIS 프레임 해석입니다.')}
if(FAX.cngHits===5&&FAX.role==='rx'){log('CNG 1100 Hz 호출 감지');setState('팩스 호출 감지','송신 측의 CNG 호출음을 감지했습니다.')}
if(FAX.v21Hits===5){log('V.21 제어 채널 감지');setState('T.30 제어 채널 감지','1650/1850 Hz V.21 계열 제어 신호가 감지되었습니다. 현재 Lab은 프레임 존재까지 확인합니다.')}
FAX.raf=requestAnimationFrame(monitor)}
function stopTone(){clearInterval(FAX.timer);FAX.timer=null;try{FAX.osc?.stop()}catch{};FAX.osc=null;if(FAX.gain)FAX.gain.gain.value=0}
function playTone(freq,duration=.5){stopTone();FAX.osc=FAX.ctx.createOscillator();FAX.gain=FAX.ctx.createGain();FAX.osc.frequency.value=freq;FAX.gain.gain.value=.32;FAX.osc.connect(FAX.gain).connect(FAX.ctx.destination);FAX.osc.start();setTimeout(()=>{try{FAX.osc?.stop()}catch{};FAX.osc=null},duration*1000)}
async function startTx(){FAX.role='tx';await openAudio();stopTone();setState('팩스 송신 대기','상대 팩스 번호로 전화를 건 뒤 스피커폰으로 두고 CNG를 전송합니다.');log('FAX TX 시작');const pulse=()=>{playTone(1100,.5);log('CNG 1100 Hz 전송')};pulse();FAX.timer=setInterval(pulse,3500);$('#faxStop').classList.remove('hidden')}
async function startRx(){FAX.role='rx';await openAudio();stopTone();setState('팩스 수신 대기','전화가 연결된 상태에서 상대의 CNG 호출음을 기다립니다. CNG 감지 후 CED 응답을 수동으로 보낼 수 있습니다.');log('FAX RX 시작');$('#faxStop').classList.remove('hidden')}
async function sendCed(){if(!FAX.ctx)await openAudio();playTone(2100,3);log('CED 2100 Hz 3초 전송');setState('CED 응답 전송','수신 팩스의 기본 응답음을 전송했습니다. 이후 상대의 V.21 제어 신호를 감시합니다.')}
function stop(){stopTone();cancelAnimationFrame(FAX.raf);FAX.stream?.getTracks().forEach(t=>t.stop());try{FAX.ctx?.close()}catch{};FAX.ctx=FAX.stream=FAX.src=FAX.an=null;FAX.role=null;$('#faxStop').classList.add('hidden');setState('중지됨','팩스 오디오 세션을 종료했습니다.');log('FAX Lab 중지')}
$('#faxTxStart')?.addEventListener('click',()=>startTx().catch(e=>setState('시작 실패',e.message)));
$('#faxRxStart')?.addEventListener('click',()=>startRx().catch(e=>setState('시작 실패',e.message)));
$('#faxSendCed')?.addEventListener('click',()=>sendCed().catch(e=>setState('전송 실패',e.message)));
$('#faxStop')?.addEventListener('click',stop);
$('#faxFile')?.addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;$('#faxFileName').textContent=f.name;$('#faxFileMeta').textContent=(f.type||'알 수 없는 형식')+' · '+Math.ceil(f.size/1024)+' KB';log('문서 준비: '+f.name)});
})();