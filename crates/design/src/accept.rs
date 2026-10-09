//! Server intake of a player design. The server never trusts derived numbers from a client:
//! a submission carrying weight, armour effectiveness, penetration or power results is
//! rejected outright, the design is parsed strictly, and every derived value is recomputed
//! here. Only a design without validation errors may enter ranked battles.
use crate::eval::{evaluate, DesignReport};
use crate::model::{VehicleDesign, SCHEMA};
use crate::Db;
use serde::Serialize;
use serde_json::Value;

/// Field names that only the server computes. If a client sends them, the submission is refused
/// rather than silently ignored, so a tampered client is noticed.
pub const DERIVED_FIELDS: &[&str] = &[
    "weight", "weight_kg", "mass", "mass_kg", "total_mass", "total_mass_kg", "center_of_mass", "armor_effectiveness",
    "armour_effectiveness", "effective_armor", "penetration", "penetration_mm", "horsepower_result", "power_to_weight",
    "hp_per_ton", "top_speed", "top_speed_kmh", "ground_pressure", "suspension_load", "battle_ready", "report", "stats",
];

pub const MAX_VERTICES: usize = 4000;
pub const MAX_FACES: usize = 3000;
pub const MAX_ITEMS: usize = 128;

#[derive(Clone, Debug, Serialize)]
pub struct Rejection {
    pub code: &'static str,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Accepted {
    pub design_hash: String,
    pub battle_ready: bool,
    pub report: DesignReport,
    /// The game-format vehicle folder, computed here (absent if the design cannot be compiled).
    pub files: Option<Value>,
}

fn find_derived(v: &Value, path: &str, out: &mut Vec<String>) {
    if let Value::Object(map) = v {
        for (k, child) in map {
            // the editor's own state is opaque and never read
            if path.is_empty() && k == "editor" {
                continue;
            }
            let here = if path.is_empty() { k.clone() } else { format!("{}.{}", path, k) };
            if DERIVED_FIELDS.contains(&k.as_str()) {
                out.push(here.clone());
            }
            find_derived(child, &here, out);
        }
    } else if let Value::Array(a) = v {
        for (i, child) in a.iter().enumerate() {
            find_derived(child, &format!("{}[{}]", path, i), out);
        }
    }
}

pub fn accept_submission(text: &str, db: &Db) -> Result<Accepted, Rejection> {
    if text.len() > 4 << 20 {
        return Err(Rejection { code: "D102", message: "設計檔超過 4 MB".into() });
    }
    let raw: Value = serde_json::from_str(text).map_err(|e| Rejection { code: "D101", message: format!("不是有效的 JSON：{}", e) })?;
    let mut derived = vec![];
    find_derived(&raw, "", &mut derived);
    if !derived.is_empty() {
        return Err(Rejection { code: "D100", message: format!("伺服器不接受客戶端提供的計算結果：{}（重量、裝甲效能、穿深、馬力結果一律由伺服器重算）", derived.join(", ")) });
    }
    let d: VehicleDesign = serde_json::from_value(raw).map_err(|e| Rejection { code: "D101", message: format!("設計格式錯誤：{}", e) })?;
    if d.schema != SCHEMA {
        return Err(Rejection { code: "D101", message: format!("schema 必須是 {}", SCHEMA) });
    }
    let nv = d.hull_geometry.vertices.len() + d.turret_geometry.as_ref().map(|t| t.vertices.len()).unwrap_or(0);
    let nf = d.hull_geometry.faces.len() + d.turret_geometry.as_ref().map(|t| t.faces.len()).unwrap_or(0);
    if nv > MAX_VERTICES || nf > MAX_FACES {
        return Err(Rejection { code: "D102", message: format!("網格太大（{} 頂點 / {} 面；上限 {} / {}）", nv, nf, MAX_VERTICES, MAX_FACES) });
    }
    if d.internal_modules.len() > MAX_ITEMS || d.addons.len() > MAX_ITEMS || d.crew_positions.len() > 12 || d.armor_layers.len() > MAX_FACES {
        return Err(Rejection { code: "D102", message: "模組、附加裝甲或乘員數量超過上限".into() });
    }
    let report = evaluate(&d, db);
    let files = report.compiled.as_ref().map(|c| c.files());
    Ok(Accepted { design_hash: report.design_hash.clone(), battle_ready: report.battle_ready, report, files })
}
