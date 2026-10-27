// Each vehicle's engine: which OPEX layers play idling and driving, at what gain, whether the
// acceleration (load-switch) one-shot plays as it pulls away; enemies' engines.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await tf.coreReady().catch(e => null);
const S = tf.sound, out = {}, loadOnPlays = [];
const op = S.full?.play?.bind(S.full); if (op) S.full.play = (id, e, l) => { if (/_on_\d+$/.test(id || '')) loadOnPlays.push([id, +(G.time || 0).toFixed(2)]); return op(id, e, l); };
const loops = () => [...S.full.loops.entries()].filter(([k]) => k.startsWith('engine:')).map(([k, v]) => [k.replace(/^engine:/, ''), v.id, +v.gain.gain.value.toFixed(3)]);
for (const id of (window.__VEH || 'su_t72a,us_m8').split(',')) {
  tf.finishThumbs(); await frames(2); tf.select(id); await frames(4); tf.startBattle(); await frames(3); S.start();
  tf.pause(true); S.setFullAudible = () => S.full?.suspend(false); S.full?.suspend(false);
  for (let k = 0; k < 16; k++) { tf.advance(0.25, [], true); await wait(250); }
  const idle = { loops: loops(), rpm: Math.round(G.info.rpm) };
  for (let k = 0; k < 10; k++) { tf.advance(0.3, ['fwd'], true); await wait(200); }
  const drive = { loops: loops(), rpm: Math.round(G.info.rpm), speed: +G.s.u.toFixed(1), loadOn: loadOnPlays.splice(0) };
  out[id] = { idle, drive, rigs: [...S.full.rigs.keys()].length, family: S.full.profile('engine', id)?.id, src: S.full.bank.cues[S.full.profile('engine', id)?.cues.idle]?.source?.split(' ').slice(2).join(' '), anchors: S.full.profile('engine', id)?.rpmAnchors, loadOnCues: S.full.profile('engine', id)?.loadOn, failed: [...S.full.failed].filter(k => k.startsWith('engine_')) };
}
return out;
