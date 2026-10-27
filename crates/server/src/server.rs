//! The network side: one thread per connection reading its socket, one writer thread per
//! connection draining a bounded queue, and a ticker sending every battle's snapshot 20 times a
//! second. All of them share the [`Lobby`] behind one mutex; the lobby never blocks on a socket.
//!
//! Over plain HTTP the same port serves the game page at `/` (so a friend only needs the address),
//! the room list as JSON at `/rooms`, and the WebSocket at `/ws`.
use crate::lobby::{Broadcast, ClientMsg, Lobby, Out, ServerMsg, Shell};
use crate::ws;
use std::collections::{HashMap, HashSet};
use std::io::{self, BufRead, BufReader, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::sync::atomic::{AtomicU64,Ordering};
use std::thread;
use std::time::{Duration, Instant};

pub const TICK_HZ: f64 = 20.0;
/// More connections than this are turned away.
const MAX_CONNECTIONS: usize = 256;
/// A client silent this long is gone (the game pings every few seconds).
const IDLE: Duration = Duration::from_secs(30);

type Frame = Arc<Vec<u8>>;

static PROFILE_SERIALIZE_NS:AtomicU64=AtomicU64::new(0);
static PROFILE_ENCODE_NS:AtomicU64=AtomicU64::new(0);
fn profile_start()->Option<Instant>{crate::frontline_sim::native_timing_enabled().then(Instant::now)}
fn profile_add(counter:&AtomicU64,start:Option<Instant>){if let Some(start)=start{counter.fetch_add(start.elapsed().as_nanos() as u64,Ordering::Relaxed);}}

struct Conn {
    tx: SyncSender<Frame>,
    stream: TcpStream,
    /// Which socket this is: after a resume the player's id points at a newer one, and the old
    /// socket's reader must not tear the player down when it finally notices it is closed.
    serial: u64,
    /// Negotiated per socket, never retained on the player or shared across audiences.
    frontline_wire: Option<crate::frontline_wire::FrameEncoder>,
}

struct Hub {
    lobby: Lobby,
    conns: HashMap<u32, Conn>,
    clock: Instant,
    lobby_ticks: u64,
    serials: u64,
}

impl Hub {
    fn now(&self) -> f64 {
        self.clock.elapsed().as_secs_f64()
    }

    fn send(&mut self, to: u32, frame: Frame) {
        let Some(c) = self.conns.get(&to) else { return };
        match c.tx.try_send(frame) {
            Ok(()) => {}
            // too far behind (or gone): drop it, its reader sees the socket close and leaves
            Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
                let _ = c.stream.shutdown(Shutdown::Both);
            }
        }
    }

    fn dispatch(&mut self, out: Out) {
        for (to, msg) in out {
            if let Some(frame)=self.encode_for(to,&msg,None){self.send(to,frame);}
        }
    }

    fn encode_for(&mut self,to:u32,msg:&ServerMsg,shared:Option<&Arc<serde_json::Value>>)->Option<Frame>{
        let c=self.conns.get_mut(&to)?;
        if matches!(msg,ServerMsg::Frontline{message:crate::frontline::Update::Snapshot{..},..}) {
            if let Some(encoder)=c.frontline_wire.as_mut(){encoder.force_reset();}
        }
        if let ServerMsg::Frontline{message:message @ crate::frontline::Update::Frame{..},..}=msg {
            if let Some(encoder)=c.frontline_wire.as_mut(){
                let started=profile_start();
                let result=match shared {Some(value)=>encoder.encode_shared(value),None=>encoder.encode(message)};
                profile_add(&PROFILE_ENCODE_NS,started);
                return match result {
                    Ok(bytes)=>Some(Arc::new(ws::encode(2,&bytes))),
                    // A failed frame cannot advance this connection's authority or
                    // silently switch its precision. A new socket gets a new baseline.
                    Err(_)=>{let _=c.stream.shutdown(Shutdown::Both);None},
                };
            }
        }
        let started=profile_start();
        let json=if matches!(msg,ServerMsg::Welcome{..})&&c.frontline_wire.is_some(){
            let mut value=serde_json::to_value(msg).ok()?;
            value["frontline_wire_version"]=serde_json::json!(crate::frontline_wire::VERSION);
            value["frontline_wire_stream"]=serde_json::json!(c.serial.to_string());
            serde_json::to_string(&value).ok()?
        }else{serde_json::to_string(msg).ok()?};
        profile_add(&PROFILE_SERIALIZE_NS,started);
        Some(Arc::new(ws::text(&json)))
    }

    fn negotiate_frontline_wire(&mut self,to:u32,version:Option<u32>){
        let Some(c)=self.conns.get_mut(&to) else{return};
        if version==Some(crate::frontline_wire::VERSION){
            if let Some(encoder)=c.frontline_wire.as_mut(){encoder.force_reset();}
            else{c.frontline_wire=Some(crate::frontline_wire::FrameEncoder::new(c.serial));}
        }else{c.frontline_wire=None;}
    }

    fn broadcast(&mut self, out: Broadcast) {
        for (to, msg) in out {
            if let ServerMsg::Frontline{message:message @ crate::frontline::Update::Frame{..},..}=&msg {
                // A future visibility filter must form each authorized audience
                // before this serialization; encoders never add hidden units.
                let started=profile_start();
                let Ok(value)=serde_json::to_value(message) else{continue};
                profile_add(&PROFILE_SERIALIZE_NS,started);
                let value=Arc::new(value);
                let legacy=to.iter().any(|id|self.conns.get(id).is_some_and(|c|c.frontline_wire.is_none()));
                let started=profile_start();
                let legacy=if legacy{serde_json::to_string(&msg).ok().map(|json|Arc::new(ws::text(&json)))}else{None};
                profile_add(&PROFILE_SERIALIZE_NS,started);
                for id in to {
                    if self.conns.get(&id).is_some_and(|c|c.frontline_wire.is_some()){
                        if let Some(frame)=self.encode_for(id,&msg,Some(&value)){self.send(id,frame);}
                    }else if let Some(frame)=&legacy{self.send(id,frame.clone());}
                }
                continue;
            }
            if matches!(&msg,ServerMsg::Welcome{..}|ServerMsg::Frontline{message:crate::frontline::Update::Snapshot{..},..}){
                for id in to{if let Some(frame)=self.encode_for(id,&msg,None){self.send(id,frame);}}
                continue;
            }
            let Ok(json) = serde_json::to_string(&msg) else { continue };
            let frame = Arc::new(ws::text(&json));
            for id in to {
                self.send(id, frame.clone());
            }
        }
    }
}

