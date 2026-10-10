//! Shared health semantics and the first-round module performance curves.
//! This owner has no geometry, vehicle-state, serialization or runtime dependencies.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModuleStateLevel {
    Operational,
    Damaged,
    Destroyed,
}

/// Health kept inside the physical module's supported range.
pub fn clamp_health(health: f32, max_health: f32) -> f32 {
    health.max(0.0).min(max_health.max(0.0))
}

/// Normalized health, including legacy negative health and invalid zero-capacity modules.
pub fn health_ratio(health: f32, max_health: f32) -> f32 {
    if max_health > 0.0 { clamp_health(health, max_health) / max_health } else { 0.0 }
}

pub fn state_level(health: f32, max_health: f32) -> ModuleStateLevel {
    let h = health_ratio(health, max_health);
    if h > 0.5 { ModuleStateLevel::Operational }
    else if h > 0.0 { ModuleStateLevel::Damaged }
    else { ModuleStateLevel::Destroyed }
}

/// Apply nonnegative damage and return the actual health lost, never the attempted overkill.
pub fn apply_health_damage(health: &mut f32, max_health: f32, damage: f32) -> f32 {
    let before = clamp_health(*health, max_health);
    *health = clamp_health(before - damage.max(0.0), max_health);
    before - *health
}

pub fn engine_power_factor(h: f32) -> f32 {
    let h = clamp_health(h, 1.0);
    if h > 0.0 { (0.6 + 0.8 * h).min(1.0) } else { 0.0 }
}

pub fn transmission_factor(h: f32) -> f32 {
    let h = clamp_health(h, 1.0);
    if h > 0.0 { (0.5 + h).min(1.0) } else { 0.0 }
}

pub fn traverse_factor(h: f32) -> f32 {
    let h = clamp_health(h, 1.0);
    if h > 0.0 { (0.35 + 1.3 * h).min(1.0) } else { 0.15 }
}

pub fn elevation_factor(h: f32) -> f32 {
    let h = clamp_health(h, 1.0);
    if h > 0.0 { (0.5 + h).min(1.0) } else { 0.3 }
}

/// Relevant barrel/breech health affects dispersion; zero health separately prevents firing.
pub fn dispersion_multiplier(h: f32) -> f32 {
    1.0 + (1.0 - 2.0 * clamp_health(h, 1.0)).max(0.0)
}

/// Damage to a rack with rounds slows feeding; this never changes its ammunition load.
pub fn ammo_reload_multiplier(h: f32) -> f32 {
    1.0 + 0.5 * (1.0 - 2.0 * clamp_health(h, 1.0)).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_bounds_levels_and_actual_loss_agree() {
        assert_eq!(health_ratio(-10.0, 100.0), 0.0);
        assert_eq!(health_ratio(150.0, 100.0), 1.0);
        assert_eq!(health_ratio(10.0, 0.0), 0.0);
        assert_eq!(state_level(50.01, 100.0), ModuleStateLevel::Operational);
        assert_eq!(state_level(50.0, 100.0), ModuleStateLevel::Damaged);
        assert_eq!(state_level(0.01, 100.0), ModuleStateLevel::Damaged);
        assert_eq!(state_level(0.0, 100.0), ModuleStateLevel::Destroyed);
        let mut health = 10.0;
        assert_eq!(apply_health_damage(&mut health, 100.0, 400.0), 10.0);
        assert_eq!(health, 0.0);
        assert_eq!(apply_health_damage(&mut health, 100.0, 400.0), 0.0);
        assert_eq!(apply_health_damage(&mut health, 100.0, -20.0), 0.0);
    }

    #[test]
    fn curves_have_approved_endpoints_and_partial_values() {
        for f in [engine_power_factor, transmission_factor, traverse_factor, elevation_factor,
            dispersion_multiplier, ammo_reload_multiplier] {
            assert_eq!(f(1.0), 1.0);
            assert_eq!(f(0.6), 1.0);
            assert_eq!(f(0.5), 1.0);
            assert_eq!(f(2.0), 1.0);
            assert_eq!(f(-1.0), f(0.0));
        }
        assert_eq!(engine_power_factor(0.0), 0.0);
        assert_eq!(transmission_factor(0.0), 0.0);
        assert_eq!(traverse_factor(0.0), 0.15);
        assert_eq!(elevation_factor(0.0), 0.3);
        assert_eq!(dispersion_multiplier(0.0), 2.0);
        assert_eq!(ammo_reload_multiplier(0.0), 1.5);
        for (actual, expected) in [(engine_power_factor(0.25), 0.8),
            (transmission_factor(0.25), 0.75), (traverse_factor(0.25), 0.675),
            (elevation_factor(0.25), 0.75), (dispersion_multiplier(0.25), 1.5),
            (ammo_reload_multiplier(0.25), 1.25)] {
            assert!((actual - expected).abs() < 1e-6);
        }
    }

    #[test]
    fn all_curves_improve_monotonically_with_health() {
        for step in 0..100 {
            let (a, b) = (step as f32 / 100.0, (step + 1) as f32 / 100.0);
            for f in [engine_power_factor, transmission_factor, traverse_factor, elevation_factor] {
                assert!(f(a) <= f(b) && f(a) >= 0.0 && f(b) <= 1.0);
            }
            for f in [dispersion_multiplier, ammo_reload_multiplier] {
                assert!(f(a) >= f(b) && f(b) >= 1.0);
            }
        }
    }
}
