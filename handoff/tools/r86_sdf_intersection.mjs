// Original, bounded CPU diagnostic for a caller-supplied signed-distance field.
// Not imported by the game, collision, vehicle hitboxes, shaders or frame loop.
const vector3=v=>(Array.isArray(v)||ArrayBuffer.isView(v))&&v.length===3&&[0,1,2].every(k=>Number.isFinite(v[k]));

/**
 * Trace the normalized ray over inclusive [near, far]. Defaults are a diagnostic
 * example, not a universal camera clip choice. `epsilon` is a field-residual
 * tolerance; it is a geometric distance only for an actual signed-distance field.
 * A supplied Lipschitz upper bound scales forward steps conservatively. An
 * underestimated bound or arbitrary warped field cannot guarantee no skipping.
 * `steps` counts field evaluations. Misses always have point:null. Callback
 * exceptions propagate; nonfinite callback results produce an explicit miss.
 */
export function marchSdf(field,origin,direction,{near=1,far=100,epsilon=.01,maxSteps=128,safety=.9,lipschitz=1}={}){
  if(typeof field!=='function')throw new TypeError('SDF field callback required');
  if(!vector3(origin)||!vector3(direction))throw new TypeError('Finite three-component ray vectors required');
  const scale=Math.max(...Array.from(direction,Math.abs));
  if(!(scale>0))throw new RangeError('Finite nonzero ray direction required');
  // Scaling first avoids underflow/overflow while keeping physical ray distance.
  const scaled=Array.from(direction,v=>v/scale),norm=Math.hypot(...scaled);
  if(!Number.isFinite(near)||near<0)throw new RangeError('near must be finite and nonnegative');
  if(!Number.isFinite(far)||far<near)throw new RangeError('far must be finite and at least near');
  if(!Number.isFinite(epsilon)||epsilon<=0)throw new RangeError('epsilon must be finite and positive');
  if(!Number.isFinite(safety)||safety<=0||safety>1)throw new RangeError('safety must be in (0,1]');
  if(!Number.isFinite(lipschitz)||lipschitz<=0)throw new RangeError('lipschitz must be finite and positive');
  if(!Number.isSafeInteger(maxSteps)||maxSteps<1||maxSteps>65536)throw new RangeError('maxSteps must be an integer in [1,65536]');
  const ray=scaled.map(v=>v/norm);
  let t=near,startedInside=false;
  const miss=(reason,steps,distance=null)=>({hit:false,reason,t,point:null,distance,steps,startedInside});
  for(let i=0;i<maxSteps;i++){
    const point=Array.from(origin,(v,k)=>v+ray[k]*t);
    if(!point.every(Number.isFinite))return miss('non_finite_position',i);
    const distance=field(point),steps=i+1;
    if(!Number.isFinite(distance))return miss('non_finite_distance',steps);
    if(i===0)startedInside=distance<0;
    if(Math.abs(distance)<=epsilon)return {hit:true,reason:'hit',t,point,distance,steps,startedInside};
    if(t>=far)return miss('far',steps,distance);
    if(steps===maxSteps)return miss('step_limit',steps,distance);
    // Absolute residual advances toward the forward exit when starting inside.
    // Clipping before addition also bounds overflow for very large finite fields.
    const next=t+Math.min(Math.abs(distance)/lipschitz*safety,far-t);
    if(!(next>t))return miss('stalled',steps,distance);
    t=next;
  }
}