/// Hello keeps the legacy domain shape; its optional wire preference belongs
/// solely to this socket. Invalid capabilities cannot mutate a player/seat.
fn requested_frontline_wire(text:&str,msg:&ClientMsg)->Result<Option<Option<u32>>,&'static str>{
    if !matches!(msg,ClientMsg::Hello{..}){return Ok(None);}
    let value:serde_json::Value=serde_json::from_str(text).map_err(|_|"Invalid Hello")?;
    match value.get("frontline_wire_version") {
        None|Some(serde_json::Value::Null)=>Ok(Some(None)),
        Some(v)=>match v.as_u64(){
            Some(0|1)=>Ok(Some(None)),
            Some(2)=>Ok(Some(Some(2))),
            _=>Err("Unsupported frontline wire version"),
        },
    }
}

type Shared = Arc<Mutex<Hub>>;

#[cfg(test)]
#[path = "frontline_wire_server_tests.rs"]
mod frontline_wire_transport_tests;
#[cfg(test)]
#[path = "frontline_round_socket_tests.rs"]
mod frontline_round_socket_tests;

fn lock(h: &Shared) -> MutexGuard<'_, Hub> {
    h.lock().unwrap_or_else(|e| e.into_inner())
}

/// The combat model's data: each vehicle as a target, every shell, every machine gun's bullet.
pub struct CombatData {
    pub targets: HashMap<String, tg_combat::Target>,
    pub projectiles: HashMap<String, tg_weapon::ProjectileDef>,
    pub bullets: HashMap<String, tg_weapon::ProjectileDef>,
}

/// A machine gun's bullet as a projectile (as client/web/src/game/combat.js makes it).
fn bullet(mg: &serde_json::Value) -> Option<tg_weapon::ProjectileDef> {
    let cal = mg["caliber_mm"].as_f64()?;
    let pen = mg["pen_mm_100m"].as_f64().unwrap_or(8.0);
    let v = serde_json::json!({
        "id": format!("bullet_{}", mg["id"].as_str()?), "name": mg["name"], "kind": "ap", "caliber_mm": cal,
        "mass_kg": mg["bullet_mass_g"].as_f64().unwrap_or(10.0) / 1000.0, "muzzle_velocity_ms": mg["muzzle_velocity_ms"].as_f64().unwrap_or(800.0),
        "explosive_mass_kg": 0.0, "explosive_type": "none", "penetrator_material": "steel", "length_mm": cal * 4.0,
        "drag_coefficient": mg["drag_coefficient"].as_f64().unwrap_or(0.3),
        "penetration_curve": [
            {"distance_m": 0.0, "pen_mm": pen * 1.1}, {"distance_m": 100.0, "pen_mm": pen},
            {"distance_m": 500.0, "pen_mm": pen * 0.55}, {"distance_m": 1000.0, "pen_mm": pen * 0.3}
        ],
        "ricochet_angle_deg": 70.0, "normalization_deg": 0.0, "fuse_delay_s": 0.0, "fuse_sensitivity_mm": 0.0
    });
    serde_json::from_value(v).ok()
}

