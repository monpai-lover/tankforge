//! Loader queue. A loader serves one gun at a time; guns that need a round wait, and each free
//! loader takes the gun that has waited longest. A turret with six guns and one loader fires its
//! broadside once and then reloads the guns one after another.
//! (client/web/src/sim/loading.js mirrors this file until the WASM build replaces it.)
use serde::{Deserialize,Serialize};
use crate::GunDef;

/// Evidence-bound fitted apparatus. A gun catalogue definition alone never grants it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanizedLoadingDef {
    pub mechanism:String,
    pub gun_id:String,
    pub ammo:Vec<String>,
    pub capacity:u32,
    pub cycle_s:f32,
    pub modules:Vec<String>,
    pub stages:Vec<MechanizedStage>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MechanizedStage {pub stage:String,pub at:f32}

impl MechanizedLoadingDef {
    pub fn valid_for(&self,gun:&GunDef)->bool {
        // Cartridge identity, not flight-body calibre: APFSDS remains subcalibre.
        const AZ_T72_AMMO:[&str;3]=["apfsds_125_3bm22","heatfs_125_3bk14","he_125_3of26"];
        self.mechanism=="az_t72" && self.gun_id=="2a46_1_125" && self.gun_id==gun.id && gun.caliber_mm==125.0 && gun.autocannon.is_none() && gun.missile.is_none()
            && self.capacity>0 && self.capacity<=22 && self.cycle_s.is_finite() && self.cycle_s>0.0
            && self.ammo==gun.ammo && !self.ammo.is_empty() && gun.ammo_count.len()==gun.ammo.len()
            && self.ammo.iter().enumerate().all(|(i,id)|AZ_T72_AMMO.contains(&id.as_str())&&!self.ammo[..i].contains(id))
            && gun.ammo_count.iter().try_fold(0u32,|n,x|n.checked_add(*x)).is_some_and(|n|n<=self.capacity)
            && !self.modules.is_empty() && self.modules.iter().enumerate().all(|(i,id)|!id.is_empty()&&!self.modules[..i].contains(id))
            && self.stages.len()==3 && self.stages.iter().enumerate().all(|(i,s)|{
                s.stage==["select_lift","projectile_ram","charge_ram"][i] && s.at.is_finite() && s.at>=0.0 && s.at<1.0
                    && if i==0 {s.at==0.0} else {s.at>self.stages[i-1].at}
            })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GunLoadState {
    Ready,
    Waiting,
    Loading,
}

#[derive(Clone, Copy, Debug)]
struct LoaderState {
    gun: Option<usize>,
    remaining: f32,
    total: f32,
    only_gun:Option<usize>,
}

#[derive(Clone, Debug)]
pub struct Loading {
    loaders: Vec<LoaderState>,
    /// No dedicated loader: the gunner loads, 1.6x slower.
    no_dedicated_loader: bool,
    pub state: Vec<GunLoadState>,
    waited_since: Vec<f32>,
    clock: f32,
    independent:Vec<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LoadProgress {
    pub remaining_s: f32,
    pub total_s: f32,
    /// True while the gun is still waiting for a free loader.
    pub waiting: bool,
}

impl Loading {
    pub fn new(gun_count: usize, loader_count: usize) -> Self {
        Loading {
            loaders: vec![LoaderState { gun: None, remaining: 0.0, total: 0.0, only_gun:None }; loader_count.max(1)],
            no_dedicated_loader: loader_count == 0,
            state: vec![GunLoadState::Ready; gun_count],
            waited_since: vec![0.0; gun_count],
            clock: 0.0,
            independent:vec![false;gun_count],
        }
    }

    /// A fitted mechanism serves exactly its mounted gun and never consumes a crew slot.
    pub fn for_mounts(guns:&[GunDef],loader_count:usize,mechanisms:&[Option<MechanizedLoadingDef>])->Result<Self,&'static str> {
        if guns.len()!=mechanisms.len() || mechanisms.iter().zip(guns).any(|(m,g)|m.as_ref().is_some_and(|m|!m.valid_for(g))) {
            return Err("invalid or incompatible mechanized carousel");
        }
        let mut l=Self::new(guns.len(),loader_count);
        l.independent=mechanisms.iter().map(Option::is_some).collect();
        if !guns.is_empty() && l.independent.iter().all(|v|*v) {l.loaders.clear();}
        for (gi,on) in l.independent.iter().enumerate() {
            if *on {l.loaders.push(LoaderState{gun:None,remaining:0.0,total:0.0,only_gun:Some(gi)});}
        }
        Ok(l)
    }

    /// Marks a gun as fired (empty).
    pub fn fired(&mut self, gun: usize) {
        self.state[gun] = GunLoadState::Waiting;
        self.waited_since[gun] = self.clock;
    }

    pub fn progress(&self, gun: usize) -> LoadProgress {
        match self.state[gun] {
            GunLoadState::Ready => LoadProgress { remaining_s: 0.0, total_s: 1.0, waiting: false },
            GunLoadState::Waiting => LoadProgress { remaining_s: f32::INFINITY, total_s: 1.0, waiting: true },
            GunLoadState::Loading => {
                let l = self.loaders.iter().find(|l| l.gun == Some(gun)).expect("loading gun has a loader");
                LoadProgress { remaining_s: l.remaining, total_s: l.total, waiting: false }
            }
        }
    }

    /// Advances all loaders. `reload_time(gun, loader)` gives the seconds one round takes.
    /// Returns the guns that became ready during this step.
    pub fn tick(&mut self, dt: f32, reload_time: impl Fn(usize, usize) -> f32) -> Vec<usize> {
        self.tick_with_rate(dt,reload_time,|_,_|1.0)
    }

    /// Dynamic physical work rate pauses destruction/repair and retains in-progress damage.
    pub fn tick_with_rate(&mut self, dt:f32,reload_time:impl Fn(usize,usize)->f32,rate:impl Fn(usize,usize)->f32)->Vec<usize> {
        self.clock += dt;
        let mut done = Vec::new();
        for i in 0..self.loaders.len() {
            let mut budget = dt;
            for _ in 0..4 {
                if budget <= 0.0 {
                    break;
                }
                if self.loaders[i].gun.is_none() {
                    let mut pick: Option<usize> = None;
                    for g in 0..self.state.len() {
                        if self.state[g] != GunLoadState::Waiting {
                            continue;
                        }
                        if self.loaders[i].only_gun.map_or(self.independent[g],|own|own!=g) {continue;}
                        if pick.map_or(true, |p| self.waited_since[g] < self.waited_since[p]) {
                            pick = Some(g);
                        }
                    }
                    let Some(g) = pick else { break };
                    let only_gun=self.loaders[i].only_gun;
                    let total = reload_time(g, i) * if self.no_dedicated_loader && only_gun.is_none() { 1.6 } else { 1.0 };
                    self.loaders[i] = LoaderState { gun: Some(g), remaining: total, total, only_gun };
                    self.state[g] = GunLoadState::Loading;
                }
                let speed=rate(self.loaders[i].gun.unwrap(),i);
                if !speed.is_finite() || speed<=0.0 {break;}
                let used = (budget*speed).min(self.loaders[i].remaining);
                self.loaders[i].remaining -= used;
                budget -= used/speed;
                if self.loaders[i].remaining <= 1e-6 {
                    if let Some(g) = self.loaders[i].gun.take() {
                        self.state[g] = GunLoadState::Ready;
                        done.push(g);
                    }
                    self.loaders[i].remaining = 0.0;
                }
            }
        }
        done
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(l: &mut Loading, secs: f32, t: f32) -> usize {
        let mut ready = 0;
        let steps = (secs * 120.0).round() as usize;
        for _ in 0..steps {
            ready += l.tick(1.0 / 120.0, |_, _| t).len();
        }
        ready
    }

    #[test]
    fn one_loader_reloads_six_guns_one_after_another() {
        let mut l = Loading::new(6, 1);
        for g in 0..6 {
            l.fired(g);
        }
        assert_eq!(run(&mut l, 5.1, 5.0), 1);
        assert!(l.progress(5).waiting);
        assert_eq!(run(&mut l, 25.1, 5.0), 5);
        assert!(l.state.iter().all(|s| *s == GunLoadState::Ready));
    }

    #[test]
    fn two_loaders_work_in_parallel_and_take_the_longest_waiting_gun() {
        let mut l = Loading::new(4, 2);
        l.fired(2);
        run(&mut l, 1.0, 5.0);
        l.fired(0);
        l.fired(3);
        // gun 2 is being loaded by loader 0; loader 1 takes gun 0 (fired before gun 3 in the same instant: lower index first)
        run(&mut l, 0.1, 5.0);
        assert_eq!(l.state[2], GunLoadState::Loading);
        assert_eq!(l.state[0], GunLoadState::Loading);
        assert_eq!(l.state[3], GunLoadState::Waiting);
        assert_eq!(run(&mut l, 5.0, 5.0), 2);
    }

    #[test]
    fn no_dedicated_loader_is_slower() {
        let mut l = Loading::new(1, 0);
        l.fired(0);
        assert_eq!(run(&mut l, 7.9, 5.0), 0);
        assert_eq!(run(&mut l, 0.2, 5.0), 1);
    }

    #[test]
    fn fitted_mechanized_worker_is_independent_of_manual_gunner_work() {
        let gun=super::super::GunDef {
            id:"2a46_1_125".into(),caliber_mm:125.0,barrel_length_mm:6000.0,recoil_mm:310.0,
            rounds_per_min:7.5,reload_s:8.0,traverse_deg_s:18.0,elevate_deg_s:6.0,
            max_depression_deg:6.0,max_elevation_deg:13.0,dispersion_mrad:0.7,mass_kg:2500.0,
            ammo:vec!["he_125_3of26".into()],ammo_count:vec![22],autocannon:None,missile:None,weapon_group:None,damage:None
        };
        let mechanism=MechanizedLoadingDef {
            mechanism:"az_t72".into(),gun_id:gun.id.clone(),ammo:gun.ammo.clone(),capacity:22,cycle_s:8.0,
            modules:vec!["az_drive".into(),"az_ram".into()],stages:vec![
                MechanizedStage{stage:"select_lift".into(),at:0.0},MechanizedStage{stage:"projectile_ram".into(),at:0.32},MechanizedStage{stage:"charge_ram".into(),at:0.61}]
        };
        let mut l=Loading::for_mounts(&[gun.clone(),gun.clone()],0,&[None,Some(mechanism.clone())]).unwrap();
        l.fired(0);l.fired(1);
        assert!(l.tick_with_rate(100.0,|_,_|8.0,|_,_|0.0).is_empty());
        assert_eq!(l.tick_with_rate(8.0,|_,_|8.0,|_,_|1.0),vec![1]);
        assert_eq!(l.progress(0).total_s,12.8);
        assert_eq!(l.state[0],GunLoadState::Loading);
        assert_eq!(l.state[1],GunLoadState::Ready);
        let mut wrong=gun.clone();wrong.id="manual_125".into();
        assert!(Loading::for_mounts(&[wrong],0,&[Some(mechanism)]).is_err());
    }
}
