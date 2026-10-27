//! Genuine TCP/WebSocket audiences across a trusted cfg(test)-only short round.
//! This proves lifecycle/transport rules, never a 45-minute endurance budget.
use super::*;
use crate::frontline_wire::{FrameDecoder, FrameHeader, MAX_FRAME_BYTES};
use serde_json::{json, Value};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver};

const ROUND: f64 = 6.0;
const INTERMISSION: f64 = 1.0;
#[derive(Default)]
struct Trace {
    records: Vec<Value>,
}
type Recorded = Arc<Mutex<Trace>>;
struct FailureTraceGuard(Recorded);
impl Drop for FailureTraceGuard {
    fn drop(&mut self) {
        if !std::thread::panicking() { return; }
        let suffix = format!("failure-{}-{}.json", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
        let path = std::env::var_os("TANKFORGE_ROUND_SOCKET_TRACE")
            .map(PathBuf::from).map(|p|p.with_extension(&suffix))
            .unwrap_or_else(||std::env::temp_dir().join(format!("tankforge-round-socket-{suffix}")));
        let result = (|| -> io::Result<()> {
            if let Some(parent) = path.parent() { std::fs::create_dir_all(parent)?; }
            let trace = self.0.lock().unwrap_or_else(|e|e.into_inner());
            let value = json!({"schemaVersion":1,"scope":"Failed native socket acceptance diagnostics","records":trace.records});
            let bytes = serde_json::to_vec(&value)?;
            std::fs::OpenOptions::new().write(true).create_new(true).open(&path)?.write_all(&bytes)
        })();
        eprintln!("round socket failure trace {}: {result:?}", path.display());
    }
}
fn record(
    trace: &Recorded,
    start: Instant,
    peer: &str,
    direction: &str,
    text: Option<&str>,
    binary: Option<&[u8]>,
    kind: Option<&str>,
) {
    let mut trace = trace.lock().unwrap();
    let seq = trace.records.len() + 1;
    let mut v =
        json!({"seq":seq,"at_s":start.elapsed().as_secs_f64(),"peer":peer,"direction":direction});
    if let Some(text) = text {
        v["text"] = json!(text);
    }
    if let Some(bytes) = binary {
        v["binary_base64"] = json!(ws::base64(bytes));
    }
    if let Some(kind) = kind {
        v["kind"] = json!(kind);
    }
    trace.records.push(v);
}
struct Packet {
    value: Value,
    header: Option<FrameHeader>,
}
impl Packet {
    fn message(&self) -> &Value {
        &self.value["message"]
    }
}
struct Peer {
    name: String,
    stream: TcpStream,
    rx: Receiver<Packet>,
    reader: Option<thread::JoinHandle<()>>,
    pending: Vec<Packet>,
    trace: Recorded,
    start: Instant,
    id: u32,
    wire: u32,
}
fn masked(opcode: u8, bytes: &[u8]) -> Vec<u8> {
    let mut out = vec![0x80 | opcode];
    let n = bytes.len();
    if n < 126 {
        out.push(0x80 | n as u8);
    } else if n < 65536 {
        out.push(0x80 | 126);
        out.extend((n as u16).to_be_bytes());
    } else {
        out.push(0x80 | 127);
        out.extend((n as u64).to_be_bytes());
    }
    let mask = [0x63, 0x2c, 0x91, 0x08];
    out.extend(mask);
    out.extend(bytes.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
    out
}
fn read_server_frame(reader: &mut BufReader<TcpStream>) -> io::Result<(u8, Vec<u8>)> {
    let mut h = [0u8; 2];
    reader.read_exact(&mut h)?;
    if h[0] & 0x80 == 0 || h[1] & 0x80 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "unexpected server WS framing",
        ));
    }
    let length = match h[1] & 127 {
        126 => {
            let mut n = [0; 2];
            reader.read_exact(&mut n)?;
            u16::from_be_bytes(n) as usize
        }
        127 => {
            let mut n = [0; 8];
            reader.read_exact(&mut n)?;
            usize::try_from(u64::from_be_bytes(n))
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "WS length"))?
        }
        n => n as usize,
    };
    if length > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("oversized server frame: {length} bytes exceeds {MAX_FRAME_BYTES}"),
        ));
    }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes)?;
    Ok((h[0] & 15, bytes))
}
impl Peer {
    fn connect(
        address: std::net::SocketAddr,
        name: &str,
        wire: u32,
        trace: Recorded,
        start: Instant,
    ) -> Self {
        let mut stream = TcpStream::connect(address).unwrap();
        stream.set_nodelay(true).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(12)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        stream.write_all(b"GET /ws HTTP/1.1\r\nHost:localhost\r\nUpgrade:websocket\r\nConnection:Upgrade\r\nSec-WebSocket-Version:13\r\nSec-WebSocket-Key:dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n").unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut header = Vec::new();
        while !header.ends_with(b"\r\n\r\n") {
            let mut b = [0];
            reader.read_exact(&mut b).unwrap();
            header.push(b[0]);
            assert!(header.len() < 8192);
        }
        assert!(header.starts_with(b"HTTP/1.1 101"));
        record(
            &trace,
            start,
            name,
            "received",
            None,
            None,
            Some("socket_open"),
        );
        let (tx, rx) = channel();
        let label = name.to_owned();
        let log = trace.clone();
        let worker = thread::spawn(move || {
            let mut decoder = FrameDecoder::default();
            loop {
                let (opcode, bytes) = match read_server_frame(&mut reader) {
                    Ok(frame) => frame,
                    Err(error) => {
                        record(&log,start,&label,"received",None,None,
                            Some(&format!("socket_read_error:{:?}:{error}",error.kind())));
                        break;
                    }
                };
                let (value, header) = match opcode {
                    1 => {
                        let text = String::from_utf8(bytes).unwrap();
                        record(&log, start, &label, "received", Some(&text), None, None);
                        (serde_json::from_str(&text).unwrap(), None)
                    }
                    2 => {
                        record(&log, start, &label, "received", None, Some(&bytes), None);
                        let header = FrameHeader::read(&bytes).unwrap();
                        let frame = decoder.decode(&bytes).unwrap();
                        (
                            json!({"t":"frontline","version":1,"message":frame}),
                            Some(header),
                        )
                    }
                    8 => {
                        let code = bytes.get(..2).map(|n|u16::from_be_bytes([n[0],n[1]]));
                        record(&log,start,&label,"received",None,None,
                            Some(&format!("server_close:{code:?}:{}",String::from_utf8_lossy(bytes.get(2..).unwrap_or_default()))));
                        break;
                    }
                    _ => continue,
                };
                if tx.send(Packet { value, header }).is_err() {
                    break;
                }
            }
            record(
                &log,
                start,
                &label,
                "received",
                None,
                None,
                Some("socket_close"),
            );
        });
        let mut peer = Self {
            name: name.into(),
            stream,
            rx,
            reader: Some(worker),
            pending: Vec::new(),
            trace,
            start,
            id: 0,
            wire,
        };
        let mut hello =
            json!({"t":"hello","name":name,"gameplay_rules_version":2,"ammo_protocol_version":1});
        if wire == 2 {
            hello["frontline_wire_version"] = json!(2);
        }
        peer.send(hello);
        let welcome = peer.wait(|p| p.value["t"] == "welcome");
        peer.id = welcome.value["id"].as_u64().unwrap() as u32;
        if wire == 2 {
            assert_eq!(welcome.value["frontline_wire_version"], 2);
            assert!(welcome.value["frontline_wire_stream"].is_string());
        }
        peer
    }
    fn send(&mut self, value: Value) {
        let text = serde_json::to_string(&value).unwrap();
        record(
            &self.trace,
            self.start,
            &self.name,
            "sent",
            Some(&text),
            None,
            None,
        );
        self.stream.write_all(&masked(1, text.as_bytes())).unwrap();
    }
    fn command(&mut self, command: Value) {
        self.send(json!({"t":"frontline","version":1,"command":command}));
    }
    fn wait(&mut self, predicate: impl Fn(&Packet) -> bool) -> Packet {
        if let Some(i) = self.pending.iter().position(&predicate) {
            return self.pending.remove(i);
        }
        let deadline = Instant::now() + Duration::from_secs(18);
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            assert!(
                !remaining.is_zero(),
                "{} expected packet timeout; pending={:?}",
                self.name, self.pending_summary()
            );
            let packet = self
                .rx
                .recv_timeout(remaining)
                .unwrap_or_else(|error| {
                    let recent = self.trace.lock().unwrap().records.iter().rev()
                        .filter_map(|row|row["kind"].as_str().map(str::to_owned)).take(12).collect::<Vec<_>>();
                    panic!("{} socket receive {error:?}; pending={:?}; recent transport={recent:?}",
                        self.name,self.pending_summary());
                });
            if predicate(&packet) {
                return packet;
            }
            assert!(
                !(packet.value["t"] == "error" || packet.message()["op"] == "error"),
                "{} unexpected error: {}",
                self.name,
                packet.value
            );
            self.pending.push(packet);
        }
    }
    fn pending_summary(&self) -> Vec<String> {
        self.pending.iter().rev().take(16).map(|packet|format!("t={} op={} battle={} tick={} round={}",
            packet.value["t"],packet.message()["op"],packet.message()["battle"],
            packet.message()["tick"],packet.message()["room"]["round_state"])).collect()
    }
    fn op(&mut self, op: &str, predicate: impl Fn(&Value) -> bool) -> Packet {
        self.wait(|p| {
            p.value["t"] == "frontline" && p.message()["op"] == op && predicate(p.message())
        })
    }
    fn error(&mut self) {
        self.op("error", |_| true);
    }
    fn close(&mut self) {
        let _ = self.stream.write_all(&masked(8, &[]));
        let _ = self.stream.shutdown(Shutdown::Both);
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        self.close();
    }
}
struct Server {
    address: std::net::SocketAddr,
    shared: Shared,
    stop: Arc<AtomicBool>,
    ticker: Option<thread::JoinHandle<()>>,
    accept: Option<thread::JoinHandle<()>>,
}
impl Server {
    fn new(trace: Recorded, started: Instant) -> Self {
        let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let mut lobby = Lobby::new(Default::default(), Default::default(), vec![])
            .with_frontline(&data)
            .unwrap();
        lobby.use_frontline_c2_scene_for_test().unwrap();
        lobby
            .set_frontline_round_timing_for_test(ROUND, INTERMISSION)
            .unwrap();
        let shared = Arc::new(Mutex::new(Hub {
            lobby,
            conns: HashMap::new(),
            clock: Instant::now(),
            lobby_ticks: 0,
            serials: 0,
        }));
        let stop = Arc::new(AtomicBool::new(false));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let connections = {
            let h = shared.clone();
            let stop = stop.clone();
            thread::spawn(move || {
                let mut workers = Vec::new();
                while !stop.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((s, _)) => {
                            // Windows inherits the test listener's nonblocking
                            // flag; production sockets use blocking reads.
                            s.set_nonblocking(false).unwrap();
                            let h = h.clone();
                            let trace = trace.clone();
                            workers.push(thread::spawn(move || {
                                let peer = format!("server:{}",s.peer_addr().map(|p|p.to_string()).unwrap_or_default());
                                let result = connection(s, h, &None);
                                record(&trace,started,&peer,"server",None,None,
                                    Some(&format!("connection_exit:{result:?}")));
                            }));
                        }
                        Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(2))
                        }
                        Err(e) => panic!("accept: {e}"),
                    }
                }
                for worker in workers {
                    worker.join().unwrap();
                }
            })
        };
        let ticker = {
            let shared = shared.clone();
            let stop = stop.clone();
            thread::spawn(move || {
                let period = Duration::from_millis(50);
                let mut next = Instant::now() + period;
                while !stop.load(Ordering::Relaxed) {
                    thread::sleep(ticker_handoff(next, Instant::now()));
                    {
                        let mut h = lock(&shared);
                        let now = h.now();
                        let out = h.lobby.tick_at(now);
                        h.broadcast(out);
                        if h.lobby_ticks % 5 == 0 {
                            let out = h.lobby.advance_combat(0.25);
                            h.broadcast(out);
                        }
                        if h.lobby_ticks % 20 == 0 {
                            let now = h.now();
                            let out = h.lobby.sweep(now);
                            h.dispatch(out);
                        }
                        h.lobby_ticks += 1;
                    }
                    next = (next + period).max(Instant::now());
                }
            })
        };
        Self {
            address,
            shared,
            stop,
            ticker: Some(ticker),
            accept: Some(connections),
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        for c in lock(&self.shared).conns.values() {
            let _ = c.stream.shutdown(Shutdown::Both);
        }
        if let Some(t) = self.ticker.take() {
            let _ = t.join();
        }
        if let Some(t) = self.accept.take() {
            let _ = t.join();
        }
    }
}
fn member<'a>(message: &'a Value, id: u32) -> &'a Value {
    message["room"]["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["player"] == id)
        .unwrap()
}
fn controlled(message: &Value, id: u32) -> Value {
    member(message, id)["controlled"].clone()
}
fn find_unit<'a>(message: &'a Value, reference: &Value, air: bool) -> Option<&'a Value> {
    message[if air { "aircrafts" } else { "units" }]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["unit"] == *reference)
}
fn unit<'a>(message: &'a Value, reference: &Value, air: bool) -> &'a Value {
    find_unit(message, reference, air).unwrap()
}
fn ammo_air(unit: &Value) -> u64 {
    unit["guns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["ammo"].as_u64().unwrap())
        .sum()
}
fn source_inputs() -> Vec<Value> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    [
        "crates/server/src/frontline.rs",
        "crates/server/src/frontline_air.rs",
        "crates/server/src/frontline_sim.rs",
        "crates/server/src/server.rs",
        "crates/server/src/lobby.rs",
        "crates/server/src/frontline_round_socket_tests.rs",
        "handoff/tools/frontline_wire.js",
        "data/frontline/korea.json",
        "data/aircraft/frontline.json",
    ]
    .into_iter()
    .map(|path| {
        let bytes = std::fs::read(root.join(path)).unwrap();
        json!({"path":path,"sha256":tg_combat::geometry::manifest::sha256(&bytes)})
    })
    .collect()
}