/// Penetration of a ball round as a share of the armour-piercing round's (the data's pen_mm_100m).
pub const BALL_PEN: f32 = 0.4;

/// The round of a rifle-calibre machine gun's belt that a shot is (user report: small machine guns
/// went through the M8's 9.5 mm sides): one armour-piercing round in four, by the shot's seed, the
/// rest ball (a lead-cored bullet with ~40% of the AP round's penetration, ricocheting from 62 deg).
/// Heavy machine guns (10 mm and up) are left as their AP data. The handoff client picks it the same
/// way (beltBall in handoff/bundle/app.js.html).
pub fn belt_round(def: &tg_weapon::ProjectileDef, seed: u64) -> tg_weapon::ProjectileDef {
    if def.caliber_mm >= 10.0 || seed % 4 == 0 {
        return def.clone();
    }
    let mut b = def.clone();
    b.id = format!("{}_ball", def.id);
    b.name = format!("{} ball", def.name);
    for p in &mut b.penetration_curve {
        p.pen_mm *= BALL_PEN;
    }
    b.ricochet_angle_deg = 62.0;
    b
}

/// Loads every vehicle's armour, modules and crew, every shell and machine gun for the combat model.
pub fn load_combat(data: &Path) -> CombatData {
    let read = |p: PathBuf| std::fs::read_to_string(p).ok();
    let mats: Vec<tg_armor::Material> = read(data.join("materials.json")).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let machine_guns = read(data.join("machine_guns.json")).and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()).unwrap_or_default();
    let mut targets = HashMap::new();
    if let Ok(dir) = std::fs::read_dir(data.join("vehicles")) {
        for e in dir.flatten() {
            let d = e.path();
            let id = e.file_name().to_string_lossy().into_owned();
            let (Some(v), Some(a), Some(m), Some(c)) = (read(d.join("vehicle.json")), read(d.join("armor.json")), read(d.join("modules.json")), read(d.join("crew.json"))) else { continue };
            let (Ok(v), Ok(a), Ok(m), Ok(c)) = (serde_json::from_str::<serde_json::Value>(&v), serde_json::from_str(&a), serde_json::from_str(&m), serde_json::from_str(&c)) else { continue };
            let mut def = tg_combat::target_from_files(&id, &v, a, m, c);
            def.weapons = read(d.join("weapons.json")).and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()).unwrap_or_default();
            def.ammo_capacity = tg_combat::ammo_capacity(&def.weapons);
            def.machine_guns = machine_guns.clone();
            if let Some(v) = read(d.join("visual.json")).and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()) {
                def.visual = serde_json::json!({"mg_anchors": v["mg_anchors"], "mg_variants": v["mg_variants"]});
            }
            // triangle-surface armour (the model's own armour triangles; crates/combat/src/surface_armor.rs)
            if let Some(t) = read(d.join("surface_armor.json")) {
                match serde_json::from_str::<tg_combat::surface_armor::SurfaceArmorDef>(&t) {
                    Ok(s) => def.surfaces = Some(s),
                    Err(e) => eprintln!("{id}: surface_armor.json: {e}"),
                }
            }
            let target = tg_combat::Target::new(def, &mats);
            if let Some(e) = &target.surface_error {
                eprintln!("{id}: surface armour refused: {e}");
            }
            targets.insert(id, target);
        }
    }
    let mut projectiles = HashMap::new();
    if let Ok(dir) = std::fs::read_dir(data.join("projectiles")) {
        for e in dir.flatten() {
            if let Some(p) = read(e.path()).and_then(|t| serde_json::from_str::<tg_weapon::ProjectileDef>(&t).ok()) {
                projectiles.insert(p.id.clone(), p);
            }
        }
    }
    let mut bullets = HashMap::new();
    if let Some(list) = read(data.join("machine_guns.json")).and_then(|t| serde_json::from_str::<Vec<serde_json::Value>>(&t).ok()) {
        for mg in &list {
            if let (Some(id), Some(b)) = (mg["id"].as_str(), bullet(mg)) {
                bullets.insert(id.to_string(), b);
            }
        }
    }
    CombatData { targets, projectiles, bullets }
}

