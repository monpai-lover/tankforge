//! tg-design compiled to WebAssembly for the browser editor. One JSON-in / JSON-out entry
//! point, so the page needs no binding generator:
//!
//!   ptr = tg_alloc(len); write UTF-8 request; out = tg_call(ptr, len)
//!   out points at [u32 little-endian length][UTF-8 JSON]; valid until the next call.
//!
//! Requests ({"op": ...}):
//!   init      {materials, catalog, terrains}                 -> {}
//!   evaluate  {design, mobility?: bool, files?: bool}         -> DesignReport (+ files)
//!   accept    {text}                                         -> Accepted | Rejection
//!   protect   {request: ProtectRequest}                      -> ProtectMap   (current design)
//!   probe     {origin, dir, yaw}                             -> Probe        (current design)
//!   shoot     {request: ShotRequest}                         -> ShotResponse (current design, persistent damage)
//!   fits      {boxes: [{mount, center, size, crew}]}          -> [{inside, outside_points}]
//!   reset_target                                             -> {}
//!   shells    {caliber_mm, length_cal}                       -> [ProjectileDef]
//!   combat_target    {def: TargetDef}                        -> {modules, crew} (registers a data vehicle by def.id)
//!   combat_new       {key}                                   -> {state, caps}
//!   combat_shoot     {key, state, shot: Shot}                -> Report (tg-combat)
//!   combat_splash    {key, state, at, kg, yaw, seed}         -> Report
//!   combat_advance   {key, state, dt, seed}                  -> {state, caps, events}
//!   mw_reset         {defs, terrain?}                        -> {} (missiles and active protection: crates/missile)
//!   mw_launch        {def, owner, team, pos, dir, seed, id?} -> {id}
//!   mw_guide         {id, owner, sight, aim}                 -> {}
//!   mw_end           {id}                                    -> {}
//!   mw_aps           {owner, def?, team?, seed? | enabled?, rate_rpm?, rounds? | remove?} -> {}
//!   mw_step          {dt, actors}                            -> {events, fired, missiles, aps}
//!   combat_ammo      {key, state, carried}                   -> {state, caps} (which racks hold the rounds)
//!   combat_repair    {key, state}                            -> {ok, state, caps}
//!   combat_extinguish{key, state}                            -> {ok, state, caps}
//! The "current design" is the last one passed to evaluate (or {"op":"set_design", design}).
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::HashMap;
use tg_combat::{Target, TargetDef, TargetState as CombatState};
use tg_design::trace::{probe, protection_map, shoot, ProtectRequest, ShotRequest, TargetState};
use tg_design::v3::V3;
use tg_design::layout::{BoxKind, PlacedBox};
use tg_design::{accept_submission, evaluate_with, Body, Catalog, Db, VehicleDesign};

#[derive(serde::Deserialize)]
struct FitBox {
    mount: Body,
    center: V3,
    size: V3,
    #[serde(default)]
    crew: bool,
}

