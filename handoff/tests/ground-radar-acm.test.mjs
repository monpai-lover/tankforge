import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

// Executes the delivered sensor functions and actual keyboard/mouse listeners.
// Override only for the separately patched, verified public f3 app candidate.
const source = fs.readFileSync(process.env.TF_GROUND_RADAR_APP || new URL('../bundle/app.js.html', import.meta.url), 'utf8');
const cut = (a, b) => {
  const i = source.indexOf(a), j = source.indexOf(b, i);
  assert.ok(i >= 0 && j > i, a);
  return source.slice(i, j);
};
class Target {
  handlers = {};
  addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
  emit(type, props = {}) {
    const e = { code: '', button: 0, target: { tagName: 'CANVAS' }, repeat: false,
      preventDefault() { this.prevented = true; }, ...props };
    for (const fn of this.handlers[type] || []) fn(e);
    return e;
  }
}
function setup(role = 'gepard') {
  const window = new Target(), canvas = new Target(), document = { hidden: false, body: { dataset: {} } };
  const G4 = { time: 0, mode: 'battle', thumbs: [], keys: new Set(), caps: {}, T: [{ yaw: 0, guns: [] }],
    s: { heading: 0, x: 0, z: 0 }, aim: { yaw: 0, pitch: 0 }, cam: { yaw: 0, pitch: 0 },
    veh: { body: { origin: () => [0, 0, 0] } },
    loadout: { turrets: [{ guns: [] }] }, airKeys: { radarDogfight: 'Space+KeyR' } };
  const bots = { list: [], chaff: [], flares: [], seq: 0 }, ordnance = [], actions = [];
  let visible = true;
  const ui = () => ({ hidden: true });
  const c = vm.createContext({ window, canvas, document, G4, airBots: bots, airOrdnance: ordnance,
    HTMLButtonElement: class {}, chatIn: ui(), hangar: ui(), armEd: ui(), keyEd: ui(), deploy: { visible: false }, hitcam: {},
    L10N: (_, en) => en, airLos: () => visible, playerJam: () => null, daylight: () => true,
    seekerTone() {}, sound: {}, fx: { explosion() {} }, airDown: () => false,
    ownGunsLead() {}, gunsOnLead() {}, airAction: name => actions.push(name), airActionUp() {},
    AIR_STORE_DEFS: { m57e6: { name: '57E6', guidance: 'command', lockRange: 18000, minRange: 1500 } },
    seekerOf: () => ({ memory: .5 }), locked: () => true, lockable: () => false,
    ammoKeyIndex: () => -1,
  });
  vm.runInContext(`
    const D2R=Math.PI/180,FLIGHT_FIXED=1/120;
    const sub=(a,b)=>a.map((v,i)=>v-b[i]);
    const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
    const norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const angleOf=(a,b)=>Math.acos(Math.max(-1,Math.min(1,dot(norm(a),norm(b)))));
    const wrapPi=a=>((a+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
    const dirFrom2=(y,p)=>[Math.sin(y)*Math.cos(p),Math.sin(p),Math.cos(y)*Math.cos(p)];
    ${cut('    const RADAR_ACM = ', '    const RADAR_MODES = ')}
    ${cut('    const KEYMAP = ', '\n',)}
    ${cut('  var AIRCRAFT_KEYS = ', '\n')}
    ${cut('    const airKeyState = ', '    /** One action from a new key press')}
    ${cut('    const AD_GUNS = ', '    const adMat = ')}
    ${cut('    function adUnitOf(e) {', '    /** Back to the start')}
    ${cut('    const adHead = ', '    /**\n     * Alpha-beta')}
    ${cut('    function adObserve(', '    /**\n     * The guns\' aim')}
    ${cut('    function adSense(', '    /** A unit\'s radar radiating')}
    ${cut('    const adEst = ', '    /**\n     * Gun AA on')}
    ${cut('    function padSay(', '    /**\n     * The Pantsir-S1\'s 2A38M')}
    ${cut('    function stepPlayerAd(', '    /**\n     * A new lead solution')}
    ${cut('    function padLaunch(', '    /** The Pantsir\'s guns')}
    ${cut('    function missileGuide(', '    // ---- countermeasures:')}
    ${cut('    window.addEventListener("keydown", (e) => {\n      const tag2 = e.target.tagName;', '    function cancelPilotInput()')}
    ${cut('    canvas.addEventListener("mousedown", (e) => {\n      if (e.button === 1) e.preventDefault();', '    window.addEventListener("mouseup", (e) => {')}
    const cfg = ${role === 'gepard' ? '{...AD_GUNS.de_gepard,radar:true}' : role === 'pantsir' ? '{...AD_SAMS.pantsir,ownGuns:true,guns:null}' : `AD_SAMS.${role}`};
    const u={cfg,track:null,search:null,radarHp:100,sweep:0};
    const pe={alive:true,combatKey:'player:ad',box:{top:2},veh:{body:{origin:()=>[0,0,0]}},adState:u};
    const sam=cfg.missile?{rails:[{loaded:true,node:{visible:true}}],reserve:0}:null;
    G4.pad={cfg,u,pe,sam,def:AIR_STORE_DEFS[cfg.missile],role:${JSON.stringify(role)},contacts:[],acc:0,lock:null,seeker:'off',dir:[0,0,1],elev:0};
    globalThis.api={AD_GUNS,AD_SAMS,padRadarDogfight,padRadarKeyDown,padRadarContains,padRadarSense,adSense,adEst,padAction,stepPlayerAd,padLaunch,missileGuide};
  `, c);
  const head = [0, 2.8, 0];
  const target = (az = 0, el = 0, distance = 5000, friend = false) => {
    const y = az * Math.PI / 180, p = el * Math.PI / 180;
    const b = { friend, plane: { type: { name: 'enemy' }, position: head.map((v, k) => v + [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)][k] * distance), cur: new Float64Array(80) } };
    b.plane.cur[35] = 600; b.target = { bot: b }; return b;
  };
  const sense = time => { G4.time = time; c.api.stepPlayerAd(1 / 30); };
  const tap = (code, props = {}) => { window.emit('keydown', { code, ...props }); window.emit('keyup', { code, ...props }); };
  return { c, G4, bots, ordnance, window, canvas, document, actions, target, sense, tap, head, api: c.api,
    visible: value => visible = value };
}