#[test]
fn actual_three_socket_round_reset_replaces_world_preserves_audiences_and_rejects_old_inputs() {
    let inputs = source_inputs();
    let start = Instant::now();
    let trace = Arc::new(Mutex::new(Trace::default()));
    let _failure_trace = FailureTraceGuard(trace.clone());
    let server = Server::new(trace.clone(), start);
    let mut observer = Peer::connect(server.address, "observer", 1, trace.clone(), start);
    let mut blue = Peer::connect(server.address, "blue", 2, trace.clone(), start);
    let mut red = Peer::connect(server.address, "red", 2, trace.clone(), start);
    let blue_id = blue.id;
    let red_id = red.id;
    observer.command(json!({"op":"create","name":"Round lifecycle TCP fixture","map":"korea","observer":true,"era":1986}));
    let created = observer.op("snapshot", |_| true);
    let room = created.message()["room"]["id"].as_u64().unwrap();
    for (peer, team) in [(&mut blue, "blue"), (&mut red, "red")] {
        peer.command(json!({"op":"join","room":room,"observer":false,"team":team}));
        peer.op("snapshot", |_| true);
    }
    observer.command(json!({"op":"start"}));
    let begun = observer.op("snapshot", |m| m["room"]["started"] == true);
    let old_battle = begun.message()["room"]["battle"].as_u64().unwrap();
    let old_round = begun.message()["room"]["round_number"].as_u64().unwrap();
    blue.command(json!({"op":"deploy","vehicle":"su_t72a"}));
    let deployed = blue.op("snapshot", |m| member(m, blue_id)["controlled"].is_object());
    let old_blue_company = member(deployed.message(), blue_id)["company"].clone();
    blue.command(json!({"op":"return"}));
    blue.op("snapshot", |m| member(m, blue_id)["controlled"].is_null());
    blue.command(json!({"op":"deploy_air","aircraft":"su25","spawn":"air","loadout":0}));
    let air = blue.op("snapshot", |m| member(m, blue_id)["controlled"].is_object());
    let old_blue = controlled(air.message(), blue_id);
    let blue_epoch = member(air.message(), blue_id)["epoch"].as_u64().unwrap();
    let blue_stock = ammo_air(unit(air.message(), &old_blue, true));
    blue.command(json!({"op":"air_input","unit":old_blue,"epoch":blue_epoch,"seq":700,"aim":[0,0.03,1],"throttle":0.8,"manual_pitch":0,"manual_roll":0,"manual_yaw":0,"flags":1,"fire":true,"release":false}));
    red.command(json!({"op":"deploy","vehicle":"su_t72a"}));
    let tank = red.op("snapshot", |m| member(m, red_id)["controlled"].is_object());
    let old_red = controlled(tank.message(), red_id);
    let red_epoch = member(tank.message(), red_id)["epoch"].as_u64().unwrap();
    let old_red_company = member(tank.message(), red_id)["company"].clone();
    let red_stock = unit(tank.message(), &old_red, false)["ammo"]
        .as_u64()
        .unwrap();
    red.command(json!({"op":"input","unit":old_red,"epoch":red_epoch,"seq":700,"throttle":0,"steer":0,"brake":1,"turret_yaw":0,"gun_pitch":0.2,"fire":true}));
    blue.op("frame", |m| {
        m["battle"] == old_battle
            && find_unit(m, &old_blue, true).is_some_and(|u| ammo_air(u) < blue_stock)
    });
    red.op("frame", |m| {
        m["battle"] == old_battle
            && find_unit(m, &old_red, false)
                .is_some_and(|u| u["ammo"].as_u64().unwrap() < red_stock)
    });
    let mut endings = Vec::new();
    for peer in [&mut observer, &mut blue, &mut red] {
        let ended = peer.op("ended", |m| m["battle"] == old_battle);
        assert_eq!(ended.message()["reason"], "time");
        endings.push(ended.value);
    }
    observer.command(json!({"op":"snapshot"}));
    let interval = observer.op("snapshot", |m| m["room"]["round_state"] == "intermission");
    let old_elapsed = interval.message()["room"]["round_elapsed_s"]
        .as_f64()
        .unwrap();
    assert!(old_elapsed >= ROUND && old_elapsed < ROUND + 0.1);
    assert!(interval.message()["room"]["next_round_s"].as_f64().unwrap() > 0.0);
    assert_eq!(interval.message()["room"]["result"]["battle"], old_battle);
    red.command(json!({"op":"deploy","vehicle":"su_t72a"}));
    red.error();
    let mut reset_snapshots = Vec::new();
    for peer in [&mut observer, &mut blue, &mut red] {
        let reset = peer.op("snapshot", |m| {
            m["room"]["battle"]
                .as_u64()
                .is_some_and(|b| b != old_battle)
        });
        let m = reset.message();
        assert_eq!(m["room"]["id"], room);
        assert_eq!(m["room"]["map"], "korea");
        assert_eq!(m["room"]["era"], 1986);
        assert_eq!(m["room"]["round_number"], old_round + 1);
        assert_eq!(m["room"]["round_state"], "battle");
        assert!(m["room"]["result"].is_null());
        let mine = member(m, peer.id);
        assert!(
            mine["controlled"].is_null() && mine["company"].is_null() && mine["connected"] == true
        );
        assert_eq!(mine["observer"], peer.name == "observer");
        reset_snapshots.push(reset.value);
    }
    let new_battle = reset_snapshots[0]["message"]["room"]["battle"]
        .as_u64()
        .unwrap();
    assert_ne!(new_battle, old_battle);
    for peer in [&mut observer, &mut blue, &mut red] {
        let first = peer.op("frame", |m| m["battle"] == new_battle);
        assert!(first.message()["tick"].as_u64().unwrap() < 10);
        if peer.wire == 2 {
            assert!(first.header.unwrap().full);
        }
    }
    assert_eq!(
        member(&reset_snapshots[1]["message"], blue_id)["team"],
        "blue"
    );
    assert_eq!(
        member(&reset_snapshots[2]["message"], red_id)["team"],
        "red"
    );
    assert!(
        member(&reset_snapshots[1]["message"], blue_id)["epoch"]
            .as_u64()
            .unwrap()
            > blue_epoch
    );
    assert!(
        member(&reset_snapshots[2]["message"], red_id)["epoch"]
            .as_u64()
            .unwrap()
            > red_epoch
    );
    red.command(json!({"op":"deploy","vehicle":"su_t72a"}));
    let fresh = red.op("snapshot", |m| {
        m["room"]["battle"] == new_battle && member(m, red_id)["controlled"].is_object()
    });
    let new_red = controlled(fresh.message(), red_id);
    let new_red_epoch = member(fresh.message(), red_id)["epoch"].as_u64().unwrap();
    assert_eq!(unit(fresh.message(), &new_red, false)["ammo"], red_stock);
    assert_ne!(member(fresh.message(), red_id)["company"], old_red_company);
    blue.command(json!({"op":"deploy_air","aircraft":"su25","spawn":"air","loadout":0}));
    let fresh = blue.op("snapshot", |m| {
        m["room"]["battle"] == new_battle && member(m, blue_id)["controlled"].is_object()
    });
    let new_blue = controlled(fresh.message(), blue_id);
    let new_blue_epoch = member(fresh.message(), blue_id)["epoch"].as_u64().unwrap();
    assert_eq!(ammo_air(unit(fresh.message(), &new_blue, true)), blue_stock);
    red.command(json!({"op":"input","unit":old_red,"epoch":red_epoch,"seq":701,"throttle":1,"steer":1,"brake":0,"turret_yaw":0,"gun_pitch":0.2,"fire":true}));
    red.error();
    red.command(json!({"op":"order","company":old_red_company,"platoons":[0,1,2],"kind":"attack","target":[0,0],"seq":701}));
    red.error();
    blue.command(json!({"op":"air_input","unit":old_blue,"epoch":blue_epoch,"seq":701,"aim":[0,0,1],"throttle":1,"manual_pitch":0,"manual_roll":0,"manual_yaw":0,"flags":1,"fire":true,"release":true}));
    blue.error();
    observer.command(json!({"op":"deploy","vehicle":"su_t72a"}));
    observer.error();
    red.command(json!({"op":"input","unit":new_red,"epoch":new_red_epoch,"seq":1,"throttle":0,"steer":0,"brake":1,"turret_yaw":0,"gun_pitch":0.2,"fire":false}));
    red.command(json!({"op":"snapshot"}));
    let red_after = red.op("snapshot", |m| member(m, red_id)["controlled"] == new_red);
    assert_eq!(
        unit(red_after.message(), &new_red, false)["ammo"],
        red_stock
    );
    blue.command(json!({"op":"air_input","unit":new_blue,"epoch":new_blue_epoch,"seq":1,"aim":[0,0,1],"throttle":0.7,"manual_pitch":0,"manual_roll":0,"manual_yaw":0,"flags":1,"fire":false,"release":false}));
    blue.command(json!({"op":"snapshot"}));
    let blue_after = blue.op("snapshot", |m| member(m, blue_id)["controlled"] == new_blue);
    assert_eq!(
        ammo_air(unit(blue_after.message(), &new_blue, true)),
        blue_stock
    );
    for peer in [&mut observer, &mut blue, &mut red] {
        peer.command(json!({"op":"leave"}));
        peer.op("left", |_| true);
        peer.close();
    }
    assert_eq!(
        source_inputs(),
        inputs,
        "Sources changed during native socket acceptance"
    );
    if let Ok(path) = std::env::var("TANKFORGE_ROUND_SOCKET_TRACE") {
        let executable = std::env::current_exe().unwrap();
        let bytes = std::fs::read(&executable).unwrap();
        let output = json!({"schemaVersion":1,"scope":"Actual 3-peer TCP/WS native short-round rules, not 45-minute endurance or browser rendering acceptance","fixture":{"kind":"cfg_test_native_round_policy","scene":"C2","round_seconds":ROUND,"intermission_seconds":INTERMISSION},"source":{"executable":{"path":executable,"sha256":tg_combat::geometry::manifest::sha256(&bytes)},"inputs":inputs},"peers":{"observer":{"player":observer.id,"wire_version":1,"observer":true},"blue":{"player":blue_id,"wire_version":2,"observer":false,"team":"blue"},"red":{"player":red_id,"wire_version":2,"observer":false,"team":"red"}},"native_assertions":{"actual_old_resource_deficits":true,"intermission_deploy_rejected":true,"old_inputs_and_order_rejected":true,"fresh_sequence_one_accepted":true,"new_resources_match_initial_stock":true,"observer_deploy_rejected":true},"old_battle":old_battle,"new_battle":new_battle,"old_blue_company":old_blue_company,"ended":endings,"reset_snapshots":reset_snapshots,"records":trace.lock().unwrap().records.clone()});
        let path = PathBuf::from(path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        assert!(
            !path.exists(),
            "Never overwrite earlier acceptance evidence"
        );
        std::fs::write(path, serde_json::to_vec(&output).unwrap()).unwrap();
    }
}
