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
//!   combat_weapon_bindings {key}                            -> normalized weapon/module binding metadata
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
mod geometry_diagnostic;
mod surface_runtime;

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
    geometry: geometry_diagnostic::Diagnostics,
    surfaces:surface_runtime::SurfaceRuntime,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Explicit capability: legacy saved modules omit this export.
#[no_mangle]
pub extern "C" fn tg_replay_revision()->u32 {1}
#[no_mangle]
pub extern "C" fn tg_surface_revision()->u32 {1}
#[no_mangle]
pub extern "C" fn tg_barrel_revision()->u32 {1}
#[no_mangle]
pub extern "C" fn tg_weapon_bindings_revision()->u32 {1}

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
        STATE.with(|s| *s.borrow_mut() = Some(State { db: Db::new(materials, catalog, terrains, vec![]), design: None, target: TargetState::default(), targets: HashMap::new(), missiles: tg_missile::World::new(Vec::new()), geometry: geometry_diagnostic::Diagnostics::default(),surfaces:surface_runtime::SurfaceRuntime::default() }));
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
                let accepted=st.missiles.launch_as(id,&def,owner,team,pos,dir,seed);
                Ok(json!({"id":accepted,"time_s":st.missiles.t}))
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
            "mw_aps_pose" => {
                let owner: u32 = field(req, "owner")?;
                Ok(json!({"adopted": st.missiles.adopt_aps_pose(owner, field(req, "yaw")?, field(req, "pitch")?)}))
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
                Ok(json!({"events": out.events, "fired": out.fired, "missiles": missiles, "aps": aps,"ended":st.missiles.ended,"time_s":st.missiles.t}))
            }
            "combat_target" => {
                let def: TargetDef = field(req, "def")?;
                let id = def.id.clone();
                let t = Target::new(def, &st.db.material_list);
                st.surfaces.verify_target_registration(&id,&t)?;
                let out = json!({"modules": t.def.modules.len(), "crew": t.def.crew.len(), "modules_def": t.def.modules, "binding_errors": t.binding_errors,"registration_hash":t.registration_hash()});
                st.targets.insert(id, t);
                Ok(out)
            }
            op if op.starts_with("combat_geometry_") => st.geometry.call(op,req),
            op if op.starts_with("combat_surface_")&&op!="combat_surface_shoot"&&op!="combat_surface_near_burst"=>{let target=req["key"].as_str().and_then(|key|st.targets.get(key));st.surfaces.call(op,req,target)},
            op if op.starts_with("combat_") => {
                let key: String = field(req, "key")?;
                let t = st.targets.get(&key).ok_or_else(|| format!("no combat target '{}'", key))?;
                let state = || -> Result<CombatState, String> { if req.get("state").map(|v| v.is_null()).unwrap_or(true) { Ok(t.fresh_state()) } else { field(req, "state") } };
                match op {
                    "combat_weapon_bindings"=>{
                        let modules=t.def.modules.iter().enumerate().map(|(index,module)|json!({
                            "index":index,"id":module.id,"kind":module.kind,"weapon_group":module.weapon_group,
                            "turret_index":module.turret_index,"external":module.external})).collect::<Vec<_>>();
                        Ok(json!({"schema":"CombatWeaponBindingsV1","revision":1,"bindings":t.weapon_bindings,
                            "modules":modules,"binding_errors":t.binding_errors}))
                    },
                    "combat_near_burst"|"combat_surface_near_burst"=>{
                        let at=field(req,"at")?;let shell=field(req,"shell")?;let yaw=field(req,"yaw")?;let seed=match &req["seed"]{Value::String(v)=>v.parse::<u64>().map_err(|_|"invalid near-burst seed")?,v=>v.as_u64().ok_or("invalid near-burst seed")?};let context:Option<tg_combat::causes::DamageContext>=field(req,"context")?;
                        let before=state()?;st.surfaces.verify_state(&key,&before)?;
                        let include_pressure=match req.get("include_pressure"){None=>true,Some(v)=>v.as_bool().ok_or("invalid near-burst pressure policy")?};
                        let report=if op=="combat_surface_near_burst"{st.surfaces.near_burst(&key,t,&before,at,&shell,yaw,seed,context.as_ref(),include_pressure)?}else if include_pressure{tg_combat::near_burst::evaluate(t,&before,at,&shell,yaw,seed,context.as_ref(),None)?}else{tg_combat::near_burst::evaluate_casing(t,&before,at,&shell,yaw,seed,context.as_ref(),None)?};
                        st.surfaces.observe_report(&key,&report.state);
                        Ok(serde_json::to_value(report).map_err(|e|e.to_string())?)
                    },
                    "combat_surface_shoot"=>{let shot=field(req,"shot")?;let end=field(req,"end")?;let context:Option<tg_combat::causes::DamageContext>=field(req,"context")?;st.surfaces.shoot(&key,t,&state()?,&shot,end,context.as_ref())},
                    "combat_new" => {
                        let s = t.fresh_state();
                        Ok(json!({"caps": tg_combat::caps(t, &s), "state": s}))
                    }
                    "combat_shoot" => {
                        let shot: tg_combat::Shot = field(req, "shot")?;
                        let context:Option<tg_combat::causes::DamageContext>=if req.get("context").is_some(){field(req,"context")?}else{None};
                        if context.as_ref().is_some_and(|c|!c.valid()){return Err("invalid replay context".into());}
                        let before=state()?;st.surfaces.verify_state(&key,&before)?;
                        let report=match context.as_ref(){Some(c)=>tg_combat::shoot_context(t,&before,&shot,c),None=>tg_combat::shoot(t,&before,&shot)};
                        st.surfaces.observe_report(&key,&report.state);
                        Ok(serde_json::to_value(report).unwrap_or(Value::Null))
                    }
                    "combat_splash" => {
                        let at: tg_shared::Vec3 = field(req, "at")?;
                        let kg: f32 = field(req, "kg")?;
                        let yaw: f32 = field(req, "yaw").unwrap_or(0.0);
                        let seed: u64 = field(req, "seed").unwrap_or(1);
                        let before=state()?;st.surfaces.verify_state(&key,&before)?;
                        let report=tg_combat::splash(t,&before,at,kg,yaw,seed);st.surfaces.observe_report(&key,&report.state);
                        Ok(serde_json::to_value(report).unwrap_or(Value::Null))
                    }
                    "combat_advance" => {
                        let mut s = state()?;
                        let dt: f32 = field(req, "dt")?;
                        st.surfaces.verify_advance(&key,&s,dt)?;let before=s.clone();
                        let seed: u64 = field(req, "seed").unwrap_or(1);
                        let context:Option<tg_combat::causes::DamageContext>=if req.get("context").is_some(){field(req,"context")?}else{None};
                        if context.as_ref().is_some_and(|c|!c.valid()){return Err("invalid replay context".into());}
                        st.surfaces.verify_advance_context(&key,context.as_ref(),dt)?;
                        if let Some(c)=context {let result=tg_combat::advance_context(t,&mut s,dt,seed,&c.event_id);
                            st.surfaces.observe_advance(&key,&before,&s,&result.events,&c.event_id)?;
                            Ok(json!({"caps":tg_combat::caps(t,&s),"events":result.events,"state":s,"cause_transitions":result.transitions,"death_cause":result.death_cause,"shape_transition":st.surfaces.pending(&key)}))}
                        else {let events=tg_combat::advance(t,&mut s,dt,seed);st.surfaces.observe_advance(&key,&before,&s,&events,"core_repair")?;
                            Ok(json!({"caps": tg_combat::caps(t, &s), "events": events, "state": s,"shape_transition":st.surfaces.pending(&key)}))}
                    }
                    "combat_ammo" => {
                        let mut s = state()?;
                        let carried: u32 = field(req, "carried")?;
                        tg_combat::load_ammo(t, &mut s, carried);
                        Ok(json!({"caps": tg_combat::caps(t, &s), "state": s}))
                    }
                    "combat_repair" | "combat_extinguish" => {
                        let mut s = state()?;
                        st.surfaces.verify_state(&key,&s)?;
                        let ok = if op == "combat_repair" { tg_combat::start_repair(t, &mut s) } else { tg_combat::extinguish(&mut s) };
                        if op=="combat_repair"{st.surfaces.observe_repair_start(&key,&s,ok)?;}
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
    if text.len()>128*1024*1024{return json!({"ok":false,"error":"request byte limit"}).to_string();}
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

    fn binding_api_data(path:&str)->Value {
        let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        serde_json::from_slice(&std::fs::read(root.join(path)).unwrap()).unwrap()
    }
    fn binding_api_definition(id:&str)->TargetDef {
        let mut def=tg_combat::target_from_files(id,&binding_api_data(&format!("vehicles/{id}/vehicle.json")),
            serde_json::from_value(binding_api_data(&format!("vehicles/{id}/armor.json"))).unwrap(),
            serde_json::from_value(binding_api_data(&format!("vehicles/{id}/modules.json"))).unwrap(),
            serde_json::from_value(binding_api_data(&format!("vehicles/{id}/crew.json"))).unwrap());
        def.weapons=binding_api_data(&format!("vehicles/{id}/weapons.json"));
        def.ammo_capacity=tg_combat::ammo_capacity(&def.weapons);def.machine_guns=binding_api_data("machine_guns.json");
        let visual=binding_api_data(&format!("vehicles/{id}/visual.json"));
        def.visual=json!({"mg_anchors":visual.get("mg_anchors").cloned().unwrap_or_else(||json!({})),
            "mg_variants":visual.get("mg_variants").cloned().unwrap_or_else(||json!({}))});def
    }
    fn binding_api_register(def:&TargetDef)->Value {
        handle(&json!({"op":"init","materials":binding_api_data("materials.json"),
            "catalog":binding_api_data("design_catalog.json"),"terrains":binding_api_data("terrains.json")})).unwrap();
        let old=handle(&json!({"op":"combat_target","def":def})).unwrap();
        let keys=old.as_object().unwrap().keys().map(String::as_str).collect::<Vec<_>>();
        assert_eq!(keys,vec!["binding_errors","crew","modules","modules_def","registration_hash"],"existing target response remains exactly the same schema");old
    }
    fn binding_api_metadata(id:&str)->Value {
        let def=binding_api_definition(id);let old=binding_api_register(&def);
        let metadata=handle(&json!({"op":"combat_weapon_bindings","key":id})).unwrap();
        assert_eq!(metadata["schema"],"CombatWeaponBindingsV1");assert_eq!(metadata["revision"],1);
        STATE.with(|cell|{let guard=cell.borrow();let target=&guard.as_ref().unwrap().targets[id];
            assert_eq!(metadata["bindings"],serde_json::to_value(&target.weapon_bindings).unwrap(),"actual normalized binding table is exposed without reinterpretation");
            assert_eq!(metadata["binding_errors"],serde_json::to_value(&target.binding_errors).unwrap());
            let modules=metadata["modules"].as_array().unwrap();assert_eq!(modules.len(),target.def.modules.len());
            for (i,(row,module)) in modules.iter().zip(&target.def.modules).enumerate(){
                assert_eq!(row["index"],i);assert_eq!(row["id"],module.id);assert_eq!(row["kind"],serde_json::to_value(module.kind).unwrap());
                assert_eq!(row["weapon_group"],serde_json::to_value(&module.weapon_group).unwrap());
                assert_eq!(row["turret_index"],serde_json::to_value(module.turret_index).unwrap());
                assert_eq!(row["external"],serde_json::to_value(module.external).unwrap());
            }});
        assert_eq!(handle(&json!({"op":"combat_weapon_bindings","key":id,"state":{"invalid":"unused"}})).unwrap(),metadata,"metadata does not consult supplied health or caps");
        assert_eq!(serde_json::to_vec(&handle(&json!({"op":"combat_target","def":def})).unwrap()).unwrap(),serde_json::to_vec(&old).unwrap(),"query does not change the original registration response or hash");metadata
    }
    fn binding_api_critical(metadata:&Value,key:&str,expected:&[(&str,&str)]) {
        assert!(metadata["bindings"][key]["binding_error"].is_null(),"{key}: {}",metadata["bindings"][key]);
        let rows=metadata["bindings"][key]["critical"].as_array().unwrap().iter().map(|index|{
            let row=&metadata["modules"][index.as_u64().unwrap() as usize];(row["id"].as_str().unwrap(),row["kind"].as_str().unwrap())}).collect::<Vec<_>>();
        assert_eq!(rows.as_slice(),expected,"{key}");
    }
    #[test]
    fn weapon_bindings_api_t72_main_and_coax_preserve_registration() {
        assert_eq!(tg_weapon_bindings_revision(),1);
        let metadata=binding_api_metadata("su_t72a");
        binding_api_critical(&metadata,"gun:0:0",&[("breech","gun_breech"),("gun_barrel","gun_barrel")]);
        binding_api_critical(&metadata,"mg:coax_pkt",&[("mg:coax_pkt:receiver","machine_gun"),("mg:coax_pkt:barrel","machine_gun")]);
        assert_eq!(metadata["bindings"]["mg:coax_pkt"]["kind"],"machine_gun");
    }
    #[test]
    fn weapon_bindings_api_hetzer_main_and_roof_mg_preserve_registration() {
        let metadata=binding_api_metadata("de_hetzer");
        binding_api_critical(&metadata,"gun:0:0",&[("breech","gun_breech"),("gun_barrel","gun_barrel")]);
        binding_api_critical(&metadata,"mg:roof_mg34",&[("mg:roof_mg34:receiver","machine_gun"),("mg:roof_mg34:barrel","machine_gun")]);
        assert_eq!(metadata["bindings"]["mg:roof_mg34"]["secondary_id"],"roof_mg34");
    }
    #[test]
    fn weapon_bindings_api_t10_main_and_aps_keep_actual_module_kinds() {
        let metadata=binding_api_metadata("su_t10m");
        binding_api_critical(&metadata,"gun:0:0",&[("breech","gun_breech"),("gun_barrel","gun_barrel")]);
        binding_api_critical(&metadata,"gun:1:0",&[("oplot_gun","aps_gun")]);
        assert_eq!(metadata["bindings"]["gun:1:0"]["turret_index"],1);assert_eq!(metadata["bindings"]["gun:1:0"]["gun_index"],0);
    }
    #[test]
    fn weapon_bindings_api_oplot23_keeps_named_aps_without_inventing_tube_roles() {
        let metadata=binding_api_metadata("su_t10m_oplot23");
        binding_api_critical(&metadata,"gun:1:0",&[("oplot_gun","aps_gun")]);
        assert_eq!(metadata["bindings"]["gun:1:0"]["model_id"],"oplot23_gsh6_23_custom");
        assert!(!metadata.to_string().contains("physical_tube"));
    }
    #[test]
    fn weapon_bindings_api_mixed_duplicate_guns_and_launchers_are_independent_rows() {
        let metadata=binding_api_metadata("su_bmpt34");
        binding_api_critical(&metadata,"gun:0:0",&[("cannon_breech_01","gun_breech"),("gun_barrel_01","gun_barrel")]);
        binding_api_critical(&metadata,"gun:0:1",&[("cannon_breech_02","gun_breech"),("gun_barrel_02","gun_barrel")]);
        binding_api_critical(&metadata,"gun:0:2",&[("launcher_tt250_rail_r","launcher")]);
        binding_api_critical(&metadata,"gun:0:3",&[("launcher_tt250_rail_l","launcher")]);
        assert_eq!(metadata["bindings"]["gun:0:0"]["model_id"],metadata["bindings"]["gun:0:1"]["model_id"]);
        assert_eq!(metadata["bindings"]["gun:0:2"]["kind"],"missile");assert_eq!(metadata["bindings"]["gun:0:3"]["kind"],"missile");
    }
    #[test]
    fn weapon_bindings_api_unknown_associations_remain_explicit_core_errors() {
        let mut def=binding_api_definition("su_t72a");def.weapons["damage"]=json!({"critical":["missing_physical_module"]});
        let old=binding_api_register(&def);let metadata=handle(&json!({"op":"combat_weapon_bindings","key":def.id})).unwrap();
        assert!(metadata["bindings"]["gun:0:0"]["binding_error"].as_str().unwrap().contains("missing_physical_module"));
        assert_eq!(metadata["binding_errors"],old["binding_errors"]);assert_eq!(metadata["bindings"]["gun:0:0"]["critical"],json!([]));
        def.weapons=Value::Null;binding_api_register(&def);
        let legacy=handle(&json!({"op":"combat_weapon_bindings","key":def.id})).unwrap();
        assert_eq!(legacy["bindings"],json!({}));assert_eq!(legacy["binding_errors"],json!({}));
    }
    #[test]
    fn weapon_bindings_api_unknown_target_cannot_fall_back_to_another_registration() {
        binding_api_register(&binding_api_definition("su_t72a"));
        assert!(handle(&json!({"op":"combat_weapon_bindings","key":"unregistered_target"})).unwrap_err().contains("no combat target"));
    }

    #[test]
    fn combat_target_returns_idempotent_normalized_modules_and_instance_caps() {
        let value=|s:&str| serde_json::from_str::<Value>(s).unwrap();
        let vehicle=value(include_str!("../../../data/vehicles/de_hetzer/vehicle.json"));
        let mut def=tg_combat::target_from_files("binding_wasm_test",&vehicle,
            serde_json::from_value(value(include_str!("../../../data/vehicles/de_hetzer/armor.json"))).unwrap(),
            serde_json::from_value(value(include_str!("../../../data/vehicles/de_hetzer/modules.json"))).unwrap(),
            serde_json::from_value(value(include_str!("../../../data/vehicles/de_hetzer/crew.json"))).unwrap());
        def.weapons=value(include_str!("../../../data/vehicles/de_hetzer/weapons.json"));
        def.machine_guns=value(include_str!("../../../data/machine_guns.json"));
        let visual=value(include_str!("../../../data/vehicles/de_hetzer/visual.json"));
        def.visual=json!({"mg_anchors":visual["mg_anchors"],"mg_variants":visual["mg_variants"]});
        let call=|req:Value| serde_json::from_str::<Value>(&call_json(&req.to_string())).unwrap();
        assert_eq!(call(json!({"op":"init",
            "materials":value(include_str!("../../../data/materials.json")),
            "catalog":value(include_str!("../../../data/design_catalog.json")),
            "terrains":value(include_str!("../../../data/terrains.json"))}))["ok"],true);
        let first=call(json!({"op":"combat_target","def":def}));
        assert_eq!(first["ok"],true);
        assert_eq!(first["result"]["modules"].as_u64().unwrap() as usize,def.modules.len()+2);
        assert_eq!(first["result"]["crew"].as_u64().unwrap() as usize,def.crew.len());
        assert_eq!(first["result"]["binding_errors"],json!({}));
        def.modules=serde_json::from_value(first["result"]["modules_def"].clone()).unwrap();
        let second=call(json!({"op":"combat_target","def":def}));
        assert_eq!(first["result"],second["result"]);
        let fresh=call(json!({"op":"combat_new","key":"binding_wasm_test"}));
        assert_eq!(fresh["result"]["caps"]["weapons"]["mg:roof_mg34"]["can_fire"],true);
        assert_eq!(fresh["result"]["state"]["modules"].as_array().unwrap().len(),def.modules.len());
    }

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
