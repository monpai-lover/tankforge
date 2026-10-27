// User report: the Pantsir-S1's guns fire without a sound. The player's Pantsir on the range: the
// trigger held 1 s, then released; the sounds started (the 2A38's onset, its fire loop, its tail) and
// whether the loop stopped.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const frames=(n)=>new Promise(r=>{let k=0;const f=()=>++k>=n?r():requestAnimationFrame(f);requestAnimationFrame(f);});
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
await tf.coreReady();tf.finishThumbs();
const S=tf.sound,started=[];
const nameOf=(buf)=>{for(const [k,v] of S.full?.buffers||[])if(v===buf)return k;return 'other';};
const bs=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...a){started.push(nameOf(this.buffer));return bs.apply(this,a);};
tf.select('ad_pantsir');tf.startBattle();await frames(3);S.start();tf.pause(true);S.setFullAudible=()=>S.full?.suspend(false);S.full?.suspend(false);
for(const c of ['ad_2a38_onset','ad_2a38_loop','ad_2a38_tail'])S.full.request?.(c);
await wait(3000);tf.advance(0.3,[],false);started.length=0;
out.cuesInData=['ad_2a38_onset','ad_2a38_loop','ad_2a38_tail'].map(c=>!!S.full?.bank?.cues?.[c]);
const r0=G.pad?.gunRounds;G.mgHeld=true;for(let k=0;k<60;k++){tf.advance(1/60,[],k%10===0);await wait(16);}
out.firing={rounds:r0-(G.pad?.gunRounds??0),loopsNow:[...S.full.loops.keys()].filter(k=>/2a38/.test(k))};
G.mgHeld=false;for(let k=0;k<30;k++){tf.advance(1/60,[],false);await wait(16);}
out.after={loopsNow:[...S.full.loops.keys()].filter(k=>/2a38/.test(k))};
const c={};for(const s of started)c[s]=(c[s]||0)+1;out.started=c;
return out;
