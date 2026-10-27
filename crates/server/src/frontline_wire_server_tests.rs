use super::*;
use crate::frontline::{Command, Update};
use crate::frontline_wire::{FrameDecoder, FrameHeader};
use serde_json::{json, Value};

fn payload(frame: &Frame) -> &[u8] {
    let n = frame[1] & 127;
    let (offset, length) = match n {
        126 => (
            4,
            u16::from_be_bytes(frame[2..4].try_into().unwrap()) as usize,
        ),
        127 => (
            10,
            u64::from_be_bytes(frame[2..10].try_into().unwrap()) as usize,
        ),
        n => (2, n as usize),
    };
    assert_eq!(frame.len(), offset + length);
    &frame[offset..]
}
fn conn(serial: u64) -> (Conn, Receiver<Frame>, TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let peer = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (stream, _) = listener.accept().unwrap();
    let (tx, rx) = sync_channel(8);
    (
        Conn {
            tx,
            stream,
            serial,
            frontline_wire: None,
        },
        rx,
        peer,
    )
}
fn hub() -> Hub {
    Hub {
        lobby: Lobby::new(HashMap::new(), HashSet::new(), vec!["range".into()]),
        conns: HashMap::new(),
        clock: Instant::now(),
        lobby_ticks: 0,
        serials: 0,
    }
}
fn frame(tick: u64) -> ServerMsg {
    ServerMsg::Frontline {
        version: 1,
        message: Update::Frame {
            intel: None,
            battle: 1,
            tick,
            units: vec![],
            companies: vec![],
            readiness: [1000, 1000],
            objectives: vec![],
            events: vec![json!({"kind":"transport-fixture","tick":tick})],
            aircrafts: vec![],
            missiles: vec![],
            staging: vec![],
            facilities: vec![],
            facility_jobs: vec![],
        },
    }
}

