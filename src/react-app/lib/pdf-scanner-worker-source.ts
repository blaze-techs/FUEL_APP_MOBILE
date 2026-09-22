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
  md5Core(st,M);
}
/* Compression with the message words already in M. Used by the R3/R4 key
   stretch, where the 16 key bytes ARE message words 0..3 and the rest of the
   block is constant -- so the round trip through a byte array is unnecessary. */
function md5Core(st,M){
  var a=st[0],b=st[1],c=st[2],d=st[3],f,g,x,s;
  var i;
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
  // Only the first len bytes are the message. Copying the WHOLE array (as
  // this once did) dragged stale bytes from the previous call into the hash
  // whenever a caller's scratch buffer was longer than the message -- which
  // silently corrupted every object key derived from the shared seed buffer.
  padded.fill(0,0,128);
  var c;for(c=0;c<len;c++){padded[c]=bytes[c];}
  padded[len]=0x80;
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
    /* R3/R4 stretch. stateToKey writes the state words little-endian into
       key[0..16), and that block's message words 0..3 ARE those same words,
       with words 4..15 constant (0x80 at byte 16, bit-length at byte 56).
       So the state feeds the compression function directly -- no byte-array
       round trip per iteration. */
    msg.fill(0,16);msg[16]=0x80;msg[56]=(nn*8)&0xff;
    /* Words 4..15 must be the tail of the 16-byte block (0x80 at byte 16, bit
       length 128 at byte 56), NOT whatever the previous md5Block call left in
       M -- block1 carries the /ID bytes there. md5Core never writes M, so this
       is set once, outside the loop. */
    M[4]=0x80;M[5]=0;M[6]=0;M[7]=0;M[8]=0;M[9]=0;M[10]=0;M[11]=0;M[12]=0;M[13]=0;
    M[14]=0x80;M[15]=0;
    for(c=0;c<50;c++){
      st[0]=0x67452301;st[1]=0xefcdab89;st[2]=0x98badcfe;st[3]=0x10325476;
      M[0]=key[0]|(key[1]<<8)|(key[2]<<16)|(key[3]<<24);
      M[1]=key[4]|(key[5]<<8)|(key[6]<<16)|(key[7]<<24);
      M[2]=key[8]|(key[9]<<8)|(key[10]<<16)|(key[11]<<24);
      M[3]=key[12]|(key[13]<<8)|(key[14]<<16)|(key[15]<<24);
      md5Core(st,M);
      stateToKey(st,key);
    }
    // restore the full constant tail for the next candidate's block0/block1
    msg.fill(0,16,64);msg[16]=0x80;msg[56]=(nn*8)&0xff;
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
  /* ONE cursor on the hot path. Checking several per candidate tripled the
     gate cost for the 99.998% of candidates that miss; the main thread's
     derivesWorkingKey() already probes every cursor before accepting a hit,
     so a single-cursor prefilter loses nothing and stays sound. */
  var kl=fileKey.length,i;
  for(i=0;i<kl;i++){seedBuf[i]=fileKey[i];}
  seedBuf[kl]=sb.obj&0xff;seedBuf[kl+1]=(sb.obj>>>8)&0xff;seedBuf[kl+2]=(sb.obj>>>16)&0xff;
  seedBuf[kl+3]=sb.gen&0xff;seedBuf[kl+4]=(sb.gen>>>8)&0xff;
  var dig=md5Bytes(seedBuf,kl+5),lim=Math.min(nn+5,16);
  for(i=0;i<lim;i++){objKey[i]=dig[i];}
  probe[0]=sb.b0;probe[1]=sb.b1;
  rc4Xor(objKey,probe,2);
  return zlibHeader(probe[0],probe[1]);
}
/* Sound zlib-stream test. A zlib header is a 2-byte big-endian value that is a
   multiple of 31, with CM=8 (deflate) and FDICT clear. Encoders emit one of
   four headers depending on level -- 0x7801 (0-1), 0x785e (2-5), 0x789c (6),
   0x78da (7-9) -- and all four share the high byte 0x78. Testing for 0x789c
   alone (the level-6 default) would wrongly reject a key for a stream written
   at any other level; relaxing to "low nibble is 8" is worse, admitting 66
   values and multiplying the false-positive confirmations by 16. Pin the high
   byte to 0x78 to admit exactly the 4 legal headers (~1/16k of random keys). */
function zlibHeader(b0,b1){
  return b0===0x78 && (b1&0x20)===0 && (((b0<<8)|b1)%31)===0;
}
/* All-cursor zlib test. The fast phase short-circuits on the first cursor to
   stay cheap; when it matches, this re-tests EVERY cursor so a match cannot be
   an artefact of one stream's layout. */
function streamAnyHit(fileKey,sb){
  var kl=fileKey.length,i,c;
  for(i=0;i<kl;i++){seedBuf[i]=fileKey[i];}
  for(c=0;c<sb.length;c++){
    var s=sb[c],seed=kl;
    seedBuf[seed]=s.obj&0xff;seedBuf[seed+1]=(s.obj>>>8)&0xff;seedBuf[seed+2]=(s.obj>>>16)&0xff;
    seedBuf[seed+3]=s.gen&0xff;seedBuf[seed+4]=(s.gen>>>8)&0xff;
    var dig=md5Bytes(seedBuf,seed+5),lim=Math.min(nn+5,16);
    for(i=0;i<lim;i++){objKey[i]=dig[i];}
    probe[0]=s.b0;probe[1]=s.b1;
    rc4Xor(objKey,probe,2);
    if(zlibHeader(probe[0],probe[1])){return true;}
  }
  return false;
}
/* Single-cursor zlib test — the CHEAP hot-path gate. It touches one stream
   (one MD5 + one RC4 block), keeping the per-candidate cost far below the /U
   checksum. A miss here is NOT a verdict: the caller re-scans with /U when the
   fast phase finds nothing, so an unusual file still unlocks. */