/// What the server needs from the game data: every shell's kind and filler, the vehicle ids, the
/// maps ("range" is built into the client; the rest are the folders of data/maps).
pub fn load_catalog(data: &Path) -> (HashMap<String, Shell>, HashSet<String>, Vec<String>) {
    let mut shells = HashMap::new();
    if let Ok(dir) = std::fs::read_dir(data.join("projectiles")) {
        for e in dir.flatten() {
            let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
            let (Some(id), Some(kind)) = (v["id"].as_str(), v["kind"].as_str()) else { continue };
            shells.insert(id.to_string(), Shell { kind: kind.to_string(), filler_kg: v["explosive_mass_kg"].as_f64().unwrap_or(0.0), caliber_mm: v["caliber_mm"].as_f64().unwrap_or(0.0) });
        }
    }
    let mut vehicles = HashSet::new();
    if let Ok(dir) = std::fs::read_dir(data.join("vehicles")) {
        for e in dir.flatten() {
            if e.path().join("vehicle.json").is_file() {
                vehicles.insert(e.file_name().to_string_lossy().into_owned());
            }
        }
    }
    let mut maps = vec!["range".to_string()];
    if let Ok(dir) = std::fs::read_dir(data.join("maps")) {
        let mut found: Vec<String> = dir.flatten().filter(|e| e.path().join("map.json").is_file()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        found.sort();
        maps.extend(found);
    }
    (shells, vehicles, maps)
}

/// Each vehicle's year of service (vehicle.json meta.year), for rooms limited to an era.
pub fn load_years(data: &Path) -> HashMap<String, u32> {
    let mut out = HashMap::new();
    let Ok(dir) = std::fs::read_dir(data.join("vehicles")) else { return out };
    for e in dir.flatten() {
        let Ok(text) = std::fs::read_to_string(e.path().join("vehicle.json")) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        if let Some(y) = v["meta"]["year"].as_u64() {
            out.insert(e.file_name().to_string_lossy().into_owned(), y as u32);
        }
    }
    out
}

/// Missiles, launchers, active protection systems and the maps' ground (crate::missiles).
/// The aircraft flown online (data/aircraft/aircraft.json, exported from the game by
/// handoff/tests/export_aircraft.js); None when the file is missing or unreadable.
pub fn load_aircraft(data: &Path) -> Option<crate::aircraft::AirData> {
    let text = std::fs::read_to_string(data.join("aircraft").join("aircraft.json")).ok()?;
    let mut aircraft:crate::aircraft::AirData=match serde_json::from_str(&text) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("aircraft.json: {e}");
            return None;
        }
    };
    // Exact source identities only. Ground definitions fill older catalogs;
    // the accepted aircraft catalog takes precedence for derived air rounds.
    let mut definitions=HashMap::<String,tg_weapon::ProjectileDef>::new();
    if let Ok(entries)=std::fs::read_dir(data.join("projectiles")) {
        let mut paths=entries.flatten().map(|e|e.path()).collect::<Vec<_>>();
        paths.sort();
        for path in paths {
            if path.extension().and_then(|e|e.to_str())!=Some("json") {continue;}
            if let Ok(bytes)=std::fs::read(&path) {
                if let Ok(definition)=serde_json::from_slice::<tg_weapon::ProjectileDef>(&bytes) {
                    definitions.insert(definition.id.clone(),definition);
                }
            }
        }
    }
    if let Ok(bytes)=std::fs::read(data.join("aircraft/frontline.json")) {
        if let Ok(catalog)=serde_json::from_slice::<serde_json::Value>(&bytes) {
            for (id,value) in catalog["shells"].as_object().into_iter().flatten() {
                if let Ok(definition)=serde_json::from_value::<tg_weapon::ProjectileDef>(value.clone()) {
                    if definition.id==*id {definitions.insert(id.clone(),definition);}
                }
            }
        }
    }
    aircraft.hydrate_projectiles(&definitions);
    Some(aircraft)
}

pub fn load_missiles(data: &Path) -> crate::missiles::MissileData {
    crate::missiles::load(data)
}

/// Every map's capture points (data/maps/<id>/map.json "points"): conquest on those maps.
pub fn load_points(data: &Path) -> HashMap<String, Vec<crate::lobby::CapPoint>> {
    let mut out = HashMap::new();
    let Ok(dir) = std::fs::read_dir(data.join("maps")) else { return out };
    for e in dir.flatten() {
        let Ok(text) = std::fs::read_to_string(e.path().join("map.json")) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        let Some(points) = v.get("points").and_then(|p| serde_json::from_value::<Vec<crate::lobby::CapPoint>>(p.clone()).ok()) else { continue };
        if !points.is_empty() {
            out.insert(e.file_name().to_string_lossy().into_owned(), points);
        }
    }
    out
}