#[test]
fn hello_wire_capability_is_optional_socket_scoped_and_rejects_invalid_values() {
    for (extra, wanted) in [
        ("", None),
        (r#", "frontline_wire_version":0"#, None),
        (r#", "frontline_wire_version":1"#, None),
        (r#", "frontline_wire_version":2"#, Some(2)),
    ] {
        let text = format!(r#"{{"t":"hello","name":"test"{extra}}}"#);
        let msg = serde_json::from_str::<ClientMsg>(&text).unwrap();
        assert_eq!(requested_frontline_wire(&text, &msg).unwrap(), Some(wanted));
    }
    for extra in ["3", "-1", "2.0", r#""2""#, "true"] {
        let text = format!(r#"{{"t":"hello","name":"test","frontline_wire_version":{extra}}}"#);
        let msg = serde_json::from_str::<ClientMsg>(&text).unwrap();
        assert!(requested_frontline_wire(&text, &msg).is_err());
    }
    let mut h = hub();
    let (c, _rx, _peer) = conn(u64::MAX);
    h.conns.insert(1, c);
    h.negotiate_frontline_wire(1, Some(2));
    let welcome = ServerMsg::Welcome {
        id: 1,
        name: "test".into(),
        maps: vec![],
        token: "token".into(),
        gameplay_rules_version: 2,
        ammo_protocol_version: 1,
    };
    let encoded = h.encode_for(1, &welcome, None).unwrap();
    let decoded: Value = serde_json::from_slice(payload(&encoded)).unwrap();
    assert_eq!(decoded["frontline_wire_version"], 2);
    assert_eq!(
        decoded["frontline_wire_stream"],
        u64::MAX.to_string(),
        "Welcome must never round the u64 socket identity through a JS number"
    );
    h.negotiate_frontline_wire(1, None);
    let legacy = h.encode_for(1, &welcome, None).unwrap();
    let legacy: Value = serde_json::from_slice(payload(&legacy)).unwrap();
    assert!(legacy.get("frontline_wire_version").is_none());
}

#[test]
fn same_broadcast_tick_supports_legacy_json_and_lossless_binary_with_independent_reset_history() {
    let mut h = hub();
    let (a, legacy, _a_peer) = conn(11);
    let (b, binary, _b_peer) = conn(12);
    h.conns.insert(1, a);
    h.conns.insert(2, b);
    h.negotiate_frontline_wire(2, Some(2));
    let mut decoder = FrameDecoder::default();
    for tick in [1, 2] {
        let message = frame(tick);
        h.broadcast(vec![(vec![1, 2], message)]);
        let text = legacy.try_recv().unwrap();
        let bytes = binary.try_recv().unwrap();
        assert_eq!(text[0] & 15, 1);
        assert_eq!(bytes[0] & 15, 2);
        let text: Value = serde_json::from_slice(payload(&text)).unwrap();
        let value = decoder.decode(payload(&bytes)).unwrap();
        assert!(crate::frontline_wire::identical(&text["message"], &value));
        assert_eq!(FrameHeader::read(payload(&bytes)).unwrap().full, tick == 1);
    }
    // A repeated successful Hello on the same socket resets its dictionary by
    // increasing the epoch, rather than creating another epoch1 encoder.
    h.negotiate_frontline_wire(2, Some(2));
    h.broadcast(vec![(vec![1, 2], frame(2))]);
    let bytes = binary.try_recv().unwrap();
    let header = FrameHeader::read(payload(&bytes)).unwrap();
    assert!(header.full);
    assert_eq!(header.epoch, 2);
    assert_eq!(header.stream, 12);
    assert_eq!(decoder.decode(payload(&bytes)).unwrap()["tick"], 2);
}

#[test]
fn wire_reset_reads_existing_membership_without_resuming_or_changing_room_state() {
    let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let mut lobby = Lobby::new(HashMap::new(), HashSet::new(), vec!["range".into()])
        .with_frontline(&data)
        .unwrap();
    let (player, _) = lobby.connect();
    lobby.handle(
        player,
        ClientMsg::Hello {
            name: "wire reset".into(),
            resume: None,
            gameplay_rules_version: json!(2),
            ammo_protocol_version: json!(1),
        },
        0.0,
    );
    let created = lobby.handle(
        player,
        ClientMsg::Frontline {
            version: 1,
            command: Command::Create {
                name: "unchanged".into(),
                map: "korea".into(),
                observer: true,
                era: 1986,
            },
        },
        0.0,
    );
    let before = created
        .iter()
        .find_map(|(_, m)| match m {
            ServerMsg::Frontline {
                message: message @ Update::Snapshot { .. },
                ..
            } => Some(message.clone()),
            _ => None,
        })
        .unwrap();
    let reset = lobby.handle(player, ClientMsg::FrontlineWireReset { version: 2 }, 1.0);
    assert_eq!(
        reset,
        vec![(
            player,
            ServerMsg::Frontline {
                version: 1,
                message: before
            }
        )]
    );
    let (other, _) = lobby.connect();
    assert!(lobby
        .handle(other, ClientMsg::FrontlineWireReset { version: 2 }, 1.0)
        .iter()
        .all(|(_, m)| matches!(m, ServerMsg::Error { .. })));
    assert!(lobby
        .handle(player, ClientMsg::FrontlineWireReset { version: 3 }, 1.0)
        .iter()
        .all(|(_, m)| matches!(m, ServerMsg::Error { .. })));
}

#[test]
fn overloaded_tick_releases_hub_for_real_http_readonly_reset_and_leave() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Barrier,
    };
    let now = Instant::now();
    assert_eq!(ticker_handoff(now, now), Duration::from_millis(1));
    assert_eq!(
        ticker_handoff(now, now + Duration::from_millis(50)),
        Duration::from_millis(1)
    );
    let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let mut h = hub();
    h.lobby = h.lobby.with_frontline(&data).unwrap();
    let (player, _) = h.lobby.connect();
    h.lobby.handle(
        player,
        ClientMsg::Hello {
            name: "fair tick".into(),
            resume: None,
            gameplay_rules_version: json!(2),
            ammo_protocol_version: json!(1),
        },
        0.0,
    );
    let created = h.lobby.handle(
        player,
        ClientMsg::Frontline {
            version: 1,
            command: Command::Create {
                name: "unchanged".into(),
                map: "korea".into(),
                observer: true,
                era: 1986,
            },
        },
        0.0,
    );
    let before = created
        .iter()
        .find_map(|(_, m)| match m {
            ServerMsg::Frontline {
                message: message @ Update::Snapshot { .. },
                ..
            } => Some(message.clone()),
            _ => None,
        })
        .unwrap();
    let shared = Arc::new(Mutex::new(h));
    let stop = Arc::new(AtomicBool::new(false));
    let barrier = Arc::new(Barrier::new(2));
    let worker = {
        let shared = shared.clone();
        let stop = stop.clone();
        let barrier = barrier.clone();
        thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(4);
            let mut next = Instant::now();
            let mut first = true;
            while !stop.load(Ordering::Relaxed) && Instant::now() < deadline {
                thread::sleep(ticker_handoff(next, Instant::now()));
                {
                    let _held = lock(&shared);
                    if first {
                        first = false;
                        barrier.wait();
                    }
                    thread::sleep(Duration::from_millis(25));
                }
                next = (next + Duration::from_millis(5)).max(Instant::now());
            }
        })
    };
    barrier.wait();
    let started = Instant::now();
    let (tx, rx) = std::sync::mpsc::channel();
    let reset = {
        let shared = shared.clone();
        let tx = tx.clone();
        thread::spawn(move || {
            let out = lock(&shared).lobby.handle(
                player,
                ClientMsg::FrontlineWireReset { version: 2 },
                1.0,
            );
            tx.send(("reset", out)).unwrap();
        })
    };
    let http = {
        let shared = shared.clone();
        let tx = tx.clone();
        thread::spawn(move || {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let reader = thread::spawn(move || {
                let mut socket = TcpStream::connect(address).unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(1)))
                    .unwrap();
                socket.write_all(b"GET /frontline/maps.json HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").unwrap();
                let mut bytes = Vec::new();
                std::io::Read::read_to_end(&mut socket, &mut bytes).unwrap();
                assert!(bytes.starts_with(b"HTTP/1.1 200"));
            });
            let (socket, _) = listener.accept().unwrap();
            connection(socket, shared, &None).unwrap();
            reader.join().unwrap();
            tx.send(("http", vec![])).unwrap();
        })
    };
    let result = || {
        for _ in 0..2 {
            let (kind, out) = rx.recv_timeout(Duration::from_secs(1)).unwrap();
            if kind == "reset" {
                assert_eq!(
                    out,
                    vec![(
                        player,
                        ServerMsg::Frontline {
                            version: 1,
                            message: before.clone()
                        }
                    )]
                );
            }
        }
        let leave = {
            let shared = shared.clone();
            let tx = tx.clone();
            thread::spawn(move || {
                let out = lock(&shared).lobby.handle(
                    player,
                    ClientMsg::Frontline {
                        version: 1,
                        command: Command::Leave,
                    },
                    1.1,
                );
                tx.send(("leave", out)).unwrap();
            })
        };
        let (_, out) = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(out.iter().any(|(_, m)| matches!(
            m,
            ServerMsg::Frontline {
                message: Update::Left,
                ..
            }
        )));
        leave.join().unwrap();
    };
    // Stop even if a request fails: the bounded worker never leaks into other tests.
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(result));
    stop.store(true, Ordering::Relaxed);
    worker.join().unwrap();
    reset.join().unwrap();
    http.join().unwrap();
    outcome.unwrap();
    assert!(started.elapsed() < Duration::from_secs(2));
}
