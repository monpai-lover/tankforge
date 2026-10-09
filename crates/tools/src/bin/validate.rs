//! Content validator CLI: materials, projectiles, terrains and every vehicle folder.
//!
//!     cargo run -p tg-tools --bin validate -- [data_dir] [--strict]
//!
//! Exit code 1 if any error; with --strict warnings fail the run too (for CI).
use std::path::PathBuf;

fn main() {
    let mut strict = false;
    let mut root = PathBuf::from("data");
    for a in std::env::args().skip(1) {
        if a == "--strict" {
            strict = true;
        } else {
            root = PathBuf::from(a);
        }
    }
    let mut report = tg_vehicle::validate_tree(&root);
    match tg_physics::load_terrains(&root.join("terrains.json")) {
        Ok(list) => report.extend(tg_physics::validate_terrains(&list)),
        Err(e) => report.err("L005", "terrains.json", e.to_string()),
    }
    print!("{}", report);
    println!("{} error(s), {} warning(s)", report.errors(), report.warnings());
    if report.errors() > 0 || (strict && report.warnings() > 0) {
        std::process::exit(1);
    }
}