/// Runs the server on `listener` until the process ends. `page`: the game's HTML file.
pub fn serve(listener: TcpListener, lobby: Lobby, page: Option<PathBuf>) -> io::Result<()> {
    let hub: Shared = Arc::new(Mutex::new(Hub { lobby, conns: HashMap::new(), clock: Instant::now(), lobby_ticks: 0, serials: 0 }));
    {
        let hub = hub.clone();
        thread::Builder::new().name("tick".into()).spawn(move || ticker(hub))?;
    }
    let page = Arc::new(page);
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let hub = hub.clone();
        let page = page.clone();
        let _ = thread::Builder::new().name("conn".into()).spawn(move || {
            let _ = connection(stream, hub, &page);
        });
    }
    Ok(())
}

fn ticker(hub: Shared) {
    let period = Duration::from_secs_f64(1.0 / TICK_HZ);
    let mut next = Instant::now() + period;
    let profiling=crate::frontline_sim::native_timing_enabled();
    let profile_origin=profiling.then(Instant::now);
    let mut profile_last=profile_origin;
    let(mut loops,mut wait_ns,mut lobby_ns,mut broadcast_ns,mut upkeep_ns)=(0u64,0u64,0u64,0u64,0u64);
    loop {
        thread::sleep(ticker_handoff(next, Instant::now()));
        let wait_start=profiling.then(Instant::now);
        let mut record=None;
        {
            let mut h = lock(&hub);
            if let Some(start)=wait_start{wait_ns+=start.elapsed().as_nanos() as u64;}
            let now = h.now();
            let started=profiling.then(Instant::now);
            let out = h.lobby.tick_at(now);
            if let Some(start)=started{lobby_ns+=start.elapsed().as_nanos() as u64;}
            let started=profiling.then(Instant::now);
            h.broadcast(out);
            if let Some(start)=started{broadcast_ns+=start.elapsed().as_nanos() as u64;}
            let started=profiling.then(Instant::now);
            // fire, crew changing seats and repairs, four times a second
            if h.lobby_ticks % 5 == 0 {
                let out = h.lobby.advance_combat(5.0 / TICK_HZ);
                h.broadcast(out);
            }
            // seats held for a reconnect that never came, once a second
            if h.lobby_ticks % 20 == 0 {
                let now = h.now();
                let out = h.lobby.sweep(now);
                h.dispatch(out);
            }
            h.lobby_ticks += 1;
            if let Some(start)=started{upkeep_ns+=start.elapsed().as_nanos() as u64;}
            if profiling {
                loops+=1;
                if profile_last.is_some_and(|last|last.elapsed()>=Duration::from_secs(1)){
                    record=Some(serde_json::json!({"kind":"native_stage_timings","wall_seconds":profile_origin.unwrap().elapsed().as_secs_f64(),"ticker":{"loops":loops,"lock_wait_ns":wait_ns,"lobby_ns":lobby_ns,"broadcast_ns":broadcast_ns,"upkeep_ns":upkeep_ns},"network":{"serialize_ns":PROFILE_SERIALIZE_NS.load(Ordering::Relaxed),"encode_ns":PROFILE_ENCODE_NS.load(Ordering::Relaxed)},"rooms":h.lobby.frontline_timing_snapshot()}));
                    profile_last=Some(Instant::now());
                }
            }
        }
        // Formatting/log I/O never holds the shared authority mutex and never
        // enters the gameplay protocol. Counters are diagnostic, cumulative ns.
        if let Some(record)=record{eprintln!("TANKFORGE_NATIVE_TIMING {record}");}
        // The mutex is dropped before any handoff. An overloaded tick used to
        // immediately reacquire it forever, starving HTTP/control/reset/Leave.
        // Preserve the20Hz target and the native fixed dt: this only gives
        // already waiting socket threads a bounded scheduling opportunity.
        next=(next+period).max(Instant::now());
    }
}

fn ticker_handoff(next:Instant,now:Instant)->Duration {
    next.checked_duration_since(now).filter(|d|!d.is_zero()).unwrap_or(Duration::from_millis(1))
}

struct Request {
    path: String,
    key: Option<String>,
    upgrade: bool,
    /// Accept-Encoding includes gzip.
    gzip: bool,
    if_none_match: Option<String>,
}

fn read_request(r: &mut BufReader<TcpStream>) -> io::Result<Request> {
    let mut line = String::new();
    let mut total = 0;
    r.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("/").to_string();
    if method != "GET" {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "only GET"));
    }
    let (mut key, mut upgrade, mut gzip, mut if_none_match) = (None, false, false, None);
    loop {
        line.clear();
        let n = r.read_line(&mut line)?;
        total += n;
        if n == 0 || total > 16 * 1024 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "bad headers"));
        }
        let l = line.trim_end();
        if l.is_empty() {
            break;
        }
        if let Some((name, value)) = l.split_once(':') {
            let (name, value) = (name.trim().to_ascii_lowercase(), value.trim());
            match name.as_str() {
                "sec-websocket-key" => key = Some(value.to_string()),
                "upgrade" => upgrade = value.eq_ignore_ascii_case("websocket"),
                "accept-encoding" => gzip = value.to_ascii_lowercase().contains("gzip"),
                "if-none-match" => if_none_match = Some(value.to_string()),
                _ => {}
            }
        }
    }
    Ok(Request { path, key, upgrade, gzip, if_none_match })
}

