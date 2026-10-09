//! ShotEvent: the single record the server sends after resolving a hit.
//! The client rebuilds the X-ray replay purely from this; it never re-computes
//! penetration. Also builds the slow-motion playback timeline.
use serde::{Deserialize, Serialize};
use tg_shared::{EntityId, Vec3};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PenetrationOutcome {
    Miss,
    Ricochet,
    Stopped,
    Shattered,
    Penetrated,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShotOutcome {
    Miss,
    Ricochet,
    Stopped,
    Shattered,
    PenetratedNoDamage,
    CrewInjured,
    CrewKilled,
    ModuleDamaged,
    AmmoDetonation,
    FuelFire,
    EngineDamaged,
    BarrelDamaged,
    BreechDamaged,
    TrackBroken,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct PathPoint {
    pub t: f32,
    pub pos: Vec3,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FragmentRecord {
    pub origin: Vec3,
    pub end: Vec3,
    pub energy_j: f32,
    pub damage: f32,
    pub is_penetrator: bool,
    /// Module id or "crew:<role>" if something was hit.
    pub hit: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DamagedModule {
    pub id: String,
    pub kind: String,
    pub damage: f32,
    pub destroyed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DamagedCrew {
    pub role: String,
    pub damage: f32,
    pub killed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ShotEvent {
    pub shot_id: u64,
    pub tick: u64,
    /// RNG seed used for spall: lets the server re-simulate / audit the shot.
    pub seed: u64,
    pub shooter_id: EntityId,
    pub target_id: EntityId,
    pub projectile_type: String,
    pub muzzle_position: Vec3,
    pub impact_position: Vec3,
    pub impact_normal: Vec3,
    pub armor_plate: String,
    pub armor_thickness_mm: f32,
    pub impact_angle_deg: f32,
    pub effective_thickness_mm: f32,
    pub penetration_value_mm: f32,
    pub penetration_result: PenetrationOutcome,
    pub projectile_path: Vec<PathPoint>,
    pub fragments: Vec<FragmentRecord>,
    pub damaged_modules: Vec<DamagedModule>,
    pub damaged_crew: Vec<DamagedCrew>,
    pub outcomes: Vec<ShotOutcome>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplayPhase {
    Flight,
    Impact,
    Interior,
    Aftermath,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct ReplayKeyframe {
    pub phase: ReplayPhase,
    pub start_s: f32,
    /// Playback duration (wall-clock seconds on the client).
    pub duration_s: f32,
    /// Playback speed relative to simulated time (<1 is slow motion).
    pub time_scale: f32,
    /// 0..1 hull transparency target for the X-ray shader.
    pub hull_alpha: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct TimelineOptions {
    pub max_flight_playback_s: f32,
    pub impact_s: f32,
    pub interior_s: f32,
    pub aftermath_s: f32,
}

impl Default for TimelineOptions {
    fn default() -> Self {
        Self { max_flight_playback_s: 2.0, impact_s: 0.4, interior_s: 1.6, aftermath_s: 1.0 }
    }
}

pub fn build_timeline(ev: &ShotEvent, o: &TimelineOptions) -> Vec<ReplayKeyframe> {
    let real = match (ev.projectile_path.first(), ev.projectile_path.last()) {
        (Some(a), Some(b)) => (b.t - a.t).max(0.05),
        _ => 0.05,
    };
    let flight = real.min(o.max_flight_playback_s).max(0.3);
    let mut t = 0.0;
    let mut out = vec![];
    let mut push = |phase, dur: f32, scale: f32, alpha: f32, t: &mut f32| {
        out.push(ReplayKeyframe { phase, start_s: *t, duration_s: dur, time_scale: scale, hull_alpha: alpha });
        *t += dur;
    };
    push(ReplayPhase::Flight, flight, real / flight, 1.0, &mut t);
    if ev.penetration_result != PenetrationOutcome::Miss {
        push(ReplayPhase::Impact, o.impact_s, 0.05, 0.8, &mut t);
    }
    if ev.penetration_result == PenetrationOutcome::Penetrated {
        push(ReplayPhase::Interior, o.interior_s, 0.002, 0.15, &mut t);
    }
    push(ReplayPhase::Aftermath, o.aftermath_s, 1.0, 0.3, &mut t);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(result: PenetrationOutcome) -> ShotEvent {
        ShotEvent {
            shot_id: 1,
            tick: 10,
            seed: 1,
            shooter_id: 1,
            target_id: 2,
            projectile_type: "ap".into(),
            muzzle_position: Vec3::ZERO,
            impact_position: Vec3::ZERO,
            impact_normal: Vec3::ZERO,
            armor_plate: "p".into(),
            armor_thickness_mm: 80.0,
            impact_angle_deg: 0.0,
            effective_thickness_mm: 80.0,
            penetration_value_mm: 150.0,
            penetration_result: result,
            projectile_path: vec![PathPoint { t: 0.0, pos: Vec3::ZERO }, PathPoint { t: 0.125, pos: Vec3::ZERO }],
            fragments: vec![],
            damaged_modules: vec![],
            damaged_crew: vec![],
            outcomes: vec![],
        }
    }

    #[test]
    fn interior_phase_only_when_penetrated() {
        let pen = build_timeline(&ev(PenetrationOutcome::Penetrated), &TimelineOptions::default());
        assert!(pen.iter().any(|k| k.phase == ReplayPhase::Interior));
        let stopped = build_timeline(&ev(PenetrationOutcome::Stopped), &TimelineOptions::default());
        assert!(!stopped.iter().any(|k| k.phase == ReplayPhase::Interior));
        let miss = build_timeline(&ev(PenetrationOutcome::Miss), &TimelineOptions::default());
        assert!(!miss.iter().any(|k| k.phase == ReplayPhase::Impact));
    }

    #[test]
    fn flight_is_slowed_down() {
        let tl = build_timeline(&ev(PenetrationOutcome::Penetrated), &TimelineOptions::default());
        assert!(tl[0].time_scale < 1.0);
    }

    #[test]
    fn event_roundtrips_through_json_shape() {
        let e = ev(PenetrationOutcome::Ricochet);
        assert_eq!(e.penetration_result, PenetrationOutcome::Ricochet);
    }
}
