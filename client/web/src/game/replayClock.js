// V3 director port, Copyright (c) 2026 Replay Lab Contributors (MIT).
// Complete source notice: docs/third-party/hit-replay-v3-LICENSE.txt.
// Component only: no authority, health, life or playback-session owner lives here.
const mix = (a,b,t) => a+(b-a)*t;
const freezeKnots = knots => Object.freeze(knots.map(p=>Object.freeze(p.slice())));
export const directorKnots = freezeKnots([[0,0],[1.00,1.15],[1.8,1.65],[2.35,1.83],[3.6,2.48],[5.2,3.4],[7.0,4.8],[9.6,7.4]]);

function validTime(time) { return Number.isFinite(time) && Math.abs(time) <= Number.MAX_SAFE_INTEGER; }
function checkKnots(knots) {
  if(!Array.isArray(knots)||!knots.length)throw new RangeError('replay knots must have finite, strictly increasing axes');
  // Indexed reads visit sparse outer entries and both coordinates of every pair.
  for(let i=0;i<knots.length;i++){
    const p=knots[i];
    if(!Array.isArray(p)||p.length!==2||!validTime(p[0])||!validTime(p[1])||p[0]<0||p[1]<0
      || (i&&(p[0]<=knots[i-1][0]||p[1]<=knots[i-1][1])))throw new RangeError('replay knots must have finite, strictly increasing axes');
  }
}

/** V3 runtime.js:56. The selected axis replaces its captured directorKnots. */
export function transfer(knots, x, reverse=false) {
  checkKnots(knots);
  if (!validTime(x)) throw new RangeError('replay time must be finite');
  const axis=reverse?1:0, value=reverse?0:1;
  if(x<=knots[0][axis])return knots[0][value];
  for(let i=1;i<knots.length;i++)if(x<=knots[i][axis])return mix(knots[i-1][value],knots[i][value],(x-knots[i-1][axis])/(knots[i][axis]-knots[i-1][axis]));
  return knots.at(-1)[value]+x-knots.at(-1)[axis];
}

/** Append-only film→physical map. Published knot snapshots are deeply immutable. */
export function createReplayClock(knots=directorKnots) {
  checkKnots(knots);
  if(knots[0][0]!==0)throw new RangeError('replay knots must start at film zero');
  let retained=freezeKnots(knots), played=0;
  const protectedTails=[];
  const frozenTransfer=(time,reverse=false)=>{
    const axis=reverse?'physicalEnd':'filmEnd';
    const prefix=protectedTails.find(p=>time<=p[axis]);
    return transfer(prefix?prefix.knots:retained,time,reverse);
  };
  return Object.freeze({
    get knots(){return retained;},
    markPlayed(filmS){
      if(!validTime(filmS) || filmS<0)throw new RangeError('played time must be nonnegative and finite');
      if(filmS<played)throw new RangeError('played cursor cannot rewind');
      played=filmS;
    },
    appendPhysicalAnchors(times){
      if(!Array.isArray(times))throw new RangeError('anchor time must be nonnegative and finite');
      for(let i=0;i<times.length;i++)if(!validTime(times[i])||times[i]<0)throw new RangeError('anchor time must be nonnegative and finite');
      const last=retained.at(-1), boundary=Math.max(last[1],frozenTransfer(played));
      const future=[...new Set(times.filter(t=>t>boundary))].sort((a,b)=>a-b);
      if(!future.length)return 0;
      const next=retained.map(p=>p.slice());
      if(played>last[0])next.push([played,boundary]);
      for(const time of future){const prior=next.at(-1);next.push([prior[0]+(time-prior[1]),time]);}
      checkKnots(next);
      // Keep the precise source expression for already-played extrapolation. Inserting
      // a mathematically collinear knot can otherwise change floating-point rounding.
      if(played>last[0])protectedTails.push({knots:retained,filmEnd:played,physicalEnd:boundary});
      retained=freezeKnots(next);
      return future.length;
    },
    physicalAt(filmS){return frozenTransfer(filmS);},
    filmAt(physicalS){return frozenTransfer(physicalS,true);},
  });
}

// phase_s is ONLY a canonical V3 easing coordinate. time_s is recorded physical truth.
// The eventual evidence adapter maps launch_time_s/impact_time_s once to launch_s/contact_s.
function eventAnchors(event) {
  if(!event || !validTime(event.launch_s) || event.launch_s<0 || !validTime(event.contact_s) || event.contact_s<event.launch_s)throw new RangeError('PreparedEvent launch/contact anchors are invalid');
  const anchors=[[0,event.launch_s],[1.65,event.contact_s]];
  const mechanisms=event.mechanism_anchors??[];
  if(!Array.isArray(mechanisms))throw new RangeError('PreparedEvent mechanism anchors are invalid');
  for(const anchor of mechanisms){
    const prior=anchors.at(-1);
    if(!anchor || !validTime(anchor.time_s) || anchor.time_s<prior[1] || !validTime(anchor.phase_s) || anchor.phase_s<=prior[0] || anchor.phase_s>directorKnots.at(-1)[1])throw new RangeError('PreparedEvent mechanism anchors must be ordered, recorded and bounded');
    anchors.push([anchor.phase_s,anchor.time_s]);
  }
  // Simultaneous stages have one physical anchor, with the latest source easing phase.
  const unique=[];
  for(const anchor of anchors){if(unique.length && unique.at(-1)[1]===anchor[1])unique[unique.length-1]=anchor;else unique.push(anchor);}
  return unique;
}

/** Source camera phase is interpolated between real records and clamps at the last known one. */
export function replayDirectorPhase(preparedEvent, physicalS) {
  if(!validTime(physicalS))throw new RangeError('replay time must be finite');
  const anchors=eventAnchors(preparedEvent);
  return physicalS>=anchors.at(-1)[1]?anchors.at(-1)[0]:transfer(anchors,physicalS,true);
}

/** Retain the entire source film profile through the known event anchors only. */
export function createReplayClockForEvent(preparedEvent) {
  const anchors=eventAnchors(preparedEvent), first=anchors[0][0], end=anchors.at(-1)[0];
  const phases=[...anchors.map(k=>k[0]),...directorKnots.map(k=>k[1]).filter(p=>p>first&&p<end)].sort((a,b)=>a-b);
  const originFilm=transfer(directorKnots,first,true), knots=[];
  for(const phase of new Set(phases)){
    const physical=transfer(anchors,phase), film=transfer(directorKnots,phase,true)-originFilm;
    if(!knots.length || physical>knots.at(-1)[1])knots.push([film,physical]);
  }
  return createReplayClock(knots);
}
