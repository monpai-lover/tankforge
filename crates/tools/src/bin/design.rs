//! Server-side design intake, as a CLI and as a tiny HTTP endpoint.
//!
//!     cargo run -p tg-tools --bin design -- check <design.json> [--data data] [--json] [--out dir]
//!     cargo run -p tg-tools --bin design -- serve [--data data] [--port 8787]
//!
//! `check` runs exactly what the multiplayer server runs on a submitted VehicleDesign
//! (tg_design::accept_submission): refuses client-supplied derived values, parses strictly,
//! recomputes mass / armour / mobility / gun limits, validates. Exit code 1 if the design is
//! rejected or not battle-ready. `--out` writes the compiled vehicle folder.
//!
//! `serve` answers POST /api/designs/validate with the same result as JSON (CORS open, so the
//! editor page can call it from a file:// or any origin).
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use tg_design::{accept_submission, Db};

fn usage() -> ! {
    eprintln!("usage: design check <design.json> [--data dir] [--json] [--out dir]\n       design serve [--data dir] [--port 8787]");
    std::process::exit(2);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut data = PathBuf::from("data");
    let mut port = 8787u16;
    let mut json = false;
    let mut out: Option<PathBuf> = None;
    let mut pos = vec![];
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--data" => {
                i += 1;
                data = PathBuf::from(args.get(i).cloned().unwrap_or_else(|| usage()));
            }
            "--port" => {
                i += 1;
                port = args.get(i).and_then(|p| p.parse().ok()).unwrap_or_else(|| usage());
            }
            "--out" => {
                i += 1;
                out = Some(PathBuf::from(args.get(i).cloned().unwrap_or_else(|| usage())));
            }
            "--json" => json = true,
            a => pos.push(a.to_string()),
        }
        i += 1;
    }
    let db = Db::load(&data).unwrap_or_else(|e| {
        eprintln!("cannot load data: {}", e);
        std::process::exit(2)
    });
    match pos.first().map(|s| s.as_str()) {
        Some("check") => {
            let path = pos.get(1).unwrap_or_else(|| usage());
            let text = std::fs::read_to_string(path).unwrap_or_else(|e| {
                eprintln!("{}: {}", path, e);
                std::process::exit(2)
            });
            std::process::exit(check(&text, &db, json, out));
        }
        Some("serve") => serve(&db, port),
        _ => usage(),
    }
}

fn check(text: &str, db: &Db, json: bool, out: Option<PathBuf>) -> i32 {
    match accept_submission(text, db) {
        Err(rej) => {
            if json {
                println!("{}", serde_json::json!({"accepted": false, "rejection": rej}));
            } else {
                println!("REJECTED {}: {}", rej.code, rej.message);
            }
            1
        }
        Ok(a) => {
            if let (Some(dir), Some(files)) = (&out, &a.files) {
                std::fs::create_dir_all(dir).expect("create output dir");
                for (name, v) in files.as_object().unwrap() {
                    std::fs::write(dir.join(name), serde_json::to_string_pretty(v).unwrap()).expect("write file");
                }
            }
            if json {
                println!("{}", serde_json::json!({"accepted": true, "result": a}));
            } else {
                let r = &a.report;
                println!("design {} hash {}", r.design_id, r.design_hash);
                println!("  mass {:.1} t (armour {:.1} t), centre of mass ({:.2}, {:.2}, {:.2})", r.mass.total_kg / 1000.0, r.mass.armor_kg / 1000.0, r.center_of_mass.x, r.center_of_mass.y, r.center_of_mass.z);
                println!("  {:.1} hp/t, road {:.1} km/h, 0-32 km/h {}, ground pressure {:.0} kPa, climb {:.0} deg", r.mobility.power_to_weight_hp_t, r.mobility.top_speed_road_kmh, r.mobility.accel_0_32_s.map(|t| format!("{:.1} s", t)).unwrap_or("-".into()), r.mobility.ground_pressure_kpa, r.mobility.max_climb_deg);
                println!("  suspension load front {:.0}% middle {:.0}% rear {:.0}% of rating", r.suspension.front.ratio * 100.0, r.suspension.middle.ratio * 100.0, r.suspension.rear.ratio * 100.0);
                if let Some(g) = &r.gun {
                    println!("  gun {:.0} mm L/{:.0}: elevation +{:.1}/-{:.1} deg, reload {:.1} s", g.caliber_mm, g.length_cal, g.clearance.max_elevation_deg, g.clearance.frontal_depression_deg, g.reload_s);
                }
                for i in &r.issues {
                    println!("  [{}] {} {}: {}", if i.severity == tg_design::validate::Severity::Error { "ERROR" } else { "WARN " }, i.code, i.path, i.message);
                }
                println!("{} error(s), {} warning(s): {}", r.errors, r.warnings, if a.battle_ready { "battle-ready" } else { "NOT battle-ready" });
            }
            if a.battle_ready {
                0
            } else {
                1
            }
        }
    }
}

fn serve(db: &Db, port: u16) -> ! {
    let listener = TcpListener::bind(("127.0.0.1", port)).unwrap_or_else(|e| {
        eprintln!("bind {}: {}", port, e);
        std::process::exit(2)
    });
    eprintln!("design validation on http://127.0.0.1:{}/api/designs/validate", port);
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let method = parts.next().unwrap_or("").to_string();
        let path = parts.next().unwrap_or("").to_string();
        let mut len = 0usize;
        loop {
            let mut h = String::new();
            if reader.read_line(&mut h).is_err() || h.trim().is_empty() {
                break;
            }
            if let Some((k, v)) = h.split_once(':') {
                if k.trim().eq_ignore_ascii_case("content-length") {
                    len = v.trim().parse().unwrap_or(0);
                }
            }
        }
        let (status, body) = if method == "OPTIONS" {
            ("204 No Content", String::new())
        } else if method == "POST" && path == "/api/designs/validate" && len <= 8 << 20 {
            let mut buf = vec![0u8; len];
            if reader.read_exact(&mut buf).is_err() {
                continue;
            }
            let text = String::from_utf8_lossy(&buf);
            let v = match accept_submission(&text, db) {
                Ok(a) => serde_json::json!({"accepted": true, "result": a}),
                Err(r) => serde_json::json!({"accepted": false, "rejection": r}),
            };
            ("200 OK", v.to_string())
        } else {
            ("404 Not Found", "{\"error\":\"POST /api/designs/validate\"}".to_string())
        };
        let head = format!(
            "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nConnection: close\r\n\r\n",
            status,
            body.len()
        );
        let _ = stream.write_all(head.as_bytes());
        let _ = stream.write_all(body.as_bytes());
    }
    std::process::exit(0)
}
