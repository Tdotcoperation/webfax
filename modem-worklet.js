class ModemModulator extends AudioWorkletProcessor {
  constructor(){
    super();
    this.active=false;this.phase=0;this.stage='idle';this.pos=0;this.byteIndex=0;this.dibitIndex=0;
    this.freqs=[900,1300,1700,2100];this.leaderFreq=2500;
    this.port.onmessage=e=>{
      const m=e.data;
      if(m.type==='start'){
        this.bytes=new Uint8Array(m.bytes);
        this.symbolFrames=Math.max(1,Math.round(sampleRate*m.symbolMs/1000));
        this.leaderFrames=Math.round(sampleRate*1.1);
        this.gapFrames=Math.round(sampleRate*.22);
        this.tailFrames=Math.round(sampleRate*.2);
        this.active=true;this.stage='leader';this.pos=0;this.byteIndex=0;this.dibitIndex=0;this.phase=0;
      }else if(m.type==='stop'){
        this.active=false;this.stage='idle';
      }
    };
  }
  tone(freq,amp=.36){
    this.phase+=2*Math.PI*freq/sampleRate;
    if(this.phase>2*Math.PI)this.phase-=2*Math.PI;
    return Math.sin(this.phase)*amp;
  }
  process(inputs,outputs){
    const out=outputs[0][0];
    for(let i=0;i<out.length;i++){
      if(!this.active){out[i]=0;continue;}
      if(this.stage==='leader'){
        out[i]=this.tone(this.leaderFreq,.42);
        if(++this.pos>=this.leaderFrames){this.stage='gap';this.pos=0;this.phase=0;}
      }else if(this.stage==='gap'){
        out[i]=0;
        if(++this.pos>=this.gapFrames){this.stage='data';this.pos=0;this.phase=0;}
      }else if(this.stage==='data'){
        const b=this.bytes[this.byteIndex];
        const shift=6-this.dibitIndex*2;
        const dibit=(b>>shift)&3;
        out[i]=this.tone(this.freqs[dibit],.36);
        if(++this.pos>=this.symbolFrames){
          this.pos=0;this.phase=0;this.dibitIndex++;
          if(this.dibitIndex===4){
            this.dibitIndex=0;this.byteIndex++;
            if(this.byteIndex%8===0||this.byteIndex===this.bytes.length){
              this.port.postMessage({type:'progress',done:this.byteIndex,total:this.bytes.length});
            }
          }
          if(this.byteIndex>=this.bytes.length){this.stage='tail';this.pos=0;}
        }
      }else if(this.stage==='tail'){
        out[i]=0;
        if(++this.pos>=this.tailFrames){this.active=false;this.stage='idle';this.port.postMessage({type:'done'});}
      }
    }
    return true;
  }
}

class ModemCapture extends AudioWorkletProcessor {
  constructor(){
    super();this.buf=new Float32Array(256);this.pos=0;
  }
  process(inputs){
    const input=inputs[0]?.[0];
    if(!input)return true;
    for(let i=0;i<input.length;i++){
      this.buf[this.pos++]=input[i];
      if(this.pos===this.buf.length){
        const send=this.buf;
        this.buf=new Float32Array(256);this.pos=0;
        this.port.postMessage(send,[send.buffer]);
      }
    }
    return true;
  }
}

registerProcessor('modem-modulator',ModemModulator);
registerProcessor('modem-capture',ModemCapture);