struct State {
    db: Db,
    design: Option<VehicleDesign>,
    target: TargetState,
    /// Data vehicles the combat model knows, by id.
    targets: HashMap<String, Target>,
    /// Missiles, rockets and active protection in an offline battle (crates/missile).
    missiles: tg_missile::World,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[no_mangle]
pub extern "C" fn tg_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr` must come from `tg_alloc(len)`.
#[no_mangle]
pub unsafe extern "C" fn tg_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

fn field<T: serde::de::DeserializeOwned>(v: &Value, k: &str) -> Result<T, String> {
    serde_json::from_value(v.get(k).cloned().unwrap_or(Value::Null)).map_err(|e| format!("{}: {}", k, e))
}

fn with_design<R>(st: &mut State, req: &Value, f: impl FnOnce(&mut State, &VehicleDesign) -> R) -> Result<R, String> {
    if req.get("design").map(|d| !d.is_null()).unwrap_or(false) {
        let d: VehicleDesign = field(req, "design")?;
        st.design = Some(d);
    }
    let d = st.design.clone().ok_or("no design loaded")?;
    Ok(f(st, &d))
}

pub fn handle(req: &Value) -> Result<Value, String> {
    let op = req.get("op").and_then(|v| v.as_str()).unwrap_or("");
    if op == "init" {
        let materials = field(req, "materials")?;
        let catalog: Catalog = field(req, "catalog")?;
        let terrains = field(req, "terrains")?;
        STATE.with(|s| *s.borrow_mut() = Some(State { db: Db::new(materials, catalog, terrains, vec![]), design: None, target: TargetState::default(), targets: HashMap::new(), missiles: tg_missile::World::new(Vec::new()) }));
        return Ok(json!({}));
    }
    STATE.with(|s| {
        let mut guard = s.borrow_mut();
        let st = guard.as_mut().ok_or("call init first")?;
        match op {
            "set_design" => {
                st.design = Some(field(req, "design")?);
                st.target = TargetState::default();
                Ok(json!({}))
            }
            "evaluate" => {
                let mobility = req.get("mobility").and_then(|v| v.as_bool()).unwrap_or(true);
                let files = req.get("files").and_then(|v| v.as_bool()).unwrap_or(false);
                with_design(st, req, |st, d| {
                    let r = evaluate_with(d, &st.db, mobility);
                    let mut out = serde_json::to_value(&r).unwrap_or(Value::Null);
                    if files {
                        if let (Some(c), Value::Object(map)) = (&r.compiled, &mut out) {
                            map.insert("files".into(), c.files());
                            map.insert("design_extra".into(), c.design.clone());
                        }
                    }
                    out
                })
            }
            "accept" => {
                let text: String = field(req, "text")?;
                Ok(match accept_submission(&text, &st.db) {
                    Ok(a) => json!({"accepted": true, "result": a}),
                    Err(e) => json!({"accepted": false, "rejection": e}),
                })
            }
            "protect" => {
                let pr: ProtectRequest = field(req, "request")?;
                with_design(st, req, |st, d| {
                    let m = tg_design::layout::Model::new(d, &st.db);
                    serde_json::to_value(protection_map(&m, &pr)).unwrap_or(Value::Null)
                })
            }
            "probe" => {
                let o: V3 = field(req, "origin")?;
                let dir: V3 = field(req, "dir")?;
                let yaw: f64 = field(req, "yaw").unwrap_or(0.0);
                with_design(st, req, |st, d| {
                    let m = tg_design::layout::Model::new(d, &st.db);
                    serde_json::to_value(probe(&m, o, dir, yaw)).unwrap_or(Value::Null)
                })
            }
            "shoot" => {
                let sr: ShotRequest = field(req, "request")?;
                with_design(st, req, |st, d| {
                    let m = tg_design::layout::Model::new(d, &st.db);
                    let r = shoot(&m, &st.target, &sr);
                    let out = serde_json::to_value(&r).unwrap_or(Value::Null);
                    st.target = r.state;
                    out
                })
            }
            "fits" => {
                // [{mount, center, size, crew}] -> [{inside, outside_points}] for the current design
                let boxes: Vec<FitBox> = field(req, "boxes")?;
                with_design(st, req, |st, d| {
                    let m = tg_design::layout::Model::new(d, &st.db);
                    let out: Vec<Value> = boxes
                        .iter()
                        .map(|b| {
                            let kind = if b.crew { BoxKind::Crew(tg_design::CrewRoleDef::Gunner) } else { BoxKind::Module(tg_design::ModuleKindDef::FuelTank) };
                            let pb = PlacedBox { id: String::new(), kind, mount: b.mount, center: b.center, size: b.size, mass_kg: 0.0 };
                            let outside = pb.sample_points().iter().filter(|p| !m.in_mount_space(b.mount, **p)).count();
                            json!({"inside": outside == 0, "outside_points": outside})
                        })
                        .collect();
                    Value::Array(out)
                })
            }
            "reset_target" => {
                st.target = TargetState::default();
                Ok(json!({}))
            }
            "shells" => {
                let cal: f32 = field(req, "caliber_mm")?;
                let len: f32 = field(req, "length_cal")?;
                let list: Vec<_> = tg_design::shells::SHELL_KINDS.iter().filter(|k| tg_design::shells::kind_allowed(k, cal)).filter_map(|k| tg_design::shells::design_shell(k, cal, len)).collect();
                Ok(serde_json::to_value(list).unwrap_or(Value::Null))
            }
            // ---- missiles and active protection (offline battles; the server runs the same online)
            "mw_reset" => {
                let defs: Vec<tg_missile::MissileDef> = field(req, "defs")?;
                st.missiles = tg_missile::World::new(defs);
                if req.get("terrain").map(|t| !t.is_null()).unwrap_or(false) {
                    st.missiles.terrain = field(req, "terrain")?;
                }
                Ok(json!({}))
            }
            "mw_launch" => {
                let def: String = field(req, "def")?;
                let owner: u32 = field(req, "owner")?;
                let team: u8 = field(req, "team").unwrap_or(0);
                let pos: [f64; 3] = field(req, "pos")?;
                let dir: [f64; 3] = field(req, "dir")?;
                let seed: u32 = field(req, "seed").unwrap_or(1);
                let id: Option<u32> = field(req, "id").unwrap_or(None);
                Ok(json!({ "id": st.missiles.launch_as(id, &def, owner, team, pos, dir, seed) }))
            }
            "mw_guide" => {
                let id: u32 = field(req, "id")?;
                let owner: u32 = field(req, "owner")?;
                st.missiles.guide(id, owner, field(req, "sight")?, field(req, "aim")?);
                Ok(json!({}))
            }
            "mw_end" => {
                let id: u32 = field(req, "id")?;
                st.missiles.end(id, tg_missile::MStatus::Struck);
                Ok(json!({}))
            }
            "mw_aps" => {
                let owner: u32 = field(req, "owner")?;
                if req.get("remove").and_then(|v| v.as_bool()).unwrap_or(false) {
                    st.missiles.remove_aps(owner);
                } else if req.get("def").map(|d| !d.is_null()).unwrap_or(false) {
                    let team: u8 = field(req, "team").unwrap_or(0);
                    let seed: u32 = field(req, "seed").unwrap_or(1);
                    st.missiles.add_aps(owner, team, field(req, "def")?, seed);
                } else {
                    let enabled: bool = field(req, "enabled").unwrap_or(true);
                    let rate: Option<f64> = field(req, "rate_rpm").unwrap_or(None);
                    let rounds: Option<u32> = field(req, "rounds").unwrap_or(None);
                    st.missiles.set_aps_rounds(owner, enabled, rate, rounds);
                }
                Ok(json!({}))
            }
            "mw_step" => {
                let dt: f64 = field(req, "dt")?;
                let actors: Vec<tg_missile::Actor> = field(req, "actors")?;
                let out = st.missiles.step(dt, &actors);
                let missiles: Vec<Value> = st.missiles.flying().map(|m| json!({"id": m.id, "def": m.def, "owner": m.owner, "team": m.team, "pos": m.pos, "vel": m.vel, "motor": m.motor, "guided": m.guided, "hits": m.hits_taken, "g_load": m.g_load, "lateral_g": m.lateral_g, "max_g": m.max_g})).collect();
                let aps: Vec<Value> = st.missiles.aps.iter().map(|a| json!({"owner": a.owner, "mode": a.mode, "yaw": a.yaw, "pitch": a.pitch, "spin": a.spin, "heat": a.heat, "rounds": a.rounds, "rate_rpm": a.rate_rpm, "target": a.target, "range": a.target_range, "tca": a.target_tca, "firing": a.firing, "tracks": a.tracks.iter().filter(|t| t.firm).count(), "track_pos": a.tracks.iter().filter(|t| t.firm).map(|t| t.pos).collect::<Vec<_>>(), "scan": a.scan, "kills": a.kills, "enabled": a.enabled})).collect();
                Ok(json!({"events": out.events, "fired": out.fired, "missiles": missiles, "aps": aps}))
            }
            "combat_target" => {
                let def: TargetDef = field(req, "def")?;
                let id = def.id.clone();
                let t = Target::new(def, &st.db.material_list);
                let out = json!({"modules": t.def.modules.len(), "crew": t.def.crew.len()});
                st.targets.insert(id, t);
                Ok(out)
            }
            op if op.starts_with("combat_") => {
                let key: String = field(req, "key")?;
                let t = st.targets.get(&key).ok_or_else(|| format!("no combat target '{}'", key))?;
                let state = || -> Result<CombatState, String> { if req.get("state").map(|v| v.is_null()).unwrap_or(true) { Ok(t.fresh_state()) } else { field(req, "state") } };
                match op {
                    "combat_new" => {
                        let s = t.fresh_state();
                        Ok(json!({"caps": tg_combat::caps(t, &s), "state": s}))
                    }
                    "combat_shoot" => {
                        let shot: tg_combat::Shot = field(req, "shot")?;
                        Ok(serde_json::to_value(tg_combat::shoot(t, &state()?, &shot)).unwrap_or(Value::Null))
                    }
                    "combat_splash" => {
                        let at: tg_shared::Vec3 = field(req, "at")?;
                        let kg: f32 = field(req, "kg")?;
                        let yaw: f32 = field(req, "yaw").unwrap_or(0.0);
                        let seed: u64 = field(req, "seed").unwrap_or(1);
                        Ok(serde_json::to_value(tg_combat::splash(t, &state()?, at, kg, yaw, seed)).unwrap_or(Value::Null))
                    }
                    "combat_advance" => {
                        let mut s = state()?;
                        let dt: f32 = field(req, "dt")?;
                        let seed: u64 = field(req, "seed").unwrap_or(1);
                        let events = tg_combat::advance(t, &mut s, dt, seed);
                        Ok(json!({"caps": tg_combat::caps(t, &s), "events": events, "state": s}))
                    }
                    "combat_ammo" => {
                        let mut s = state()?;
                        let carried: u32 = field(req, "carried")?;
                        tg_combat::load_ammo(t, &mut s, carried);
                        Ok(json!({"caps": tg_combat::caps(t, &s), "state": s}))
                    }
                    "combat_repair" | "combat_extinguish" => {
                        let mut s = state()?;
                        let ok = if op == "combat_repair" { tg_combat::start_repair(t, &mut s) } else { tg_combat::extinguish(&mut s) };
                        Ok(json!({"ok": ok, "caps": tg_combat::caps(t, &s), "state": s}))
                    }
                    _ => Err(format!("unknown op '{}'", op)),
                }
            }
            _ => Err(format!("unknown op '{}'", op)),
        }
    })
}

/// Same as the C entry point, for native tests.
pub fn call_json(text: &str) -> String {
    let resp = match serde_json::from_str::<Value>(text) {
        Ok(req) => match handle(&req) {
            Ok(v) => json!({"ok": true, "result": v}),
            Err(e) => json!({"ok": false, "error": e}),
        },
        Err(e) => json!({"ok": false, "error": format!("bad request: {}", e)}),
    };
    resp.to_string()
}

/// # Safety
/// `ptr` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn tg_call(ptr: *const u8, len: usize) -> *const u8 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let text = String::from_utf8_lossy(bytes);
    let out = call_json(&text);
    OUT.with(|o| {
        let mut o = o.borrow_mut();
        o.clear();
        o.extend_from_slice(&(out.len() as u32).to_le_bytes());
        o.extend_from_slice(out.as_bytes());
        o.as_ptr()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_then_unknown_design_errors_cleanly() {
        let init = json!({
            "op": "init",
            "materials": serde_json::from_str::<Value>(include_str!("../../../data/materials.json")).unwrap(),
            "catalog": serde_json::from_str::<Value>(include_str!("../../../data/design_catalog.json")).unwrap(),
            "terrains": serde_json::from_str::<Value>(include_str!("../../../data/terrains.json")).unwrap(),
        });
        let r: Value = serde_json::from_str(&call_json(&init.to_string())).unwrap();
        assert_eq!(r["ok"], true);
        let r: Value = serde_json::from_str(&call_json(r#"{"op":"protect","request":{}}"#)).unwrap();
        assert_eq!(r["ok"], false);
        let r: Value = serde_json::from_str(&call_json(r#"{"op":"shells","caliber_mm":75,"length_cal":48}"#)).unwrap();
        assert_eq!(r["result"].as_array().unwrap().len(), 6);
    }
}