test('actual ground key listeners keep Space braking, toggle once per press and preserve plain R', () => {
  const f = setup(), { G4, window, tap } = f, pad = G4.pad;
  const b = f.target(); f.bots.list = [b]; f.sense(0);
  tap('KeyR'); assert.equal(pad.lock, b); tap('KeyR'); assert.equal(pad.lock, null);
  window.emit('keydown', { code: 'Space' }); assert.equal(G4.keys.has('brake'), true);
  window.emit('keydown', { code: 'KeyR' }); assert.equal(pad.radarMode, 'acm');
  window.emit('keydown', { code: 'KeyR', repeat: true }); assert.equal(pad.radarMode, 'acm');
  window.emit('keyup', { code: 'KeyR' }); assert.equal(G4.keys.has('brake'), true);
  tap('KeyR'); assert.equal(pad.radarMode, 'search');
  window.emit('keyup', { code: 'Space' }); assert.equal(G4.keys.has('brake'), false);
});

test('custom keyboard and mouse bindings work without rewriting bindings or consuming ordinary R', () => {
  const f = setup(), { G4, tap, window, canvas } = f;
  G4.airKeys.radarDogfight = 'Ctrl+KeyU';
  tap('KeyU', { ctrlKey: true }); assert.equal(G4.pad.radarMode, 'acm');
  tap('KeyU', { ctrlKey: true }); assert.equal(G4.pad.radarMode, 'search');
  G4.airKeys.radarDogfight = 'Alt+Mouse2';
  canvas.emit('mousedown', { button: 2, altKey: true }); assert.equal(G4.pad.radarMode, 'acm');
  assert.equal(G4.rmb, undefined); assert.equal(G4.airKeys.radarDogfight, 'Alt+Mouse2');
  G4.airKeys.radarDogfight = 'Space+KeyR';
  for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA']) {
    window.emit('keydown', { code: 'KeyR', target: { tagName } }); assert.equal(G4.pad.radarMode, 'acm');
  }
  const e = window.emit('keydown', { code: 'KeyR', target: { tagName: 'DIV', isContentEditable: true } });
  assert.equal(G4.pad.radarMode, 'acm'); assert.equal(e.prevented, undefined);
  G4.pad.contacts = [{ b: f.target(), d: 5000 }]; G4.pad.lock = null;
  G4.keys.add('brake');
  window.emit('keydown', { code: 'KeyR', target: { tagName: 'DIV', isContentEditable: true } });
  assert.equal(G4.pad.lock, null, 'editing must not fall through into ordinary R locking');
});

