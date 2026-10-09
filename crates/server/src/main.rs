//! tg-server [--port 8787] [--bind 0.0.0.0] [--data data] [--page client/web/dist/tankforge-range.html]
//!
//! Open http://<this machine>:<port>/ in a browser to play; the game connects back to /ws.
use std::net::TcpListener;
use std::path::PathBuf;
use tg_server::{lobby::Lobby, server};

fn main() {
    let mut port: u16 = 8787;
    let mut bind = "0.0.0.0".to_string();
    let mut data = PathBuf::from("data");
    let mut page = PathBuf::from("client/web/dist/tankforge-range.html");
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        let mut value = || args.next().unwrap_or_default();
        match a.as_str() {
            "--port" => port = value().parse().unwrap_or(port),
            "--bind" => bind = value(),
            "--data" => data = PathBuf::from(value()),
            "--page" => page = PathBuf::from(value()),
            "-h" | "--help" => {
                println!("tg-server [--port 8787] [--bind 0.0.0.0] [--data data] [--page client/web/dist/tankforge-range.html]");
                return;
            }
            other => {
                eprintln!("不認得的參數 {other}(--help 看用法)");
                std::process::exit(2);
            }
        }
    }
    let (shells, vehicles, maps) = server::load_catalog(&data);
    let combat = server::load_combat(&data);
    let points = server::load_points(&data);
    if vehicles.is_empty() {
        eprintln!("警告:{} 裡沒有車輛資料,任何車輛 id 都會被接受", data.display());
    }
    let listener = match TcpListener::bind((bind.as_str(), port)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("無法監聽 {bind}:{port}:{e}");
            std::process::exit(1);
        }
    };
    println!("TankForge 聯機伺服器:http://{bind}:{port}/ (WebSocket /ws)");
    println!("  {} 種炮彈、{} 台車、地圖:{}", shells.len(), vehicles.len(), maps.join("、"));
    if !points.is_empty() {
        let mut names: Vec<&String> = points.keys().collect();
        names.sort();
        println!("  佔點模式:{}", names.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("、"));
    }
    println!("  損傷模型:{} 台車的裝甲/模組/乘員、{} 種炮彈、{} 種機槍彈", combat.targets.len(), combat.projectiles.len(), combat.bullets.len());
    if !page.is_file() {
        println!("  (找不到 {},/ 不提供遊戲頁面;可直接開本機的 HTML 再連進來)", page.display());
    }
    let lobby = Lobby::new(shells, vehicles, maps).with_combat(combat.targets, combat.projectiles, combat.bullets).with_points(points).with_missiles(server::load_missiles(&data)).with_years(server::load_years(&data));
    if let Err(e) = server::serve(listener, lobby, Some(page)) {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
