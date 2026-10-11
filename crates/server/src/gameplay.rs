//! Room policy derived from the original shared definitions. No profile mutates catalog data.
use serde::Serialize;
use serde_json::Value;
use tg_gameplay::{rules, GameplayMode, GameplayRules, GAMEPLAY_RULES_VERSION};

pub const UPDATE_NEEDED: &str = "玩法規則版本不相容，請更新遊戲與伺服器";
pub const DEFAULT_SOCKET_RATE: f64 = 240.0;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct RoomGameplay {
    gameplay_mode: GameplayMode,
    gameplay_rules_version: u32,
}

pub fn compatible(capability: &Value) -> bool {
    capability.as_u64() == Some(GAMEPLAY_RULES_VERSION as u64)
}

impl RoomGameplay {
    pub fn parse(mode: Value, version: Value) -> Result<Self, &'static str> {
        if !compatible(&version) { return Err(UPDATE_NEEDED); }
        let mode = serde_json::from_value(mode).map_err(|_| "未知或缺少玩法規則，請更新遊戲")?;
        Ok(Self { gameplay_mode: mode, gameplay_rules_version: GAMEPLAY_RULES_VERSION })
    }
    pub fn rules(self) -> &'static GameplayRules { rules(self.gameplay_mode) }
    pub fn fire_burst(self, small: bool) -> usize { self.scaled_count(if small { 600 } else { 16 }) }
    pub fn legacy_mg_window(self) -> u32 { self.scaled_count(40) as u32 }
    fn scaled_count(self, stock: usize) -> usize { (stock as f64 * self.rules().fire).ceil() as usize }
    /// These are coarse abuse bounds, not a complete authoritative drivetrain or reload model.
    pub fn max_speed(self) -> f64 { 30.0 * self.rules().speed }
    pub fn launch_interval(self) -> f64 { 0.25 / self.rules().fire }
    pub fn sequence_capacity(self) -> usize { self.scaled_count(2048) }
    pub fn launch_receipt_capacity(self) -> usize { self.scaled_count(256) }
    pub fn socket_rate(self) -> f64 { DEFAULT_SOCKET_RATE * self.rules().fire }
    pub fn aps(self, source: &tg_missile::ApsDef) -> tg_missile::ApsDef {
        let r = self.rules();
        let mut def = source.clone();
        def.rate_rpm *= r.fire;
        def.rate_range_rpm = def.rate_range_rpm.map(|rate| rate * r.fire);
        def.traverse_deg_s *= r.traverse;
        def.elevate_deg_s *= r.elevate;
        def
    }
}

/// Per-socket outbound queue is bounded for the highest supported throughput. Room firing
/// quotas remain profile-specific. Slow clients still disconnect; capacity is not authority.
pub fn socket_queue_capacity() -> usize {
    (512.0 * rules(GameplayMode::Casual).fire.max(rules(GameplayMode::Historical).fire)).ceil() as usize
}