test('focus input respects paused/menus/deployment/typing/online/dead contexts and never grants stock', () => {
  const f = setup('pantsir'), { c, G4, api } = f;
  G4.keys.add('brake');
  const event = { code:'KeyR',target:{tagName:'CANVAS'} };
  const blocked = [
    [G4,'paused',true], [G4,'online',{}], [G4.caps,'destroyed',true],
    [c.deploy,'visible',true], [c.chatIn,'hidden',false], [c.hangar,'hidden',false],
    [c.armEd,'hidden',false], [c.keyEd,'hidden',false], [f.document,'hidden',true],
  ];
  for (const [object,key,value] of blocked) {
    const before=object[key];object[key]=value;
    assert.equal(api.padRadarKeyDown(event),false,key);
    assert.equal(G4.pad.radarMode,undefined,key);object[key]=before;
  }
  const rails=G4.pad.sam.rails, rail=rails[0];
  api.padRadarDogfight();api.padRadarDogfight();
  assert.equal(G4.pad.sam.rails,rails);assert.equal(rail.loaded,true);assert.equal(rail.node.visible,true);
  G4.pad.u.radarHp=0;api.padRadarDogfight();assert.equal(G4.pad.radarMode,'search');
});

test('aircraft retain their existing Space chord path; ground focus cannot leak into flight', () => {
  const f = setup(), { G4, window } = f;
  G4.airKeys = { radarDogfight: 'Space+KeyR', radarLock: 'KeyR', space: 'Space' };
  G4.air = { active: true, plane: { keys: new Set() } };
  window.emit('keydown', { code: 'Space' }); window.emit('keydown', { code: 'KeyR' });
  window.emit('keyup', { code: 'KeyR' }); window.emit('keyup', { code: 'Space' });
  assert.deepEqual(f.actions, ['radarDogfight']); assert.equal(G4.keys.has('brake'), false);
  assert.equal(G4.pad.radarMode, undefined);
});

test('all existing radar definitions focus only actual contacts: azimuth/elevation/range/LOS/low/damage', () => {
  for (const role of ['gepard', 'pantsir', 'kubRadar']) {
    const f = setup(role), { G4, api, target } = f;
    api.padRadarDogfight();
    for (const [az, el, d, allowed] of [[4.9,4.9,9900,true],[-4.9,-4.9,4000,true],[5.1,0,1000,false],[0,5.1,1000,false],[180,0,1000,false],[0,0,10001,false]]) {
      f.bots.list = [target(az, el, d)]; G4.time += .11;
      api.padRadarSense(G4.pad, f.bots.list, f.head);
      assert.equal(G4.pad.contacts.length, Number(allowed), `${role} ${az},${el},${d}`);
    }
    f.bots.list = [target()]; f.visible(false); G4.time += .11;
    api.padRadarSense(G4.pad, f.bots.list, f.head); assert.equal(G4.pad.contacts.length, 0);
    f.visible(true); f.bots.list[0].plane.cur[35] = 1; G4.time += .11;
    api.padRadarSense(G4.pad, f.bots.list, f.head); assert.equal(G4.pad.contacts.length, 0);
    f.bots.list[0].plane.cur[35] = 600; G4.pad.u.radarHp = 0; G4.time += .11;
    api.padRadarSense(G4.pad, f.bots.list, f.head); assert.equal(G4.pad.contacts.length, 0);
  }
});

test('actual stepPlayerAd performs ten scans/second and acquires on 0.2s of observed revisits', () => {
  for (const role of ['gepard', 'pantsir']) {
    const f = setup(role), { G4 } = f, pad = G4.pad;
    f.api.padRadarDogfight();
    const friendly = f.target(0,0,2000,true), enemy = f.target(1,1,5000);
    f.bots.list = [friendly, enemy]; const scans = new Set();
    f.sense(0); assert.equal(pad.lock, enemy); assert.equal(pad.u.track, null);
    f.sense(.05); assert.equal(pad.radarScanAt, 0); assert.equal(pad.u.track, null);
    f.sense(.1); assert.equal(pad.u.track, null);
    f.sense(.2); assert.equal(pad.u.track?.radar, true);
    assert.equal(pad.u.track.seenAt, .2);
    for (let k=0;k<60;k++) { f.sense(1+k/60); scans.add(pad.radarScanAt); }
    assert.equal(scans.size,10); assert.equal(pad.lock,enemy);
  }
});

