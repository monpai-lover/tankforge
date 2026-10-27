//! Actual HTTP connection handler: validated registry bytes and URL allowlist.
use super::*;
use std::io::Read;
fn request(hub: Shared, path: &str) -> (String, Vec<u8>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        connection(stream, hub, &None).unwrap();
    });
    let mut client = TcpStream::connect(address).unwrap();
    client
        .set_read_timeout(Some(Duration::from_secs(15)))
        .unwrap();
    client
        .write_all(
            format!("GET {path} HTTP/1.1\r\nHost:localhost\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .unwrap();
    let mut result = Vec::new();
    client.read_to_end(&mut result).unwrap();
    server.join().unwrap();
    let split = result.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
    (
        String::from_utf8(result[..split].to_vec()).unwrap(),
        result[split + 4..].to_vec(),
    )
}
#[test]
fn actual_frontline_http_serves_exact_validated_maps_and_rejects_traversal() {
    let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let lobby = Lobby::new(Default::default(), Default::default(), vec![])
        .with_frontline(&data)
        .unwrap();
    let hub = Arc::new(Mutex::new(Hub {
        lobby,
        conns: HashMap::new(),
        clock: Instant::now(),
        lobby_ticks: 0,
        serials: 0,
    }));
    let (header, body) = request(hub.clone(), "/frontline/maps.json");
    assert!(header.starts_with("HTTP/1.1 200 "));
    let list: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let installed:Vec<_>=["korea","taiwan","taiwan-escort"].into_iter().filter(|id|data.join(format!("frontline/{id}.json")).exists()).collect();
    assert_eq!(list["maps"].as_array().unwrap().len(), installed.len());
    for id in installed {
        let (header, body) = request(hub.clone(), &format!("/frontline/{id}.json"));
        assert!(header.starts_with("HTTP/1.1 200 "));
        let source = std::fs::read(data.join(format!("frontline/{id}.json"))).unwrap();
        assert_eq!(
            body, source,
            "HTTP must serve the same bytes that startup parsed/validated, not a second disk read"
        );
        let sha = tg_combat::geometry::manifest::sha256(&body);
        assert_eq!(
            list["maps"]
                .as_array()
                .unwrap()
                .iter()
                .find(|m| m["id"] == id)
                .unwrap()["sha256"],
            sha
        );
    }
    for path in [
        "/frontline/unknown.json",
        "/frontline/../korea.json",
        "/frontline/%2e%2e/korea.json",
        "/frontline/taiwan.json/../../korea.json",
        "/frontline/korea.json/extra",
    ] {
        let (header, _) = request(hub.clone(), path);
        assert!(header.starts_with("HTTP/1.1 404 "), "{path}: {header}");
    }
}
