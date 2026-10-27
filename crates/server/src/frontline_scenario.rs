//! Server-owned mission outcome. Rendering and player aircraft losses do not
//! advance this state; callers provide post-damage accepted vessel lives.
use crate::frontline::UnitRef;
use crate::frontline_naval::{NavalConfig, VesselView};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub const TAIWAN_ESCORT: &str = "taiwan_landing_escort";
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LandingZone { pub center: [f64; 2], pub radius: f64, pub max_speed_mps: f64 }
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioConfig {
    pub version: u32,
    pub id: String,
    pub attacker_team: u8,
    pub defender_team: u8,
    pub unload_seconds: f64,
    pub timeout_seconds: f64,
    pub landing_zone: LandingZone,
    pub naval: NavalConfig,
}
#[derive(Clone, Debug)]
pub struct ScenarioState {
    pub config: ScenarioConfig,
    unloading: BTreeMap<UnitRef, f64>,
    outcome: Option<(u8, &'static str)>,
}
impl ScenarioState {
    pub fn for_map(map: &Value) -> Result<Option<Self>, String> {
        let Some(marker) = map.get("scenario").filter(|v| !v.is_null()) else {return Ok(None);};
        if marker.as_str() != Some(TAIWAN_ESCORT) {return Err("unknown frontline scenario".into());}
        let config: ScenarioConfig = serde_json::from_str(include_str!("../../../data/frontline/scenarios/taiwan-landing-escort.json"))
            .map_err(|e|format!("invalid naval scenario: {e}"))?;
        if config.version != 1 || config.id != TAIWAN_ESCORT || config.attacker_team > 1 || config.defender_team > 1
            || config.attacker_team == config.defender_team
            || ![config.unload_seconds,config.timeout_seconds,config.landing_zone.radius,config.landing_zone.max_speed_mps].iter().all(|v|v.is_finite()&&*v>0.)
            || !config.landing_zone.center.iter().all(|v|v.is_finite())
            || !config.naval.vessels.iter().any(|s|s.team==config.attacker_team&&s.role=="transport") {
            return Err("invalid naval mission rules".into());
        }
        Ok(Some(Self {config,unloading:BTreeMap::new(),outcome:None}))
    }
    pub fn step(&mut self, dt: f64, at: f64, vessels: &[VesselView]) {
        if self.outcome.is_some() || !dt.is_finite() || dt<=0. || !at.is_finite() {return;}
        let attackers:Vec<_>=vessels.iter().filter(|s|s.team==self.config.attacker_team).collect();
        // Post-damage life is authoritative. Escorts count toward fleet
        // annihilation even after every transport has been lost.
        if !attackers.is_empty() && attackers.iter().all(|s|!s.alive) {
            self.outcome=Some((self.config.defender_team,"attacker_fleet_annihilated"));return;
        }
        let mut completed=false;
        for ship in attackers.iter().filter(|s|s.role=="transport") {
            let zone=&self.config.landing_zone;
            let eligible=ship.alive&&(ship.pos[0]-zone.center[0]).hypot(ship.pos[2]-zone.center[1])<=zone.radius
                && ship.velocity[0].hypot(ship.velocity[2])<=zone.max_speed_mps;
            let elapsed=self.unloading.entry(ship.unit).or_default();
            if eligible {*elapsed=(*elapsed+dt).min(self.config.unload_seconds);}else{*elapsed=0.;}
            completed|=*elapsed+1e-9>=self.config.unload_seconds;
        }
        self.unloading.retain(|id,_|vessels.iter().any(|s|s.unit==*id));
        if completed {self.outcome=Some((self.config.attacker_team,"landing_completed"));}
        else if at+1e-9>=self.config.timeout_seconds {self.outcome=Some((self.config.defender_team,"landing_timeout"));}
    }
    pub fn outcome(&self) -> Option<(u8, &'static str)> { self.outcome }
    pub fn status(&self, vessels: &[VesselView]) -> Value {
        json!({"id":self.config.id,"attacker_team":self.config.attacker_team,"defender_team":self.config.defender_team,
            "unload_required_s":self.config.unload_seconds,"timeout_seconds":self.config.timeout_seconds,
            "landing_zone":{"center":[self.config.landing_zone.center[0],0.,self.config.landing_zone.center[1]],"radius":self.config.landing_zone.radius},
            "unloading_s":self.unloading.values().copied().fold(0.,f64::max),
            "surviving_fleet":vessels.iter().filter(|s|s.team==self.config.attacker_team&&s.alive).count(),
            "surviving_transports":vessels.iter().filter(|s|s.team==self.config.attacker_team&&s.alive&&s.role=="transport").count(),
            "winner":self.outcome.map(|o|o.0),"reason":self.outcome.map(|o|o.1)})
    }
    pub fn decorate(&self, vessels: &mut [VesselView]) {
        for ship in vessels {ship.unloading_s=self.unloading.get(&ship.unit).copied().unwrap_or(0.);}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn state() -> ScenarioState {
        ScenarioState::for_map(&json!({"scenario":TAIWAN_ESCORT})).unwrap().unwrap()
    }
    fn views() -> Vec<VesselView> {
        let mut next = 1;
        crate::frontline_naval::NavalWorld::new(&state().config.naval, 7, &mut next).unwrap().views()
    }
    #[test]
    fn naval_scenario_waits_for_fifteen_contiguous_seconds_at_landing_zone() {
        let mut mission = state(); let mut ships = views();
        let transport = ships.iter_mut().find(|s| s.team == 0 && s.role == "transport").unwrap();
        transport.pos[0] = mission.config.landing_zone.center[0];
        transport.pos[2] = mission.config.landing_zone.center[1]; transport.velocity = [0.;3];
        mission.step(14.,14.,&ships); assert_eq!(mission.outcome(),None);
        mission.step(1.,15.,&ships); assert_eq!(mission.outcome(),Some((0,"landing_completed")));
        mission.step(1.,9999.,&[]); assert_eq!(mission.outcome(),Some((0,"landing_completed")),"accepted result is immutable");
    }
    #[test]
    fn leaving_zone_resets_progress_and_damage_is_admitted_before_unloading() {
        let mut mission=state();let mut ships=views();let index=ships.iter().position(|s|s.team==0&&s.role=="transport").unwrap();
        ships[index].pos=[mission.config.landing_zone.center[0],0.,mission.config.landing_zone.center[1]];ships[index].velocity=[0.;3];
        mission.step(14.,14.,&ships); ships[index].pos[0]+=1000.; mission.step(1.,15.,&ships);
        ships[index].pos[0]-=1000.;mission.step(1.,16.,&ships);assert_eq!(mission.outcome(),None);
        ships[index].alive=false;mission.step(15.,31.,&ships);assert_eq!(mission.outcome(),None,"live escorts keep fleet from annihilation; sunk transport cannot unload");
    }
    #[test]
    fn defender_must_sink_all_attacker_transports_and_escorts() {
        let mut mission=state();let mut ships=views();
        for s in &mut ships {if s.team==0&&s.role=="transport" {s.alive=false;}}
        mission.step(0.05,0.05,&ships);assert_eq!(mission.outcome(),None);
        for s in &mut ships {if s.team==0 {s.alive=false;}}
        mission.step(0.05,0.1,&ships);assert_eq!(mission.outcome(),Some((1,"attacker_fleet_annihilated")));
    }
    #[test]
    fn scenario_timeout_awards_defender_without_score_or_aircraft_inputs() {
        let mut mission=state();let ships=views();mission.step(0.05,mission.config.timeout_seconds,&ships);
        assert_eq!(mission.outcome(),Some((1,"landing_timeout")));
        assert!(ScenarioState::for_map(&json!({"id":"taiwan"})).unwrap().is_none());
    }
    #[test]
    fn invalid_or_unknown_scenario_fails_closed() {
        assert!(ScenarioState::for_map(&json!({"scenario":"unregistered_mission"})).is_err());
    }
}
