/**
 * Self-contained source for the PIN-scanner Web Worker (and the Node
 * worker_threads test harness).
 *
 * Kept as a plain string so it can be turned into a Blob URL at runtime, which
 * is what keeps it CSP-safe (`worker-src 'self' blob:`) and independent of the
 * host's module/worker bundling. It must therefore contain NO template
 * literals, no imports and no TypeScript — plain ES5-compatible JS only.
 *
 * Protocol
 *   -> { type:"scan", enc, plan, stream }
 *   <- { type:"candidate", pin, cidx }   candidate that passed the gate
 *   <- { type:"progress", tried }        live count for % progress
 *   <- { type:"done", tried, stopped }   finished / stopped early
 *   -> { type:"stop" }                   broadcast once a hit is CONFIRMED
 *
 * `plan` is the ordered cheapest-first search plan from `pdf-pin-plan.ts`.
 * `seg.digits === 0` blocks carry explicit literal passwords; numeric blocks
 * sweep [start, end) at the given fixed width.
 *
 * Gate selection: when /U is present and usable the scan uses the PDF-standard
 * /U checksum (Algorithm 4/5) — ~1/2^128 false positives, so a hit is trusted.
 * Only when /U is missing/malformed does it fall back to the 2-byte zlib
 * stream-header gate, whose ~1/65536 false-positive rate is why the main
 * thread re-confirms every candidate with the real stream oracle.
 */