test('leaving the box cancels acquisition; a real tracking radar continues beyond the box then obeys memory', () => {
  const f = setup(), pad = f.G4.pad, b = f.target(); f.bots.list = [b]; f.api.padRadarDogfight();
  f.sense(0); f.sense(.1); b.plane.position = f.target(6).plane.position;
  f.sense(.2); assert.equal(pad.lock,null); assert.equal(pad.u.track,null); assert.equal(pad.u.acqAt,null);
  b.plane.position = f.target().plane.position;
  f.sense(.3); f.sense(.4); f.sense(.5); assert.equal(pad.u.track?.radar,true);
  b.plane.position = f.target(35).plane.position; f.sense(.6); assert.equal(pad.u.track?.radar,true);
  f.visible(false); f.sense(.7); assert.equal(pad.u.track?.radar,true);
  f.sense(2.2); assert.equal(pad.u.track,null);
});

test('focused search follows the aimed crosshair; restored search retains its original acquisition time', () => {
  const f=setup(),pad=f.G4.pad,b=f.target(90);f.bots.list=[b];f.api.padRadarDogfight();
  f.sense(0);assert.equal(pad.contacts.length,0);
  f.G4.aim.yaw=Math.PI/2;f.sense(.1);assert.equal(pad.lock,b);
  f.sense(.2);f.sense(.3);assert.equal(pad.u.track?.radar,true);
  f.api.padRadarDogfight();f.G4.aim.yaw=0;b.plane.position=f.target().plane.position;
  f.sense(.4);f.tap('KeyR');pad.u.sweep=-.01;
  f.sense(.5);assert.equal(pad.u.track,null);assert.equal(pad.u.acqAt,.5);
  f.sense(.7);assert.equal(pad.u.track,null,'normal search must not inherit focused .2s capture');
  f.sense(1.69);assert.equal(pad.u.track,null);
  f.sense(1.7);assert.equal(pad.u.track?.radar,true);
});

test('a missed focused revisit cannot count a stale search observation as continuous capture', () => {
  const f=setup(),pad=f.G4.pad;f.bots.list=[f.target()];f.api.padRadarDogfight();
  f.sense(0);f.sense(.5);assert.equal(pad.u.track,null);assert.equal(pad.u.acqAt,.5);
  f.sense(.6);assert.equal(pad.u.track,null);f.sense(.7);assert.equal(pad.u.track?.radar,true);
});

test('Pantsir auto-track feeds real launch inventory and existing command guidance, not a separate UI target', () => {
  const f = setup('pantsir'), pad = f.G4.pad; f.bots.list = [f.target()]; f.api.padRadarDogfight();
  f.sense(0); f.sense(.1); f.sense(.2); assert.equal(pad.u.track?.radar,true);
  f.api.padLaunch(pad,f.head); assert.equal(pad.sam.rails[0].loaded,false); assert.equal(pad.sam.rails[0].node.visible,false);
  assert.equal(f.ordnance.length,1); const o=f.ordnance[0];
  assert.equal(o.guide.phase,'command'); assert.equal(o.site,pad.pe); assert.equal(o.target,pad.lock.target);
  assert.ok(f.api.missileGuide(o)); assert.equal(o.guide.lastSeen,.2);
  f.api.padRadarDogfight(); f.G4.time=1; assert.equal(f.api.missileGuide(o),null); assert.equal(o.guide.phase,'lost');
});

test('IR/optical vehicles gain no radar; normal seeker R and all-round manual lock remain intact', () => {
  const ir = setup('chaparral'), pad=ir.G4.pad;
  ir.api.padRadarDogfight(); assert.equal(pad.radarMode,undefined); assert.match(pad.reason,/no radar/);
  ir.tap('KeyR'); assert.equal(pad.seeker,'search'); ir.tap('KeyR'); assert.equal(pad.seeker,'off');
  assert.equal(ir.api.AD_GUNS.de_flakpz38t.search,undefined); assert.equal(ir.api.AD_SAMS.kubLauncher.search,undefined);
  const f=setup(), side=f.target(80); f.bots.list=[side]; f.sense(0); assert.equal(f.G4.pad.lock,null);
  f.tap('KeyR'); assert.equal(f.G4.pad.lock,side);
  f.api.padRadarDogfight(); f.api.padRadarDogfight(); assert.equal(f.G4.pad.u.track,null);
  f.sense(.1); assert.equal(f.G4.pad.contacts.length,1); assert.equal(f.G4.pad.lock,null);
});
