// The designer's authoritative core: crates/design (tg-design) compiled to WebAssembly.
// Mass, armour, mobility, gun limits, validation, shots and protection maps all come from the
// same Rust code the server runs, so the editor never shows a number the server would not.
//
// Protocol (crates/design-wasm): JSON request in, JSON {ok, result | error} out.

function b64ToBytes(b64) {
  if (typeof atob === 'function') {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export class DesignCore {
  /** instance: a WebAssembly.Instance of tg_design_wasm. */
  constructor(instance, initData) {
    this.instance = instance;
    this.initData = initData;
    this.calls = 0;
    this.lastMs = 0;
    this.call({ op: 'init', ...initData });
  }

  /** Runs one request; throws with the core's message on failure. */
  call(req) {
    const ex = this.instance.exports;
    const bytes = enc.encode(JSON.stringify(req));
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const ptr = ex.tg_alloc(bytes.length);
    new Uint8Array(ex.memory.buffer, ptr, bytes.length).set(bytes);
    const out = ex.tg_call(ptr, bytes.length);
    ex.tg_free(ptr, bytes.length);
    const view = new DataView(ex.memory.buffer);
    const n = view.getUint32(out, true);
    const text = dec.decode(new Uint8Array(ex.memory.buffer, out + 4, n));
    this.calls++;
    this.lastMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    const r = JSON.parse(text);
    if (!r.ok) throw new Error(r.error);
    return r.result;
  }

  evaluate(design, { mobility = true, files = false } = {}) {
    return this.call({ op: 'evaluate', design, mobility, files });
  }
  accept(text) {
    return this.call({ op: 'accept', text });
  }
  protect(request, design) {
    return this.call({ op: 'protect', request, design: design || null });
  }
  probe(origin, dir, yaw = 0) {
    return this.call({ op: 'probe', origin, dir, yaw });
  }
  fits(boxes, design) {
    return this.call({ op: 'fits', boxes, design: design || null });
  }
  shoot(request) {
    return this.call({ op: 'shoot', request });
  }
  setDesign(design) {
    return this.call({ op: 'set_design', design });
  }
  resetTarget() {
    return this.call({ op: 'reset_target' });
  }
  shells(caliber_mm, length_cal) {
    return this.call({ op: 'shells', caliber_mm, length_cal });
  }

  // ---- the combat model of data vehicles (crates/combat): shots, module damage, repairs
  combatTarget(def) {
    return this.call({ op: 'combat_target', def });
  }
  combatNew(key) {
    return this.call({ op: 'combat_new', key });
  }
  combatShoot(key, state, shot) {
    return this.call({ op: 'combat_shoot', key, state, shot });
  }
  combatSplash(key, state, at, kg, yaw, seed) {
    return this.call({ op: 'combat_splash', key, state, at, kg, yaw, seed });
  }
  combatAdvance(key, state, dt, seed) {
    return this.call({ op: 'combat_advance', key, state, dt, seed });
  }
  combatRepair(key, state) {
    return this.call({ op: 'combat_repair', key, state });
  }
  combatAmmo(key, state, carried) {
    return this.call({ op: 'combat_ammo', key, state, carried });
  }
  combatExtinguish(key, state) {
    return this.call({ op: 'combat_extinguish', key, state });
  }
}

/** Browser: async compile (large modules may not be compiled synchronously on the main thread). */
export async function loadCore(b64, initData) {
  const { instance } = await WebAssembly.instantiate(b64ToBytes(b64), {});
  return new DesignCore(instance, initData);
}

/** Node / tests: synchronous. */
export function loadCoreSync(bytes, initData) {
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
  return new DesignCore(instance, initData);
}
