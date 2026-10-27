// Custom armament editor (user request: install missiles / bombs / cannons pylon by pylon, like a
// weapons grid): opened from the garage hangar's loadout panel, cells clicked as a player would.
const tf = window.__tf, x = window.__tfx, G = tf.G, out = {};
const check = (v, m) => { if (!v) throw Error(m); };
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs();
document.querySelector('#g-mode .tab[data-g=air]').click();
for (let i = 0; i < 30 && !G.airGarage.plane; i++) await frames(1);
const pick = async (store, n) => { const c = [...document.querySelectorAll(`#air-arm .air-arm-cell[data-store=${store}]`)][n]; check(c, `no ${store} cell ${n}`); c.click(); await frames(2); return c.dataset.slot; };
const pressed = () => [...document.querySelectorAll('#air-arm .air-arm-cell[aria-pressed=true]')].map(c => `${c.dataset.slot}=${c.dataset.store}`).sort();
// F-4E: the grid, AIM-9L on one pylon mirrored to the other wing, a pod on the inner pylons
document.querySelector('#air-list .card[data-air=f4e]').click(); await frames(3);
document.querySelector('#g-air .air-lo-edit').click(); await frames(2);
check(!document.getElementById('air-arm').hidden, 'editor did not open');
const cols = document.querySelectorAll('#air-arm thead th').length - 1, rows = [...document.querySelectorAll('#air-arm .air-arm-name')].map(t => t.textContent);
out.f4eGrid = { pylons: cols, stores: rows };
document.querySelector('#air-arm .air-arm-clear').click(); await frames(2);
await pick('aim9l', 0);
await pick('lau3', 0);
await pick('aim7e', 0);
out.f4ePicked = pressed();
check(out.f4ePicked.filter(s => s.endsWith('aim9l')).length === 2, 'mirror did not set both wings');
await pyShot('editor_f4e');
const preview = G.airGarage.plane.storeNodes.filter(n => n.name.startsWith('aircraft_store')).length;
out.f4ePreviewStores = preview;
document.querySelector('#air-arm .air-arm-done').click(); await frames(2);
check(document.getElementById('air-arm').hidden, 'editor did not close');
out.panel = { pressed: document.querySelector('#g-air .air-lo[aria-pressed=true]').textContent, what: document.querySelector('#g-air .air-lo-what').textContent };
out.saved = JSON.parse(localStorage.getItem('tf.airCustom') || '{}').f4e;
check(out.saved && Object.keys(out.saved).length === out.f4ePicked.length, 'custom loadout not saved');
// P-51D: rockets along the wing and a bomb on the inner pylon cannot share a wing
document.querySelector('#air-list .card[data-air=p51d]').click(); await frames(3);
document.querySelector('#g-air .air-lo-edit').click(); await frames(2);
document.querySelector('#air-arm .air-arm-clear').click(); await frames(2);
await pick('hvar', 0); const a = pressed();
await pick('anm64', 0); const b = pressed();
out.p51dClash = { rockets: a, thenBomb: b };
check(a.every(s => s.endsWith('hvar')) && b.every(s => s.endsWith('anm64')), 'rails and the inner pylon both kept');
// asymmetric: mirror off, a bomb on the left only
document.querySelector('#air-arm .air-arm-mirror').click(); await frames(1);
document.querySelector('#air-arm .air-arm-clear').click(); await frames(2);
await pick('anm64', 0); out.p51dLeftOnly = pressed();
check(out.p51dLeftOnly.length === 1, 'mirror off still set both');
document.querySelector('#air-arm .air-arm-done').click(); await frames(2);
// fly the F-4E with its custom loadout and fire one AIM-9L's worth of the group
document.querySelector('#air-list .card[data-air=f4e]').click(); await frames(3);
G.airBotsOn = false;
document.getElementById('battle-btn').click();
for (let i = 0; i < 600 && !G.air?.active; i++) await frames(1);
check(G.air?.active, 'did not take off');
const st = G.air.stores;
out.flown = { name: st.name, items: st.items.map(it => it.id).sort(), groups: st.groups };
check(st.name === '自訂' && st.items.length === preview, 'flown loadout is not the custom one');
return out;
