//! The server over real sockets: two WebSocket clients meet in a room, start a battle, see each
//! other's state in the snapshots, and one shot is relayed and scored. Also the plain HTTP routes.
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tg_server::lobby::{Lobby, Shell};
use tg_server::{server, ws};

fn start(page: Option<PathBuf>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let mut shells = HashMap::new();
    shells.insert("aphe_85_br365".to_string(), Shell { kind: "aphe".into(), filler_kg: 0.1, caliber_mm: 85.0 });
    let vehicles: HashSet<String> = ["su_t34_85".to_string()].into_iter().collect();
    let data = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let combat = server::load_combat(&data);
    let lobby = Lobby::new(shells, vehicles, vec!["range".into(), "coast".into()]).with_combat(combat.targets, combat.projectiles, combat.bullets);
    std::thread::spawn(move || server::serve(listener, lobby, page));
    port
}

struct Client {
    r: BufReader<TcpStream>,
    w: TcpStream,
}

impl Client {
    fn connect(port: u16) -> Client {
        let s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut w = s.try_clone().unwrap();
        write!(w, "GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n").unwrap();
        let mut r = BufReader::new(s);
        let mut head = String::new();
        loop {
            let mut line = String::new();
            r.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
            head.push_str(&line);
        }
        assert!(head.starts_with("HTTP/1.1 101"), "{head}");
        assert!(head.contains("s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
        Client { r, w }
    }

    fn send(&mut self, v: Value) {
        let frame = ws::encode_masked(0x1, v.to_string().as_bytes(), [7, 1, 9, 3]);
        self.w.write_all(&frame).unwrap();
    }

    /// The next message of type `t` (others skipped), within a few seconds.
    fn expect(&mut self, t: &str) -> Value {
        let until = Instant::now() + Duration::from_secs(5);
        while Instant::now() < until {
            if let ws::Incoming::Text(text) = ws::read_message(&mut self.r, false).unwrap() {
                let v: Value = serde_json::from_str(&text).unwrap();
                if v["t"] == t {
                    return v;
                }
            }
        }
        panic!("no {t}");
    }
}

#[test]
fn two_players_meet_in_a_room_and_fight() {
    let port = start(None);
    let mut a = Client::connect(port);
    let mut b = Client::connect(port);
    let wa = a.expect("welcome");
    assert_eq!(wa["maps"], json!(["range", "coast"]));
    let id_a = wa["id"].as_u64().unwrap();
    let wb = b.expect("welcome");
    let id_b = wb["id"].as_u64().unwrap();
    let token_b = wb["token"].as_str().unwrap().to_string();
    a.send(json!({"t": "hello", "name": "甲"}));
    a.send(json!({"t": "create", "name": "測試房", "map": "coast", "max": 4}));
    let room = a.expect("room")["room"].clone();
    assert_eq!(room["members"][0]["name"], "甲");
    // b sees it in the list and joins
    let rooms = loop {
        let r = b.expect("rooms");
        if !r["rooms"].as_array().unwrap().is_empty() {
            break r;
        }
    };
    assert_eq!(rooms["rooms"][0]["name"], "測試房");
    b.send(json!({"t": "join", "room": room["id"]}));
    for c in [&mut a, &mut b] {
        c.send(json!({"t": "vehicle", "id": "su_t34_85"}));
    }
    // the host starts once the room shows both vehicles chosen
    loop {
        let r = a.expect("room");
        let m = r["room"]["members"].as_array().unwrap().clone();
        if m.len() == 2 && m.iter().all(|p| p["vehicle"] == "su_t34_85") {
            break;
        }
    }
    a.send(json!({"t": "start"}));
    let st = b.expect("start");
    assert_eq!(st["map"], "coast");
    assert_eq!(st["members"].as_array().unwrap().len(), 2);
    a.expect("start");
    // both send their state; each sees both in a snapshot
    a.send(json!({"t": "state", "s": {"pos": [10.0, 0.0, 5.0]}}));
    b.send(json!({"t": "state", "s": {"pos": [-10.0, 0.0, 5.0]}}));
    let snap = loop {
        let s = a.expect("snap");
        if s["players"].as_array().unwrap().len() == 2 {
            break s;
        }
    };
    assert!(snap["players"].as_array().unwrap().iter().any(|p| p["id"].as_u64() == Some(id_b) && p["s"]["pos"][0] == -10.0));
    // An explicit foreign mount is refused and never relayed. The own gun is
    // accepted once; a duplicate replies to its owner without relaying another shot.
    a.send(json!({"t":"fire","seq":0,"instance":"gun:99:0","o":[10,2,5],"d":[-1,0,0],"shell":"aphe_85_br365"}));
    let refused = a.expect("fire_rejected");
    assert_eq!(refused["seq"],0);assert_eq!(refused["reason"],"weapon_disabled");
    a.send(json!({"t": "fire", "seq": 1, "instance":"gun:0:0", "o": [10, 2, 5], "d": [-1, 0, 0], "shell": "aphe_85_br365"}));
    assert_eq!(a.expect("fire_accepted")["seq"],1);
    let f = b.expect("fire");
    assert_eq!(f["from"].as_u64(), Some(id_a));assert_eq!(f["seq"],1);
    a.send(json!({"t":"fire","seq":1,"instance":"gun:0:0","o":[10,2,5],"d":[-1,0,0],"shell":"aphe_85_br365"}));
    let duplicate=a.expect("fire_rejected");assert_eq!(duplicate["seq"],1);assert_eq!(duplicate["reason"],"sequence_conflict");
    a.send(json!({"t": "hit", "seq": 1, "target": id_b, "result": "pen", "plate": "hull_side"}));
    let d = b.expect("damage");
    assert_eq!((d["killed"].as_bool(), d["hp"].as_f64()), (Some(true), Some(0.0)));
    a.expect("damage");
    // pings come back, rubbish gets an error, and a client leaving is seen by the other
    a.send(json!({"t": "ping", "at": 12.5}));
    assert_eq!(a.expect("pong")["at"], 12.5);
    b.send(json!({"t": "nonsense"}));
    b.expect("error");
    // b's connection drops in the battle: the seat is held, and a new connection with b's token
    // takes it back under b's id
    drop(b);
    std::thread::sleep(Duration::from_millis(200));
    let mut c = Client::connect(port);
    c.expect("welcome");
    c.send(json!({"t": "hello", "name": "乙", "resume": token_b}));
    let wc = c.expect("welcome");
    assert_eq!(wc["id"].as_u64(), Some(id_b));
    assert_ne!(wc["token"].as_str(), Some(token_b.as_str()));
    // and when it leaves, the other sees it go
    c.send(json!({"t": "leave"}));
    let room = loop {
        let r = a.expect("room");
        if r["room"]["members"].as_array().unwrap().len() == 1 {
            break r;
        }
    };
    assert_eq!(room["room"]["host"].as_u64(), Some(id_a));
}

fn http_get(port: u16, path: &str) -> String {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    write!(s, "GET {path} HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
    let mut out = String::new();
    s.read_to_string(&mut out).unwrap();
    out
}

#[test]
fn the_game_page_and_the_room_list_are_served_over_http() {
    let dir = std::env::temp_dir().join(format!("tg-server-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let page = dir.join("game.html");
    std::fs::write(&page, "<!doctype html><title>TankForge</title>").unwrap();
    let port = start(Some(page));
    let home = http_get(port, "/");
    assert!(home.starts_with("HTTP/1.1 200") && home.ends_with("<title>TankForge</title>"), "{home}");
    let rooms = http_get(port, "/rooms");
    assert!(rooms.contains(r#"{"t":"rooms","rooms":[]}"#), "{rooms}");
    assert!(http_get(port, "/nothing").starts_with("HTTP/1.1 404"));
    // a websocket path without the upgrade is not a websocket
    assert!(http_get(port, "/ws").starts_with("HTTP/1.1 404"));
}
