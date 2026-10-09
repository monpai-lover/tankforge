//! Loader queue. A loader serves one gun at a time; guns that need a round wait, and each free
//! loader takes the gun that has waited longest. A turret with six guns and one loader fires its
//! broadside once and then reloads the guns one after another.
//! (client/web/src/sim/loading.js mirrors this file until the WASM build replaces it.)

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
}

#[derive(Clone, Debug)]
pub struct Loading {
    loaders: Vec<LoaderState>,
    /// No dedicated loader: the gunner loads, 1.6x slower.
    no_dedicated_loader: bool,
    pub state: Vec<GunLoadState>,
    waited_since: Vec<f32>,
    clock: f32,
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
            loaders: vec![LoaderState { gun: None, remaining: 0.0, total: 0.0 }; loader_count.max(1)],
            no_dedicated_loader: loader_count == 0,
            state: vec![GunLoadState::Ready; gun_count],
            waited_since: vec![0.0; gun_count],
            clock: 0.0,
        }
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
                        if pick.map_or(true, |p| self.waited_since[g] < self.waited_since[p]) {
                            pick = Some(g);
                        }
                    }
                    let Some(g) = pick else { break };
                    let total = reload_time(g, i) * if self.no_dedicated_loader { 1.6 } else { 1.0 };
                    self.loaders[i] = LoaderState { gun: Some(g), remaining: total, total };
                    self.state[g] = GunLoadState::Loading;
                }
                let used = budget.min(self.loaders[i].remaining);
                self.loaders[i].remaining -= used;
                budget -= used;
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
}
