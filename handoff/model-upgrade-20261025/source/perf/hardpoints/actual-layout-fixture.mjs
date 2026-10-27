import fs from 'node:fs';
import vm from 'node:vm';
import * as hardpoints from './helper.mjs';
import * as mountedDetails from '../mount-v3/details.mjs';
// Read the production functions verbatim, rather than a test reimplementation of placement.
export function declaration(source, name, kind = 'function') {
  const marker = kind === 'function' ? `function ${name}(` : `const ${name} = `;
  const a = source.indexOf(marker);
  if (a < 0) throw new Error('Missing actual declaration: '+name);
  let i = a + marker.length, depth = 0, quote = null, line = false, block = false;
  for (; i < source.length; i++) {
    const c = source[i], n = source[i+1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (kind === 'const' && c === ';' && depth === 0) return source.slice(a, i+1);
    if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) {
      depth--;
      // A function marker consumed its opening parenthesis; its first depth-zero close is that
      // parameter list. The function body ends at a closing brace while depth is zero again.
      if (kind === 'function' && c === '}' && depth === -1) return source.slice(a, i+1);
    }
  }
  throw new Error('Unterminated actual declaration: '+name);
}
export function createLayout(source, types) {
  const socketFixtures = JSON.parse(fs.readFileSync(new URL('./store-sockets.json', import.meta.url)));
  const metadata=JSON.parse(fs.readFileSync(new URL('./store-models-metadata.json',import.meta.url)));
  const context = { TFModelHardpoints: hardpoints, TFMountedDetails:mountedDetails, AIRCRAFT_TYPES: types,
    data: { storeModels: Object.fromEntries(Object.entries(socketFixtures).map(([id, v]) => [id, {...metadata[id],lods: {'0': {sockets:v.sockets}}}])) },
    G4: { airCustom: {} } };
  vm.createContext(context);
  const code = [
    ...['AIR_STORE_DEFS','WEAPON_MIGRATION','WEAPON_COMPAT','AIR_LOADOUTS'].map(n => declaration(source,n,'const')),
    source.includes('TF_MOUNTED_DETAILS_BEGIN')?'TFMountedDetails.register(AIR_STORE_DEFS,data.storeModels);':'',
    'const migrateWeapon = id => AIR_STORE_DEFS[id] ? id : WEAPON_MIGRATION[id]?.to || null;',
    'const storeSocket = (model,name) => {const q=model?.lods?.["0"]?.sockets?.[name];return q?[-q[0],q[1],q[2]]:null;};',
    ...['airWingSplit','airStations','pylonPoint','pylonRack','storeMountPosition','layoutStores','airSlots','customLoadout'].map(n => declaration(source,n)),
    declaration(source,'SLOT_ORDER','const'),
    declaration(source,'slotsClash','const'),
    'return {layoutStores,AIR_LOADOUTS,AIR_STORE_DEFS,airSlots,slotsClash,customLoadout,G4,storeMountPosition};'
  ].join('\n');
  return vm.runInContext('(()=>{'+code+'})()', context);
}
