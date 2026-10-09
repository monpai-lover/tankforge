use tg_replay::{build_timeline, TimelineOptions};
use tg_shared::Vec3;
use tg_sim_slice::{run_shot, Data, Scenario};

fn main() {
    let mut data = Data::embedded();
    let seed = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(2024u64);
    let r = run_shot(
        &Scenario { shooter_pos: Vec3::new(101.1, 1.6, 0.2), aim_point: Vec3::new(1.1, 1.6, 0.2), seed },
        &mut data,
    );
    println!("{}", serde_json::to_string_pretty(&r.event).unwrap());
    println!("\ncapabilities: {:?}", r.capabilities);
    println!("timeline: {:#?}", build_timeline(&r.event, &TimelineOptions::default()));
}