export const SCANNER_WORKER_SOURCE = `
'use strict';
var MD5_S=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
var MD5_K=(function(){var K=new Uint32Array(64);for(var i=0;i<64;i++){K[i]=Math.floor(Math.abs(Math.sin(i+1))*0x100000000)>>>0;}return K;})();
function md5Block(st,msg,M){
  var i;for(i=0;i<16;i++){M[i]=(msg[i*4]|(msg[i*4+1]<<8)|(msg[i*4+2]<<16)|(msg[i*4+3]<<24))>>>0;}
  var a=st[0],b=st[1],c=st[2],d=st[3],f,g,x,s;
  for(i=0;i<64;i++){
    if(i<16){f=(b&c)|(~b&d);g=i;}
    else if(i<32){f=(d&b)|(~d&c);g=(5*i+1)&15;}
    else if(i<48){f=b^c^d;g=(3*i+5)&15;}
    else{f=c^(b|~d);g=(7*i)&15;}
    x=(f+a+MD5_K[i]+M[g])>>>0;a=d;d=c;c=b;
    s=x;b=(b+((s<<MD5_S[i])|(s>>>(32-MD5_S[i]))))>>>0;
  }
  st[0]=(st[0]+a)>>>0;st[1]=(st[1]+b)>>>0;st[2]=(st[2]+c)>>>0;st[3]=(st[3]+d)>>>0;
}
function u32le(v){return new Uint8Array([v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255]);}
function fromHex(h){var out=new Uint8Array(h.length/2),i;for(i=0;i<out.length;i++){out[i]=parseInt(h.slice(i*2,i*2+2),16);}return out;}
var _md5o=new Uint8Array(16);
var _md5s={p:new Uint8Array(128),st:new Uint32Array(4),M:new Uint32Array(16),o:_md5o,dv:new DataView(_md5o.buffer)};
function md5Bytes(bytes,len,scratch){
  if(!scratch){scratch=_md5s;}
  var padded=scratch.p,st=scratch.st,M=scratch.M;
  padded.fill(0,0,128);padded.set(bytes,0);padded[len]=0x80;
  var paddedLen=(((len+8)>>6)<<6)+64,bits=len*8;
  padded[paddedLen-8]=bits&0xff;padded[paddedLen-7]=(bits>>>8)&0xff;
  padded[paddedLen-6]=(bits>>>16)&0xff;padded[paddedLen-5]=(bits>>>24)&0xff;
  st[0]=0x67452301;st[1]=0xefcdab89;st[2]=0x98badcfe;st[3]=0x10325476;
  var h;for(h=0;h<paddedLen;h+=64){md5Block(st,padded.subarray(h,h+64),M);}
  scratch.dv.setUint32(0,st[0],true);scratch.dv.setUint32(4,st[1],true);
  scratch.dv.setUint32(8,st[2],true);scratch.dv.setUint32(12,st[3],true);
  return scratch.o;
}
var _sbox=new Uint8Array(256);
function rc4Xor(key,data,len){
  var S=_sbox,i,j=0,a=0,b=0,q,t,kl=key.length;
  for(i=0;i<256;i++){S[i]=i;}
  for(i=0;i<256;i++){j=(j+S[i]+key[i%kl])&0xff;t=S[i];S[i]=S[j];S[j]=t;}
  for(q=0;q<len;q++){a=(a+1)&0xff;b=(b+S[a])&0xff;t=S[a];S[a]=S[b];S[b]=t;data[q]^=S[(S[a]+S[b])&0xff];}
}
var PADDING=new Uint8Array([0x28,0xbf,0x4e,0x5e,0x4e,0x75,0x8a,0x41,0x64,0x00,0x4e,0x56,0xff,0xfa,0x01,0x08,0x2e,0x2e,0x00,0xb6,0xd0,0x68,0x3e,0x80,0x2f,0x0c,0xa9,0xfe,0x64,0x53,0x69,0x7a]);
var enc=null,nn=16,ws=null,uTarget=null;
var block0=new Uint8Array(64),block1=new Uint8Array(64),iterBlock=new Uint8Array(64);
var uHash=new Uint8Array(16),uWork=new Uint8Array(16),rkKey=new Uint8Array(16);
var probe=new Uint8Array(2),objKey=new Uint8Array(16),seedBuf=new Uint8Array(24);
function setupEnc(raw){
  enc={o:fromHex(raw.o),u:raw.u?fromHex(raw.u):new Uint8Array(0),p:raw.p,r:raw.r,lengthBits:raw.lengthBits,id:fromHex(raw.id)};
  nn=enc.lengthBits/8;
  ws={st:new Uint32Array(4),msg:new Uint8Array(64),M:new Uint32Array(16),key:new Uint8Array(nn)};
  block0.fill(0);block0.set(enc.o.subarray(0,32),32);
  block1.fill(0);block1.set(u32le(enc.p),0);
  var idLen=Math.min(enc.id.length,16);block1.set(enc.id.subarray(0,idLen),4);
  block1[4+idLen]=0x80;block1[56]=672&0xff;block1[57]=(672>>>8)&0xff;
  iterBlock.fill(0);iterBlock[nn]=0x80;iterBlock[56]=(nn*8)&0xff;
  if(enc.u.length>=16){
    uTarget=enc.u.subarray(0,16);
    var seed=new Uint8Array(32+enc.id.length);seed.set(PADDING,0);seed.set(enc.id,32);
    var dig=md5Bytes(seed,seed.length),i;
    for(i=0;i<16;i++){uHash[i]=dig[i];}
  }else{uTarget=null;}
}
function fileKeyFast(pwBuf,pwLen){
  var st=ws.st,msg=ws.msg,M=ws.M,key=ws.key,i,c;
  for(i=0;i<pwLen;i++){block0[i]=pwBuf[i];}
  for(i=pwLen;i<32;i++){block0[i]=PADDING[i-pwLen];}
  st[0]=0x67452301;st[1]=0xefcdab89;st[2]=0x98badcfe;st[3]=0x10325476;
  msg.set(block0,0);md5Block(st,msg,M);
  msg.set(block1,0);md5Block(st,msg,M);
  stateToKey(st,key);
  if(enc.r>=3){
    for(c=0;c<50;c++){
      st[0]=0x67452301;st[1]=0xefcdab89;st[2]=0x98badcfe;st[3]=0x10325476;
      msg.set(iterBlock,0);
      for(i=0;i<nn;i++){msg[i]=key[i];}
      md5Block(st,msg,M);
      stateToKey(st,key);
    }
  }
  return key;
}
function stateToKey(st,key){
  var i,v;for(i=0;i<nn;i+=4){v=st[i>>2];key[i]=v&0xff;key[i+1]=(v>>>8)&0xff;key[i+2]=(v>>>16)&0xff;key[i+3]=(v>>>24)&0xff;}
}
function userPasswordHit(fileKey){
  if(!uTarget){return false;}
  var i,k;
  for(i=0;i<16;i++){uWork[i]=uHash[i];}
  for(i=0;i<20;i++){
    for(k=0;k<nn;k++){rkKey[k]=fileKey[k]^(i===0?0:i);}
    rc4Xor(rkKey,uWork,16);
  }
  for(i=0;i<16;i++){if(uWork[i]!==uTarget[i]){return false;}}
  return true;
}
function streamHeaderHit(fileKey,sb){
  var kl=fileKey.length,i;
  for(i=0;i<kl;i++){seedBuf[i]=fileKey[i];}
  seedBuf[kl]=sb.obj&0xff;seedBuf[kl+1]=(sb.obj>>>8)&0xff;seedBuf[kl+2]=(sb.obj>>>16)&0xff;
  seedBuf[kl+3]=sb.gen&0xff;seedBuf[kl+4]=(sb.gen>>>8)&0xff;
  var dig=md5Bytes(seedBuf,kl+5),lim=Math.min(nn+5,16);
  for(i=0;i<lim;i++){objKey[i]=dig[i];}
  probe[0]=sb.b0;probe[1]=sb.b1;
  rc4Xor(objKey,probe,2);
  return probe[0]===0x78&&probe[1]===0x9c;
}
var _post=typeof self!=="undefined"?function(m){self.postMessage(m);}:null;
var _onmsg=typeof self!=="undefined"?function(fn){self.onmessage=fn;}:null;
if(!_post&&typeof process!=="undefined"&&process.versions&&process.versions.node){var wt=null;try{wt=require("node:worker_threads");}catch(e){}if(wt&&wt.parentPort){_post=function(m){wt.parentPort.postMessage(m);};_onmsg=function(fn){wt.parentPort.on("message",function(d){fn({data:d});});};}}
function post(msg){_post(msg);}
function onMsg(fn){_onmsg(fn);}
var stopped=false,pwBuf=new Uint8Array(8),CHUNK=4096;
onMsg(function(ev){
  var d=ev.data;
  if(d.type==="stop"){stopped=true;return;}
  if(d.type!=="scan"){return;}
  setupEnc(d.enc);
  stopped=false;
  var plan=d.plan,sb=d.stream,tried=0,si,strong=!!uTarget;
  for(si=0;si<plan.length;si++){
    if(stopped){break;}
    var seg=plan[si],k;
    if(seg.digits===0){
      var list=seg.literal||[];
      for(k=0;k<list.length;k++){
        var s=list[k],len=s.length;
        if(len<1||len>8){continue;}
        var j;for(j=0;j<len;j++){pwBuf[j]=s.charCodeAt(j)&0xff;}
        var lk=fileKeyFast(pwBuf,len);
        if(strong?userPasswordHit(lk):streamHeaderHit(lk,sb)){post({type:"candidate",pin:s,cidx:tried});stopped=true;}
        tried++;
        if((k&2047)===0){post({type:"progress",tried:tried});}
        if(stopped){break;}
      }
    }else{
      var digits=seg.digits,val=seg.start,end=seg.end,v=end-val,done=0;
      while(done<v&&!stopped){
        var upto=Math.min(v-done,CHUNK),q;
        for(q=0;q<upto;q++,val++){
          var t2=val;
          for(k=digits-1;k>=0;k--){pwBuf[k]=0x30+(t2%10);t2=Math.floor(t2/10);}
          var nk=fileKeyFast(pwBuf,digits);
          if(strong?userPasswordHit(nk):streamHeaderHit(nk,sb)){
            var pin="";for(k=0;k<digits;k++){pin+=String.fromCharCode(pwBuf[k]);}
            post({type:"candidate",pin:pin,cidx:tried+q});stopped=true;
          }
        }
        done+=upto;tried+=upto;post({type:"progress",tried:tried});
      }
    }
  }
  post({type:"done",tried:tried,stopped:stopped});
});
`;

/** The same source, exposed for contract tests. */
export const __rawWorkerSource = SCANNER_WORKER_SOURCE;
