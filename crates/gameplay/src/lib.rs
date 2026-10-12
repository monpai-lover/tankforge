//! Dependency-light gameplay policy shared by browser and native runtime owners.
use serde::{Deserialize, Serialize};
use std::sync::{LazyLock, OnceLock};

pub const GAMEPLAY_RULES_VERSION: u32 = 2;
const RULES_JSON: &str = include_str!("../../../config/gameplay-modes.json");

pub const AMMO_PROTOCOL_VERSION: u32 = 1;
const AMMO_JSON: &str = include_str!("../../../config/ammo-resupply.json");
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AmmoPolicy {
    ammo_protocol_version: u32,
    resupply_seconds: f64,
    pose_max_age_seconds: f64,
}
fn parse_ammo_policy(json: &str) -> Result<AmmoPolicy, String> {
    let policy: AmmoPolicy = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if policy.ammo_protocol_version != AMMO_PROTOCOL_VERSION {
        return Err("Unsupported ammunition protocol version".into());
    }
    if [policy.resupply_seconds, policy.pose_max_age_seconds].iter().any(|n| !n.is_finite() || *n <= 0.0) {
        return Err("Invalid ammunition resupply time".into());
    }
    Ok(policy)
}
fn ammo_policy() -> &'static AmmoPolicy {
    static POLICY: OnceLock<AmmoPolicy> = OnceLock::new();
    POLICY.get_or_init(|| parse_ammo_policy(AMMO_JSON).expect("Invalid embedded ammunition policy"))
}
pub static RESUPPLY_SECONDS: LazyLock<f64> = LazyLock::new(|| ammo_policy().resupply_seconds);
pub static POSE_MAX_AGE_SECONDS: LazyLock<f64> = LazyLock::new(|| ammo_policy().pose_max_age_seconds);

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GameplayMode {
    Casual,
    #[default]
    Historical,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameplayRules {
    pub speed: f64,
    pub drive: f64,
    pub steer: f64,
    pub traverse: f64,
    pub elevate: f64,
    pub fire: f64,
    pub show_enemy_markers: bool,
}

impl GameplayRules {
    fn factors(&self) -> [f64; 6] {
        [self.speed, self.drive, self.steer, self.traverse, self.elevate, self.fire]
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Modes {
    casual: GameplayRules,
    historical: GameplayRules,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    version: u32,
    modes: Modes,
}

fn parse_config(json: &str) -> Result<Config, String> {
    let config: Config = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if config.version != GAMEPLAY_RULES_VERSION {
        return Err("Unsupported gameplay rules version".into());
    }
    for rules in [&config.modes.casual, &config.modes.historical] {
        if rules.factors().iter().any(|v| !v.is_finite() || *v <= 0.0) {
            return Err("Invalid gameplay rules factor".into());
        }
    }
    if config.modes.historical.factors().iter().any(|v| *v != 1.0) || config.modes.historical.show_enemy_markers {
        return Err("Historical gameplay rules must preserve stock performance".into());
    }
    Ok(config)
}

/// Parse and validate the shared bytes once; callers receive an immutable cached rule.
pub fn rules(mode: GameplayMode) -> &'static GameplayRules {
    static CONFIG: OnceLock<Config> = OnceLock::new();
    let config = CONFIG.get_or_init(|| parse_config(RULES_JSON).expect("Invalid embedded gameplay rules"));
    match mode {
        GameplayMode::Casual => &config.modes.casual,
        GameplayMode::Historical => &config.modes.historical,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ammo_resupply_shared_policy_is_strict_and_source_derived() {
        assert_eq!(AMMO_PROTOCOL_VERSION, 1);
        assert_eq!(*RESUPPLY_SECONDS, 5.0); assert_eq!(*POSE_MAX_AGE_SECONDS, 1.0);
        for change in ["\"ammo_protocol_version\": 2", "\"ammo_protocol_version\": 1.1", "\"ammo_protocol_version\": \"1\""] {
            assert!(parse_ammo_policy(&AMMO_JSON.replace("\"ammo_protocol_version\": 1", change)).is_err());
        }
        for change in ["\"resupply_seconds\": 0", "\"resupply_seconds\": -1", "\"resupply_seconds\": \"5\""] {
            assert!(parse_ammo_policy(&AMMO_JSON.replace("\"resupply_seconds\": 5", change)).is_err());
        }
        assert!(parse_ammo_policy(&AMMO_JSON.replace("\"pose_max_age_seconds\": 1", "\"pose_max_age_seconds\": 0")).is_err());
        assert!(parse_ammo_policy(&AMMO_JSON.replacen('{', "{\"extra\":1,", 1)).is_err());
    }

    #[test]
    fn exact_shared_rules_and_cached_identity() {
        assert_eq!(GAMEPLAY_RULES_VERSION, 2);
        assert_eq!(rules(GameplayMode::Casual), &GameplayRules {
            speed: 1.15, drive: 1.25, steer: 1.25, traverse: 1.30,
            elevate: 1.20, fire: 1.20, show_enemy_markers: true,
        });
        assert_eq!(rules(GameplayMode::Historical), &GameplayRules {
            speed: 1.0, drive: 1.0, steer: 1.0, traverse: 1.0,
            elevate: 1.0, fire: 1.0, show_enemy_markers: false,
        });
        assert!(std::ptr::eq(rules(GameplayMode::Casual), rules(GameplayMode::Casual)));
        assert_eq!(GameplayMode::default(), GameplayMode::Historical);
    }

    #[test]
    fn strict_mode_ids_and_room_version() {
        for (mode, text) in [(GameplayMode::Casual, "casual"), (GameplayMode::Historical, "historical")] {
            assert_eq!(serde_json::to_string(&mode).unwrap(), format!("\"{text}\""));
            assert_eq!(serde_json::from_str::<GameplayMode>(&format!("\"{text}\"")).unwrap(), mode);
        }
        for text in ["null", "1", "{}", "\"CASUAL\"", "\"historical \"", "\"garage\""] {
            assert!(serde_json::from_str::<GameplayMode>(text).is_err());
        }
        let json = include_str!("../../../config/gameplay-modes.json");
        assert!(parse_config(json).is_ok());
        for value in ["0", "1", "3", "2.1", "\"2\"", "null"] {
            assert!(parse_config(&json.replacen("\"version\": 2", &format!("\"version\": {value}"), 1)).is_err());
        }
        assert!(parse_config(&json.replacen("\"casual\"", "\"garage\"", 1)).is_err());
        assert!(parse_config(&json.replacen("\"speed\": 1.15", "\"speed\": 0", 1)).is_err());
        assert!(parse_config(&json.replacen("\"speed\": 1,", "\"speed\": 1.01,", 1)).is_err());
        assert!(parse_config(&json.replacen("\"fire\": 1.20", "\"fire\": \"1.2\"", 1)).is_err());
        assert!(parse_config(&json.replacen("\"version\": 2", "\"extra\": 0, \"version\": 2", 1)).is_err());
    }
}