fn respond(s: &mut TcpStream, status: &str, kind: &str, body: &[u8]) -> io::Result<()> {
    let head = format!("HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n", body.len());
    s.write_all(head.as_bytes())?;
    s.write_all(body)?;
    s.flush()
}

/// The page to send: `<page>.gz` when the browser takes gzip and it exists (the full single-file
/// build is ~280 MB, ~60 MB compressed), otherwise the page itself.
fn page_file(page: &Path, gzip: bool) -> Option<(std::fs::File, bool)> {
    if gzip {
        let mut gz = page.as_os_str().to_owned();
        gz.push(".gz");
        if let Ok(f) = std::fs::File::open(PathBuf::from(gz)) {
            return Some((f, true));
        }
    }
    std::fs::File::open(page).ok().map(|f| (f, false))
}

/// Streams the page with an ETag (size + mtime), so a returning browser gets 304 instead of the
/// whole file again.
fn respond_page(s: &mut TcpStream, mut file: std::fs::File, gzipped: bool, if_none_match: Option<&str>) -> io::Result<()> {
    let meta = file.metadata()?;
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
    let etag = format!("\"{:x}-{:x}{}\"", meta.len(), mtime, if gzipped { "-gz" } else { "" });
    let common = format!("Content-Type: text/html; charset=utf-8\r\nETag: {etag}\r\nVary: Accept-Encoding\r\nCache-Control: no-cache\r\nConnection: close\r\n");
    if if_none_match.is_some_and(|v| v.split(',').any(|t| t.trim().trim_start_matches("W/") == etag)) {
        s.write_all(format!("HTTP/1.1 304 Not Modified\r\n{common}\r\n").as_bytes())?;
        return s.flush();
    }
    let encoding = if gzipped { "Content-Encoding: gzip\r\n" } else { "" };
    s.write_all(format!("HTTP/1.1 200 OK\r\n{common}{encoding}Content-Length: {}\r\n\r\n", meta.len()).as_bytes())?;
    io::copy(&mut file, s)?;
    s.flush()
}

fn connection(stream: TcpStream, hub: Shared, page: &Option<PathBuf>) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut out = stream;
    let req = match read_request(&mut reader) {
        Ok(r) => r,
        Err(_) => return respond(&mut out, "400 Bad Request", "text/plain; charset=utf-8", b"bad request"),
    };
    let path = req.path.split('?').next().unwrap_or("/").to_string();
    match (path.as_str(), req.upgrade, req.key) {
        ("/ws", true, Some(key)) => {
            if lock(&hub).conns.len() >= MAX_CONNECTIONS {
                return respond(&mut out, "503 Service Unavailable", "text/plain; charset=utf-8", "伺服器已滿".as_bytes());
            }
            out.write_all(ws::handshake_response(&key).as_bytes())?;
            out.set_nodelay(true)?;
            websocket(reader, out, hub)
        }
        ("/", _, _) | ("/index.html", _, _) => match page.as_ref().and_then(|p| page_file(p, req.gzip)) {
            Some((file, gzipped)) => respond_page(&mut out, file, gzipped, req.if_none_match.as_deref()),
            None => respond(&mut out, "404 Not Found", "text/plain; charset=utf-8", "沒有遊戲頁面:先在 client/web 執行 npm run build,或用 --page 指定".as_bytes()),
        },
        ("/rooms", _, _) => {
            let list = serde_json::to_string(&lock(&hub).lobby.room_list()).unwrap_or_default();
            respond(&mut out, "200 OK", "application/json", list.as_bytes())
        }
        ("/health", _, _) => respond(&mut out, "200 OK", "text/plain", b"ok"),
        ("/frontline/maps.json", _, _) => {
            let source=lock(&hub).lobby.frontline_map_options();
            match source {
                Some(json)=>respond(&mut out,"200 OK","application/json",json.as_bytes()),
                None=>respond(&mut out,"404 Not Found","text/plain",b"frontline maps unavailable"),
            }
        }
        (path, _, _) if path.starts_with("/frontline/") => {
            // Registry lookup only, never a filesystem path derived from a URL.
            let id=path.strip_prefix("/frontline/").and_then(|p|p.strip_suffix(".json"));
            let source = id.and_then(|id|lock(&hub).lobby.frontline_map(id).map(str::to_owned));
            match source {
                Some(json) => respond(&mut out, "200 OK", "application/json", json.as_bytes()),
                None => respond(&mut out, "404 Not Found", "text/plain", b"frontline map unavailable"),
            }
        }
        _ => respond(&mut out, "404 Not Found", "text/plain; charset=utf-8", b"not found"),
    }
}

