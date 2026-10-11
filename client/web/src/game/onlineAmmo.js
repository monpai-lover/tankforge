import policy from '../../../../config/ammo-resupply.json' with { type: 'json' };
import { applyAmmoCounts } from './ammoInventory.js';
import { applyAmmo } from './deploy.js';

export const AMMO_PROTOCOL_VERSION = policy.ammo_protocol_version;
if (AMMO_PROTOCOL_VERSION !== 1) throw new Error('Unsupported ammunition protocol');
const safe = n => Number.isSafeInteger(n) && n >= 0;
const counter = n => safe(n) && n > 0;
const sequence = n => safe(n) && n <= 0xffffffff;
const clone = mix => Object.fromEntries(Object.entries(mix).map(([key, values]) => [key, values.slice()]));
const same = (a, b) => a.battle === b.battle && a.life === b.life;
const stale = (a, b) => a.battle < b.battle || (a.battle === b.battle && a.life < b.life);

/** Absolute confirmed stock plus only cannon predictions beyond server coverage. */
export class OnlineAmmo {
  constructor() { this.clear(); }
  clear() { this._scope=null; this._mounts=[]; this._targets=null; this._base=null; this._projected=null; this._revision=0; this._through=0; this._lastSeq=0; this._pending=new Map(); this._lo=null; this._loadings=null; }
  scope() { return this._scope ? {...this._scope} : null; }
  counts() { return this._projected ? clone(this._projected) : null; }
  get processedThrough() { return this._through; }
  bindLoadings(loadings) { this._loadings=loadings; }

  _validate(frame, mounts, immutable=null, loadout=null) {
    if (!frame || frame.t !== 'ammo' || frame.ammo_protocol_version !== AMMO_PROTOCOL_VERSION || !counter(frame.battle) || !counter(frame.life)
      || !counter(frame.revision) || !sequence(frame.processed_through) || typeof frame.refilled !== 'boolean'
      || !Number.isFinite(frame.resupply_progress) || frame.resupply_progress < 0 || frame.resupply_progress > 1) throw new Error('Invalid authoritative ammunition frame');
    for (const field of ['counts','targets']) {
      const mix=frame[field];
      if (!mix || typeof mix !== 'object' || Array.isArray(mix) || Object.keys(mix).length !== mounts.length) throw new Error('Incomplete authoritative ammunition inventory');
      for (const {key,g,ti,gi,ammo,entries,capacity} of mounts) {
        const values=mix[key];
        if (!Object.hasOwn(mix,key) || !Array.isArray(values) || values.length !== ammo.length) throw new Error(`Invalid authoritative ammunition vector ${key}`);
        let total=0;
        for(let i=0;i<values.length;i++) {if(!safe(values[i])) throw new Error(`Invalid authoritative ammunition count ${key}`);total+=values[i];}
        if(!safe(total) || total>capacity) throw new Error(`Authoritative ammunition exceeds capacity ${key}`);
        if((loadout && loadout.turrets[ti]?.guns[gi]!==g) || g.ammo.length!==ammo.length || g.ammo.some((a,i)=>a!==entries[i] || a.shell.id!==ammo[i])) throw new Error('Mounted ammunition identity changed');
        if(field==='targets' && immutable && values.some((n,i)=>n!==immutable[key][i])) throw new Error('Authoritative ammunition targets changed within a life');
      }
    }
    for(const {key}of mounts) if(frame.counts[key].some((n,i)=>n>frame.targets[key][i])) throw new Error('Authoritative ammunition exceeds selected targets');
  }
  begin(frame, loadout, loadings) {
    if(this._scope && counter(frame?.battle) && counter(frame?.life) && stale(frame,this._scope)) return false;
    if(this._scope && same(frame,this._scope)) {if(loadout!==this._lo)throw new Error('Mounted inventory replaced within the same life');return this.receive(frame);}
    const mounts=loadout.turrets.flatMap((t,ti)=>t.guns.map((g,gi)=>({key:`gun:${ti}:${gi}`,g,ti,gi,ammo:g.ammo.map(a=>a.shell.id),entries:g.ammo.slice(),capacity:g.capacity??g.ammo.reduce((n,a)=>n+a.max,0)})));
    if(mounts.some(m=>!safe(m.capacity))) throw new Error('Invalid trusted ammunition capacity');
    this._validate(frame,mounts,null,loadout);
    // Apply only after every mount and wire field validates.
    const fitted=Object.fromEntries(mounts.map(({key,ti,gi})=>[`${ti}.${gi}`,frame.counts[key]]));
    applyAmmo(loadout,{[loadout.id]:fitted});
    for (const {key,g} of mounts) g.ammo.forEach((a,i)=>{a.max=frame.targets[key][i];});
    for (const {g,ti,gi} of mounts) if(loadings?.[ti]) loadings[ti].state[gi]=g.loaded<0?'empty':'ready';
    this.clear();this._scope={battle:frame.battle,life:frame.life};this._mounts=mounts;this._targets=clone(frame.targets);this._base=clone(frame.counts);this._projected=clone(frame.counts);
    this._revision=frame.revision;this._through=frame.processed_through;this._lastSeq=this._through;this._lo=loadout;this._loadings=loadings;
    return true;
  }
  predictCannon(seq, instance, ammoId) {
    if(!this._scope) return false;
    if(!sequence(seq) || seq===0) throw new Error('Invalid ammunition discharge sequence');
    if(seq<=this._lastSeq || seq<=this._through) return false;
    const mount=this._mounts.find(m=>m.key===instance), index=mount?.ammo.indexOf(ammoId);
    if(!mount || index<0) throw new Error('Unknown mounted ammunition prediction');
    if(this._projected[instance][index]<=0) return false;
    this._pending.set(seq,{instance,index});this._lastSeq=seq;this._apply();return true;
  }
  receive(frame) {
    if(!this._scope) return false;
    // Valid old scopes cannot replace this life. Malformed current frames fail closed.
    if(counter(frame?.battle)&&counter(frame?.life)&&!same(frame,this._scope)) return false;
    if(counter(frame?.revision)&&frame.revision<=this._revision) return false;
    this._validate(frame,this._mounts,this._targets,this._lo);
    if(frame.processed_through<this._through) throw new Error('Authoritative ammunition coverage moved backwards');
    const base=clone(frame.counts), pending=new Map([...this._pending].filter(([seq])=>seq>frame.processed_through));
    const projected=this._overlay(base,pending);
    applyAmmoCounts(this._lo,projected,this._loadings);
    this._base=base;this._pending=pending;this._projected=projected;this._revision=frame.revision;this._through=frame.processed_through;this._lastSeq=Math.max(this._lastSeq,this._through);
    return true;
  }
  _overlay(base,pending) {
    const counts=clone(base);
    for(const {instance,index}of pending.values()) counts[instance][index]=Math.max(0,counts[instance][index]-1);
    return counts;
  }
  _apply() {const counts=this._overlay(this._base,this._pending);applyAmmoCounts(this._lo,counts,this._loadings);this._projected=counts;}
}
