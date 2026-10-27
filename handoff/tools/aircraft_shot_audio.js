// Presentation only. MK 214 A uses the EXISTING 50 mm KwK39 game cue as an
// explicitly declared substitute, not an authenticated MK214 firing recording.
// Embedded source: OPEX tanks_weapons.bank, 50mm_kwk39, FSB0#997.
function createAircraftShotAudio(sound, {audible = () => true, now = () => performance.now(),
  schedule = fn => setTimeout(fn, 20), random = Math.random} = {}) {
  const substitute = Object.freeze({mk214a: Object.freeze({cue: 'report_kwk39_50',
    source: 'OPEX tanks_weapons.bank event:/ground/weapon/cannons/50mm_kwk39 FSB0#997',
    recordingIdentity: 'KwK39 50 mm game cue; substitute for MK214A, not MK214A recording'})});
  const gains = {mg:.85,cannon:.95,m2:.8,m3:.8,mg131:.85,hispano:.95,nr23:.95,n37:1,
    nr30:1,type97:.85,ubs:.8,type99:.95,shvak:.95,mk108:1,mk214a:1,aden:1};
  const pending = new Map();
  const stats = {played:0,queued:0,expired:0,suppressed:0};
  let timer = false;
  const permitted = () => audible() && !sound.muted;
  function prepare(kind) {
    const full = sound.full, alias = substitute[kind];
    if (!full) return;
    if (alias) { if (full.bank?.cues?.[alias.cue]) full.request(alias.cue, true); return; }
    for (let k=1;k<=4;k++) if(full.bank?.cues?.[`air_${kind}_shot_${k}`]) full.request(`air_${kind}_shot_${k}`,true);
  }
  function arm() { if(!timer && pending.size) {timer=true;schedule(drain);} }
  function drain() {
    timer=false;const at=now();
    for (const [key,p] of pending) {
      if(at-p.created>250) {pending.delete(key);stats.expired++;continue;}
      if(!permitted() || sound.full!==p.full) {pending.delete(key);stats.suppressed++;continue;}
      p.full.request(p.id,true);
      if(!p.full.active || !sound.ctx || sound.ctx.state!=='running' || !sound.master ||
          !p.full.buffers.has(p.id)) continue;
      // FullAudio.play is the real spatial player. A ready-but-rejected voice
      // (distance/budget) is intentionally dropped, never retried as a burst.
      if(p.full.play(p.id,p.event)) stats.played++;
      pending.delete(key);
    }
    arm();
  }
  function play(kind,n,position,velocity,time,emitterId='player:air') {
    const full=sound.full, alias=substitute[kind];
    const id=alias?.cue || `air_${kind}_shot_${1+(n*7+Math.floor(random()*4))%4}`;
    if(!full?.bank?.cues?.[id]) return false;
    const event={position,velocity,time,emitterId,gain:gains[kind]??.9,
      rate:alias?1:.96+random()*.08};
    // Preserve the existing four-variant aircraft reports. The bounded cold
    // decode/resume queue is only for this newly supported 50 mm substitute.
    if(!alias) {full.play(id,event);return true;}
    if(!permitted()) {stats.suppressed++;return true;}
    const key=`${emitterId}:${String(n)}`;
    if(pending.has(key)) return true;
    prepare(kind);
    if(full.active && sound.ctx?.state==='running' && sound.master && full.buffers.has(id)) {
      if(full.play(id,event))stats.played++;
      return true;
    }
    if(pending.size>=16){pending.delete(pending.keys().next().value);stats.expired++;}
    pending.set(key,{full,id,event,created:now()});stats.queued++;arm();return true;
  }
  function clear() {pending.clear();}
  return {prepare,play,clear,stats,substitute};
}

// A window CAPTURE listener precedes the frontline's document capture handler,
// which deliberately stops input propagation. No network callback tries to
// resume/create an AudioContext without a user gesture.
function installAircraftAudioGestures(sound,target,shouldUnlock) {
  const unlock=e=>{if(shouldUnlock(e))sound.start();};
  target.addEventListener('pointerdown',unlock,true);
  target.addEventListener('keydown',unlock,true);
  return ()=>{target.removeEventListener('pointerdown',unlock,true);target.removeEventListener('keydown',unlock,true);};
}