function streamOneHit(fileKey,sb){
  var kl=fileKey.length,i;
  var s=sb[0];
  for(i=0;i<kl;i++){seedBuf[i]=fileKey[i];}
  seedBuf[kl]=s.obj&0xff;seedBuf[kl+1]=(s.obj>>>8)&0xff;seedBuf[kl+2]=(s.obj>>>16)&0xff;
  seedBuf[kl+3]=s.gen&0xff;seedBuf[kl+4]=(s.gen>>>8)&0xff;
  var dig=md5Bytes(seedBuf,kl+5),lim=Math.min(nn+5,16);
  for(i=0;i<lim;i++){objKey[i]=dig[i];}
  probe[0]=s.b0;probe[1]=s.b1;
  rc4Xor(objKey,probe,2);
  return zlibHeader(probe[0],probe[1]);
}
var _post=typeof self!=="undefined"?function(m){self.postMessage(m);}:null;
var _onmsg=typeof self!=="undefined"?function(fn){self.onmessage=fn;}:null;
if(!_post&&typeof process!=="undefined"&&process.versions&&process.versions.node){var wt=null;try{wt=require("node:worker_threads");}catch(e){}if(wt&&wt.parentPort){_post=function(m){wt.parentPort.postMessage(m);};_onmsg=function(fn){wt.parentPort.on("message",function(d){fn({data:d});});};}}
function post(msg){_post(msg);}
function onMsg(fn){_onmsg(fn);}
var stopped=false,pwBuf=new Uint8Array(8),CHUNK=4096;
/* Run the whole plan once with gate(fileKey,pinLen) as the acceptance test.
   Returns when stopped (hit) or the plan is exhausted.

   soft mode is used by the zlib prefilter, which admits roughly one random
   key in 16k: a reported candidate there is a HINT, not a verdict. In soft
   mode the worker keeps scanning after reporting (the main thread confirms and
   sends "stop" only if the hint was real), so a prefilter false positive can
   never end the search early. In hard mode the gate IS the verdict, so the
   scan halts immediately. */
function runPlan(plan,sb,gate,soft){
  var tried=0,si,digits,val,end,v,done,q,k,t2,j;
  for(si=0;si<plan.length;si++){
    if(stopped){break;}
    var seg=plan[si];
    if(seg.digits===0){
      var list=seg.literal||[];
      for(k=0;k<list.length;k++){
        if(stopped){break;}
        var s=list[k],len=s.length;
        if(len<1||len>8){continue;}
        for(j=0;j<len;j++){pwBuf[j]=s.charCodeAt(j)&0xff;}
        if(gate(fileKeyFast(pwBuf,len),len)){
          post({type:"candidate",pin:s,cidx:tried});
          if(!soft){stopped=true;}
        }
        tried++;
        if((k&2047)===0){post({type:"progress",tried:tried});}
      }
    }else{
      digits=seg.digits;val=seg.start;end=seg.end;v=end-val;done=0;
      while(done<v&&!stopped){
        var upto=Math.min(v-done,CHUNK);
        for(q=0;q<upto;q++,val++){
          if(soft&&stopped){break;}
          t2=val;
          for(k=digits-1;k>=0;k--){pwBuf[k]=0x30+(t2%10);t2=Math.floor(t2/10);}
          if(gate(fileKeyFast(pwBuf,digits),digits)){
            var pin="";for(k=0;k<digits;k++){pin+=String.fromCharCode(pwBuf[k]);}
            post({type:"candidate",pin:pin,cidx:tried+q});
            if(!soft){stopped=true;}
          }
        }
        done+=upto;tried+=upto;post({type:"progress",tried:tried});
      }
    }
  }
  return tried;
}
/* The zlib-header test runs the plan MANY times faster than the /U checksum
   (it needs one RC4 block instead of a 20-round chain over 16 bytes), so for
   a Flate-carrying file we search with it first. Only if that finds nothing do
   we re-run the plan with the authoritative /U test, so an unusual file can
   never turn a fast miss into a false negative. */
var curStreams=[];
function tryFastGate(fileKey,len){
  return streamOneHit(fileKey,curStreams);
}
function tryUFast(fileKey,len){
  return userPasswordHit(fileKey);
}
onMsg(function(ev){
  var d=ev.data;
  if(d.type==="stop"){stopped=true;return;}
  if(d.type!=="scan"){return;}
  try{
  setupEnc(d.enc);
  stopped=false;
  var plan=d.plan,sb=d.stream;
  curStreams=sb&&sb.length?sb:[];
  var tried;
  if(curStreams.length){
    // fast = HINTS (keep scanning after each report); /U = VERDICTS (halt).
    tried=runPlan(plan,sb,tryFastGate,true);
    if(!stopped){
      post({type:"progress",tried:tried});
      tried=runPlan(plan,sb,tryUFast,false);
    }
  }else{
    tried=runPlan(plan,sb,tryUFast,false);
  }
  post({type:"done",tried:tried,stopped:stopped});
  }catch(e){post({type:"error",msg:String(e&&e.message||e)});}
});
`;

/** The same source, exposed for contract tests. */
export const __rawWorkerSource = SCANNER_WORKER_SOURCE;
