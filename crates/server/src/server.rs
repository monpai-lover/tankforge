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
use std::thread;
use std::time::{Duration, Instant};

pub const TICK_HZ: f64 = 20.0;
/// More connections than this are turned away.
const MAX_CONNECTIONS: usize = 256;
/// Frames queued for one client before it counts as too slow to keep.
const QUEUE: usize = 512;
/// Messages a client may send per second (states at 20 Hz, shots, hits and pings fit easily,
/// an automatic gun's rounds and hits included).
const RATE: f64 = 240.0;
/// A client silent this long is gone (the game pings every few seconds).
const IDLE: Duration = Duration::from_secs(30);

type Frame = Arc<Vec<u8>>;

struct Conn {
    tx: SyncSender<Frame>,
    stream: TcpStream,
    /// Which socket this is: after a resume the player's id points at a newer one, and the old
    /// socket's reader must not tear the player down when it finally notices it is closed.
    serial: u64,
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
            if let Ok(json) = serde_json::to_string(&msg) {
                self.send(to, Arc::new(ws::text(&json)));
            }
        }
    }

    fn broadcast(&mut self, out: Broadcast) {
        for (to, msg) in out {
            let Ok(json) = serde_json::to_string(&msg) else { continue };
            let frame = Arc::new(ws::text(&json));
            for id in to {
                self.send(id, frame.clone());
            }
        }
    }
}

type Shared = Arc<Mutex<Hub>>;

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
            targets.insert(id, tg_combat::Target::new(def, &mats));
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
    loop {
        let now = Instant::now();
        if next > now {
            thread::sleep(next - now);
        }
        next += period;
        if next < Instant::now() {
            next = Instant::now() + period;
        }
        let mut h = lock(&hub);
        let out = h.lobby.tick();
        h.broadcast(out);
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
    }
}

struct Request {
    path: String,
    key: Option<String>,
    upgrade: bool,
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
    let (mut key, mut upgrade) = (None, false);
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
                _ => {}
            }
        }
    }
    Ok(Request { path, key, upgrade })
}

fn respond(s: &mut TcpStream, status: &str, kind: &str, body: &[u8]) -> io::Result<()> {
    let head = format!("HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n", body.len());
    s.write_all(head.as_bytes())?;
    s.write_all(body)?;
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
        ("/", _, _) | ("/index.html", _, _) => match page.as_ref().map(std::fs::read) {
            Some(Ok(html)) => respond(&mut out, "200 OK", "text/html; charset=utf-8", &html),
            _ => respond(&mut out, "404 Not Found", "text/plain; charset=utf-8", "沒有遊戲頁面:先在 client/web 執行 npm run build,或用 --page 指定".as_bytes()),
        },
        ("/rooms", _, _) => {
            let list = serde_json::to_string(&lock(&hub).lobby.room_list()).unwrap_or_default();
            respond(&mut out, "200 OK", "application/json", list.as_bytes())
        }
        ("/health", _, _) => respond(&mut out, "200 OK", "text/plain", b"ok"),
        _ => respond(&mut out, "404 Not Found", "text/plain; charset=utf-8", b"not found"),
    }
}

fn writer(rx: Receiver<Frame>, mut stream: TcpStream) {
    while let Ok(frame) = rx.recv() {
        if ws::write_all(&mut stream, &frame).is_err() {
            break;
        }
    }
    let _ = stream.shutdown(Shutdown::Both);
}

fn websocket(mut reader: BufReader<TcpStream>, stream: TcpStream, hub: Shared) -> io::Result<()> {
    stream.set_read_timeout(Some(IDLE))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let (tx, rx) = sync_channel::<Frame>(QUEUE);
    let (mut id, serial) = {
        let mut h = lock(&hub);
        let (id, out) = h.lobby.connect();
        h.serials += 1;
        let serial = h.serials;
        h.conns.insert(id, Conn { tx: tx.clone(), stream: stream.try_clone()?, serial });
        h.dispatch(out);
        (id, serial)
    };
    let w = stream.try_clone()?;
    let writer_thread = thread::Builder::new().name("write".into()).spawn(move || writer(rx, w))?;
    // a leaky bucket: RATE messages a second, bursts up to one second's worth
    let mut bucket = RATE;
    let mut last = Instant::now();
    let result = loop {
        let msg = match ws::read_message(&mut reader, true) {
            Ok(m) => m,
            Err(e) => break Err(e),
        };
        let t = Instant::now();
        bucket = (bucket + (t - last).as_secs_f64() * RATE).min(RATE);
        last = t;
        match msg {
            ws::Incoming::Text(text) => {
                if bucket < 1.0 {
                    continue;
                }
                bucket -= 1.0;
                let mut h = lock(&hub);
                match serde_json::from_str::<ClientMsg>(&text) {
                    // a reconnect: this socket takes over the held seat and its id
                    Ok(ClientMsg::Hello { name, resume: Some(token) }) => {
                        let now = h.now();
                        match h.lobby.resume(id, &token, now) {
                            Some((old, out)) => {
                                if let Some(c) = h.conns.remove(&id) {
                                    // a stale socket still registered for the seat is closed
                                    if let Some(prev) = h.conns.insert(old, c) {
                                        let _ = prev.stream.shutdown(Shutdown::Both);
                                    }
                                }
                                id = old;
                                h.dispatch(out);
                            }
                            None => {
                                let out = h.lobby.handle(id, ClientMsg::Hello { name, resume: None }, now);
                                h.dispatch(out);
                            }
                        }
                    }
                    Ok(m) => {
                        let now = h.now();
                        let out = h.lobby.handle(id, m, now);
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
