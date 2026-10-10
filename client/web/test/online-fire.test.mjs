import test from 'node:test';
import assert from 'node:assert/strict';
import { newLoading } from '../src/sim/loading.js';
const module = await import('../src/game/onlineFire.js').catch(() => null);
function fixture() {
  assert.ok(module?.OnlineFires, 'the predicted cannon refund owner must be available');
  const fires = new module.OnlineFires();
  const gun = { ammo: [{count: 0,max: 2}, {count: 2,max: 2}], loaded: -1, selected: 0 };
  const loading = newLoading(1,1); loading.state[0] = 'empty';
  const session = {}; const shot = {seq: 1};
  const request = {seq:1, gun, ammo:gun.ammo[0], loading, gi:0, ti:0, session, shot};
  fires.begin(request,0);
  return {fires,gun,loading,session,shot};
}
test('a matching rejection refunds only the fired entry once and returns its projectile', () => {
  const {fires,gun,loading,session,shot} = fixture();
  const rejected = fires.reject(1,gun,session,1);
  assert.equal(rejected.shot,shot); assert.equal(gun.ammo[0].count,1);
  assert.equal(gun.ammo[1].count,2); assert.equal(loading.state[0],'waiting');
  assert.equal(fires.reject(1,gun,session,1),null); assert.equal(gun.ammo[0].count,1);
});
test('reselection and a later reload are preserved while the old fired entry is refunded', () => {
  const {fires,gun,loading,session} = fixture();
  gun.selected=1;gun.loaded=1;loading.state[0]='loading';loading.loaders[0]={gun:0,remaining:3,total:5};
  fires.reject(1,gun,session,1);
  assert.equal(gun.ammo[0].count,1);assert.equal(gun.selected,1);assert.equal(gun.loaded,1);
  assert.deepEqual(loading.loaders[0],{gun:0,remaining:3,total:5});assert.equal(loading.state[0],'loading');
});
test('stale session, replaced mount and replaced ammo entries never refund', () => {
  for (const variant of ['session','gun','ammo']) {
    const {fires,gun,session} = fixture();
    if (variant==='ammo') gun.ammo[0]={count:0,max:2};
    assert.equal(fires.reject(1,variant==='gun'?{}:gun,variant==='session'?{}:session,1),null);
    assert.equal(gun.ammo[0].count,0);assert.equal(fires.pending.length,0);
  }
});
test('accepted, expired and bounded retired requests cannot be refunded by delayed replies', () => {
  const {fires,gun,session} = fixture();
  assert.ok(fires.confirm(1,gun,session,1));
  assert.equal(fires.reject(1,gun,session,1),null);
  const req={seq:2,gun,ammo:gun.ammo[0],loading:newLoading(1,1),gi:0,session};
  fires.begin(req,2);fires.retire(100);
  assert.equal(fires.reject(2,gun,session,101),null);assert.equal(gun.ammo[0].count,0);
  for(let seq=3;seq<2200;seq++) fires.begin({...req,seq},100);
  assert.ok(fires.pending.length<=1024);
  assert.equal(fires.reject(3,gun,session,101),null);assert.equal(gun.ammo[0].count,0);
  fires.clear();assert.equal(fires.pending.length,0);
});

import fs from 'node:fs';
import { NetClient } from '../src/game/net.js';
const main = fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
test('live protocol reply handlers remove only the rejected projectile and notify once', () => {
  const {fires,gun,loading,session,shot} = fixture();
  // Replies use real receipt time, unlike the synthetic zero-time owner tests above.
  fires.pending[0].at=performance.now()/1000;
  const net = new NetClient(); const notices=[];
  const otherShot={seq:2}; const G={online:session,loadout:{turrets:[{guns:[gun]}]},shots:[shot,otherShot]};
  const a=main.indexOf('  const currentFireGun =');
  const b=main.indexOf('  G.pendingLaunch =',a);
  assert.ok(a>=0&&b>a,'main must wire both authoritative cannon replies');
  new Function('net','onlineFires','G','hud',main.slice(a,b))(net,fires,G,{toast:msg=>notices.push(msg)});
  net._receive({t:'fire_rejected',seq:1,reason:'weapon_disabled'});
  assert.equal(gun.ammo[0].count,1);assert.deepEqual(G.shots,[otherShot]);assert.equal(notices.length,1);
  net._receive({t:'fire_rejected',seq:1});assert.equal(notices.length,1);assert.equal(gun.ammo[0].count,1);
  fires.begin({seq:2,gun,ammo:gun.ammo[0],session,loading,gi:0,ti:0,shot:otherShot},performance.now()/1000);
  net._receive({t:'fire_accepted',seq:2});
  net._receive({t:'fire_rejected',seq:2});
  assert.equal(gun.ammo[0].count,1);assert.deepEqual(G.shots,[otherShot]);assert.equal(notices.length,1);
});