#[cfg(test)]
#[path = "frontline_http_map_tests.rs"]
mod frontline_http_map_tests;

fn writer(rx: Receiver<Frame>, mut stream: TcpStream) {
    while let Ok(frame) = rx.recv() {
        if ws::write_all(&mut stream, &frame).is_err() {
            break;
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
}

fn websocket(mut reader: BufReader<TcpStream>, stream: TcpStream, hub: Shared) -> io::Result<()> {
    // Windows cloned sockets retain their own receive timeout. Apply the
    // established-session policy to the handle that actually reads frames.
    reader.get_ref().set_read_timeout(Some(IDLE))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let (tx, rx) = sync_channel::<Frame>(crate::gameplay::socket_queue_capacity());
    let (mut id, serial) = {
        let mut h = lock(&hub);
        // Hello is the only welcome. A placeholder welcome could resolve a reconnect before
        // the replacement's rules capability and seat transfer have been accepted.
        let (id, _) = h.lobby.connect();
        h.serials += 1;
        let serial = h.serials;
        h.conns.insert(id, Conn { tx: tx.clone(), stream: stream.try_clone()?, serial, frontline_wire: None });
        (id, serial)
    };
    let w = stream.try_clone()?;
    let writer_thread = thread::Builder::new().name("write".into()).spawn(move || writer(rx, w))?;
    // A leaky bucket: the room's policy messages/second, bursts up to one second's worth.
    let mut bucket = lock(&hub).lobby.socket_rate(id);
    let mut last = Instant::now();
    let result = loop {
        let msg = match ws::read_message(&mut reader, true) {
            Ok(m) => m,
            Err(e) => break Err(e),
        };
        let t = Instant::now();
        let rate = lock(&hub).lobby.socket_rate(id);
        bucket = (bucket + (t - last).as_secs_f64() * rate).min(rate);
        last = t;
        match msg {
            ws::Incoming::Text(text) => {
                if bucket < 1.0 {
                    continue;
                }
                bucket -= 1.0;
                let mut h = lock(&hub);
                match serde_json::from_str::<ClientMsg>(&text) {
                    Ok(m) => {
                        let wire=match requested_frontline_wire(&text,&m){
                            Ok(version)=>version,
                            Err(error)=>{h.dispatch(vec![(id,ServerMsg::Error{msg:error.into()})]);continue;},
                        };
                        if matches!(&m,ClientMsg::FrontlineWireReset{..})&&!h.conns.get(&id).is_some_and(|c|c.frontline_wire.is_some()){
                            h.dispatch(vec![(id,ServerMsg::Error{msg:"Frontline wire2 was not negotiated".into()})]);continue;
                        }
                        let now = h.now();
                        let (seat, out) = h.lobby.dispatch_socket(id, m, now);
                        if seat != id {
                            if let Some(c) = h.conns.remove(&id) {
                                if let Some(prev) = h.conns.insert(seat, c) {
                                    let _ = prev.stream.shutdown(Shutdown::Both);
                                }
                            }
                            id = seat;
                        }
                        if let Some(version)=wire {
                            if out.iter().any(|(to,message)|*to==id&&matches!(message,ServerMsg::Welcome{..})){
                                h.negotiate_frontline_wire(id,version);
                            }
                        }
                        h.dispatch(out);
                    }
                    Err(_) => h.dispatch(vec![(id, ServerMsg::Error { msg: "看不懂的訊息".into() })]),
                }
            }
            ws::Incoming::Ping(p) => {
                let _ = tx.try_send(Arc::new(ws::encode(0xA, &p)));
            }
            ws::Incoming::Close => {
                let _ = tx.try_send(Arc::new(ws::encode(0x8, &[])));
                break Ok(());
            }
            ws::Incoming::Other => {}
        }
    };
    {
        let mut h = lock(&hub);
        // only if the seat is still this socket's (not taken over by a reconnect)
        if h.conns.get(&id).is_some_and(|c| c.serial == serial) {
            h.conns.remove(&id);
            let now = h.now();
            let out = h.lobby.drop_link(id, now);
            h.dispatch(out);
        }
    }
    drop(tx);
    let _ = writer_thread.join();
    let _ = stream.shutdown(Shutdown::Both);
    result
}

#[cfg(test)]
mod belt_tests {
    use super::*;

    #[test]
    fn rifle_belts_are_one_ap_round_in_four_and_heavy_guns_stay_ap() {
        let rifle = bullet(&serde_json::json!({"id": "mg34", "name": "MG 34", "caliber_mm": 7.92, "pen_mm_100m": 10.0})).unwrap();
        let heavy = bullet(&serde_json::json!({"id": "m2hb", "name": "M2HB", "caliber_mm": 12.7, "pen_mm_100m": 22.0})).unwrap();
        let rounds: Vec<_> = (0..8u64).map(|s| belt_round(&rifle, s)).collect();
        assert_eq!(rounds.iter().filter(|r| r.id == "bullet_mg34").count(), 2);
        let ball = rounds.iter().find(|r| r.id == "bullet_mg34_ball").unwrap();
        // ball: 4 mm at 100 m, under the M8's 9.5 mm sides (the AP round's 10 mm is not)
        assert!((ball.pen_at(100.0) - 4.0).abs() < 1e-4 && ball.ricochet_angle_deg == 62.0);
        assert!((0..8u64).all(|s| belt_round(&heavy, s).id == "bullet_m2hb"));
    }
}

#[cfg(test)]
mod aircraft_fuze_loader_tests {
    use super::*;
    use serde_json::{json,Value};
    static FIXTURE:AtomicU64=AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let temp=std::env::temp_dir();
            assert_eq!(self.0.parent(),Some(temp.as_path()));
            assert!(self.0.file_name().unwrap().to_string_lossy().starts_with("tankforge-air-fuze-"));
            let _=std::fs::remove_dir_all(&self.0);
        }
    }
    fn fixture(from_air_catalog:bool)->(Fixture,String) {
        let root=std::env::temp_dir().join(format!("tankforge-air-fuze-{}-{}",
            std::process::id(),FIXTURE.fetch_add(1,Ordering::Relaxed)));
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(root.join("aircraft")).unwrap();
        let source=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let (id,projectile)=if from_air_catalog {
            let catalog:Value=serde_json::from_slice(&std::fs::read(source.join("aircraft/frontline.json")).unwrap()).unwrap();
            ("ap_50_mk214a".to_string(),catalog["shells"]["ap_50_mk214a"].clone())
        } else {
            let projectile:Value=serde_json::from_slice(&std::fs::read(source.join("projectiles/apc_50_pzgr39.json")).unwrap()).unwrap();
            (projectile["id"].as_str().unwrap().to_string(),projectile)
        };
        let mut legacy=json!({"types":{},"shells":{}});
        legacy["shells"][&id]=json!({"mass_kg":2.06,"speed_ms":835,"filler_kg":0.02822,
            "caliber_mm":50,"incendiary":true});
        std::fs::write(root.join("aircraft/aircraft.json"),serde_json::to_vec(&legacy).unwrap()).unwrap();
        if from_air_catalog {
            let mut catalog=json!({"shells":{}});catalog["shells"][&id]=projectile;
            std::fs::write(root.join("aircraft/frontline.json"),serde_json::to_vec(&catalog).unwrap()).unwrap();
        } else {
            std::fs::create_dir(root.join("projectiles")).unwrap();
            std::fs::write(root.join("projectiles").join(format!("{id}.json")),serde_json::to_vec(&projectile).unwrap()).unwrap();
        }
        (Fixture(root),id)
    }
    #[test]
    fn aircraft_fuze_loader_recovers_exact_mk214_metadata_from_air_catalog() {
        let (fixture,id)=fixture(true);
        let data=load_aircraft(&fixture.0).unwrap();let shell=&data.shells[&id];
        assert_eq!(shell.kind,Some(tg_weapon::ProjectileKind::Apcbc));
        assert!((shell.explosive_mass_kg.unwrap()-0.017).abs()<1e-8);
        assert_eq!(shell.explosive_type.as_deref(),Some("petn"));
        assert!((shell.fuse_delay_s.unwrap()-0.0024).abs()<1e-8);
        assert_eq!(shell.fuse_sensitivity_mm,Some(15.0));
        assert_eq!(shell.filler_kg,0.02822);
    }
    #[test]
    fn aircraft_fuze_loader_uses_exact_ground_projectile_fallback() {
        let (fixture,id)=fixture(false);
        let data=load_aircraft(&fixture.0).unwrap();let shell=&data.shells[&id];
        assert_eq!(shell.kind,Some(tg_weapon::ProjectileKind::Apcbc));
        assert!((shell.explosive_mass_kg.unwrap()-0.017).abs()<1e-8);
        assert_eq!(shell.filler_kg,0.02822);
    }
}
