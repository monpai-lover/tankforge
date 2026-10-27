//! Campaign ownership and supply adjacency for physically occupied objectives.
//! The caller supplies accepted ground bodies. This never moves or invents units,
//! opens an unregistered road, or treats an aircraft as a ground occupier.
use crate::frontline::{ObjectiveView, Team};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Clone, Debug)]
pub struct Presence {
    pub team: Team,
    pub pos: [f64; 3],
    pub alive: bool,
}

#[derive(Clone, Debug)]
struct GroundRoute {
    id: String,
    from: String,
    to: String,
    lane: String,
    points: Vec<[f64; 2]>,
    cumulative: Vec<f64>,
    half_width: f64,
    open: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct NavigationPlan {
    pub points: Vec<[f64; 2]>,
    pub roads: Vec<String>,
    pub front: String,
    pub target: [f64; 2],
    pub half_width: f64,
    cursor: usize,
}
impl NavigationPlan {
    /// Only a host-validated registered/local support path may use this.
    pub(crate) fn support_prefix(points:Vec<[f64;2]>,roads:Vec<String>,front:String,half_width:f64)->Option<Self> {
        if points.len()<2 || points.iter().flatten().any(|v|!v.is_finite()) {return None;}
        let target=*points.last()?;
        Some(Self{points,roads,front,target,half_width,cursor:0})
    }
    #[cfg(test)]
    pub(crate) fn registered_test_plan(
        map: &Value,
        from: [f64; 2],
        to: [f64; 2],
        road: &str,
    ) -> Self {
        Navigation::load(map)
            .expect("valid source navigation")
            .plan(from, to, Some(road))
            .expect("registered source case")
    }
    pub fn current_index(&self) -> usize {
        self.cursor
    }
    pub fn next_waypoint(&self) -> Option<[f64; 2]> {
        self.points.get(self.cursor + 1).copied()
    }
    pub fn waypoint(&mut self, position: [f64; 3]) -> [f64; 2] {
        let position = [position[0], position[2]];
        while self.cursor + 1 < self.points.len() {
            let at = self.points[self.cursor];
            let distance = horizontal(at, position);
            let passed = if self.cursor > 0 && distance < self.half_width {
                let before = self.points[self.cursor - 1];
                let after = self.points[self.cursor + 1];
                let a = horizontal(at, before);
                let b = horizontal(at, after);
                // The bisector is a progress plane at the registered junction.
                // A finite hull can round a corner without visiting its exact
                // mathematical vertex; never command it back against traffic.
                a > 1e-6
                    && b > 1e-6
                    && (position[0] - at[0]) * ((at[0] - before[0]) / a + (after[0] - at[0]) / b)
                        + (position[1] - at[1]) * ((at[1] - before[1]) / a + (after[1] - at[1]) / b)
                        >= 0.0
            } else {
                false
            };
            if distance >= (self.half_width * 0.5).min(4.0) && !passed {
                break;
            }
            self.cursor += 1;
        }
        self.points[self.cursor]
    }
    pub fn point_after(&self, mut metres: f64) -> [f64; 2] {
        for pair in self.points.windows(2) {
            let length = horizontal(pair[0], pair[1]);
            if length > metres {
                let t = metres.max(0.0) / length;
                return [
                    pair[0][0] + (pair[1][0] - pair[0][0]) * t,
                    pair[0][1] + (pair[1][1] - pair[0][1]) * t,
                ];
            }
            metres -= length;
        }
        *self.points.last().expect("validated route plan")
    }
    pub fn length(&self) -> f64 {
        self.points.windows(2).map(|p| horizontal(p[0], p[1])).sum()
    }
    pub fn prepend(&mut self, points: &[[f64; 2]]) {
        let mut joined = points.to_vec();
        append_path(&mut joined, &self.points);
        self.points = joined;
        self.cursor = 0;
    }
    pub fn append(&mut self, points: &[[f64; 2]]) {
        append_path(&mut self.points, points);
        if let Some(last) = points.last() {
            self.target = *last;
        }
    }
}

#[derive(Clone, Debug, Default)]
struct Navigation {
    routes: BTreeMap<String, GroundRoute>,
}
fn horizontal(a: [f64; 2], b: [f64; 2]) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}
fn append_path(out: &mut Vec<[f64; 2]>, points: &[[f64; 2]]) {
    for &point in points {
        if out
            .last()
            .is_none_or(|last| horizontal(*last, point) > 1e-6)
        {
            out.push(point);
        }
    }
}
impl GroundRoute {
    fn length(&self) -> f64 {
        *self.cumulative.last().unwrap()
    }
    fn project(&self, point: [f64; 2]) -> (f64, f64, [f64; 2]) {
        self.points
            .windows(2)
            .enumerate()
            .map(|(i, pair)| {
                let a = pair[0];
                let b = pair[1];
                let dx = b[0] - a[0];
                let dz = b[1] - a[1];
                let squared = dx * dx + dz * dz;
                let t =
                    (((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / squared).clamp(0.0, 1.0);
                let at = [a[0] + t * dx, a[1] + t * dz];
                (
                    horizontal(point, at),
                    self.cumulative[i] + t * squared.sqrt(),
                    at,
                )
            })
            .min_by(|a, b| a.0.total_cmp(&b.0))
            .unwrap()
    }
    fn at(&self, metres: f64) -> [f64; 2] {
        let metres = metres.clamp(0.0, self.length());
        let i = self
            .cumulative
            .windows(2)
            .position(|w| metres <= w[1])
            .unwrap_or(self.points.len() - 2);
        let t = (metres - self.cumulative[i]) / (self.cumulative[i + 1] - self.cumulative[i]);
        [
            self.points[i][0] + (self.points[i + 1][0] - self.points[i][0]) * t,
            self.points[i][1] + (self.points[i + 1][1] - self.points[i][1]) * t,
        ]
    }
    fn subpath(&self, from: f64, to: f64) -> Vec<[f64; 2]> {
        if from > to {
            let mut path = self.subpath(to, from);
            path.reverse();
            return path;
        }
        let mut path = vec![self.at(from)];
        for (i, &s) in self.cumulative.iter().enumerate() {
            if s > from + 1e-6 && s < to - 1e-6 {
                path.push(self.points[i]);
            }
        }
        append_path(&mut path, &[self.at(to)]);
        path
    }
}
impl Navigation {
    fn load(map: &Value) -> Result<Self, String> {
        let mut result = Self::default();
        let mut junctions: BTreeMap<String, [f64; 2]> = BTreeMap::new();
        for value in map["roads"].as_array().into_iter().flatten() {
            if value["navEnabled"] != true || value["connected"] != true {
                continue;
            }
            let id = value["id"]
                .as_str()
                .ok_or("Enabled road has no ID")?
                .to_owned();
            let from = value["from"]
                .as_str()
                .ok_or("Enabled road has no origin")?
                .to_owned();
            let to = value["to"]
                .as_str()
                .ok_or("Enabled road has no destination")?
                .to_owned();
            let half_width = value["halfWidth"].as_f64().unwrap_or(8.0);
            if !half_width.is_finite() || !(3.0..=40.0).contains(&half_width) || from == to {
                return Err(format!("Invalid registered route {id}"));
            }
            let mut points = Vec::new();
            for point in value["points"]
                .as_array()
                .ok_or("Enabled road needs physical points")?
            {
                let p = point
                    .as_array()
                    .filter(|a| a.len() == 3)
                    .ok_or("Road point needs x/y/z")?;
                let xyz = [p[0].as_f64(), p[1].as_f64(), p[2].as_f64()];
                if xyz.iter().any(|v| v.is_none_or(|v| !v.is_finite())) {
                    return Err("Nonfinite road point".into());
                }
                let q = [xyz[0].unwrap(), xyz[2].unwrap()];
                if points
                    .last()
                    .is_none_or(|last| horizontal(*last, q) > 0.001)
                {
                    points.push(q);
                }
            }
            if points.len() < 2 {
                return Err(format!("Registered route {id} is degenerate"));
            }
            for (node, &position) in [
                (&from, points.first().unwrap()),
                (&to, points.last().unwrap()),
            ] {
                if junctions
                    .get(node)
                    .is_some_and(|old| horizontal(*old, position) > 0.25)
                {
                    return Err(format!("Unregistered physical gap at road junction {node}"));
                }
                junctions.insert(node.clone(), position);
            }
            let mut cumulative = vec![0.0];
            for pair in points.windows(2) {
                cumulative.push(cumulative.last().unwrap() + horizontal(pair[0], pair[1]));
            }
            let route = GroundRoute {
                id: id.clone(),
                from,
                to,
                lane: value["lane"].as_str().unwrap_or("centre").into(),
                points,
                cumulative,
                half_width,
                open: true,
            };
            if result.routes.insert(id, route).is_some() {
                return Err("Duplicate registered navigation route".into());
            }
        }
        Ok(result)
    }
    fn closest(
        &self,
        point: [f64; 2],
        required: Option<&str>,
    ) -> Option<(&GroundRoute, f64, [f64; 2])> {
        self.routes
            .values()
            .filter(|r| r.open && required.is_none_or(|id| r.id == id))
            .filter_map(|r| {
                let (distance, along, at) = r.project(point);
                (distance <= r.half_width).then_some((r, distance, along, at))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.0.id.cmp(&b.0.id)))
            .map(|(r, _, s, at)| (r, s, at))
    }
    fn node_path(&self, from: &str, to: &str) -> Option<(f64, Vec<(String, bool)>)> {
        let mut distances = BTreeMap::from([(from.to_owned(), 0.0f64)]);
        let mut previous: BTreeMap<String, (String, String, bool)> = BTreeMap::new();
        let mut visited = BTreeSet::new();
        loop {
            let (node, cost) = distances
                .iter()
                .filter(|(id, _)| !visited.contains(*id))
                .min_by(|a, b| a.1.total_cmp(b.1).then_with(|| a.0.cmp(b.0)))
                .map(|(id, &cost)| (id.clone(), cost))?;
            if node == to {
                let mut route = Vec::new();
                let mut at = node;
                while at != from {
                    let (parent, road, forward) = previous.get(&at)?.clone();
                    route.push((road, forward));
                    at = parent;
                }
                route.reverse();
                return Some((cost, route));
            }
            visited.insert(node.clone());
            for road in self.routes.values().filter(|r| r.open) {
                let (next, forward) = if road.from == node {
                    (&road.to, true)
                } else if road.to == node {
                    (&road.from, false)
                } else {
                    continue;
                };
                let candidate = cost + road.length();
                if distances
                    .get(next)
                    .is_none_or(|old| candidate < *old - 1e-6)
                {
                    distances.insert(next.clone(), candidate);
                    previous.insert(next.clone(), (node.clone(), road.id.clone(), forward));
                }
            }
        }
    }
    fn plan(
        &self,
        here: [f64; 2],
        target: [f64; 2],
        start_road: Option<&str>,
    ) -> Option<NavigationPlan> {
        let (start, start_s, start_at) = self.closest(here, start_road)?;
        let (goal, goal_s, goal_at) = self.closest(target, None)?;
        let mut candidates: Vec<NavigationPlan> = Vec::new();
        let make = |points, roads, half_width| NavigationPlan {
            points,
            roads,
            half_width,
            front: goal.lane.clone(),
            target,
            cursor: 0,
        };
        if start.id == goal.id {
            candidates.push(make(
                start.subpath(start_s, goal_s),
                vec![start.id.clone()],
                start.half_width,
            ));
        }
        for (origin, origin_s) in [(&start.from, 0.0), (&start.to, start.length())] {
            for (destination, destination_s) in [(&goal.from, 0.0), (&goal.to, goal.length())] {
                let Some((_, middle)) = self.node_path(origin, destination) else {
                    continue;
                };
                let mut points = start.subpath(start_s, origin_s);
                let mut roads = vec![start.id.clone()];
                let mut width = start.half_width.min(goal.half_width);
                for (id, forward) in middle {
                    let road = &self.routes[&id];
                    append_path(
                        &mut points,
                        &road.subpath(
                            if forward { 0.0 } else { road.length() },
                            if forward { road.length() } else { 0.0 },
                        ),
                    );
                    roads.push(id);
                    width = width.min(road.half_width);
                }
                append_path(&mut points, &goal.subpath(destination_s, goal_s));
                roads.push(goal.id.clone());
                roads.dedup();
                candidates.push(make(points, roads, width));
            }
        }
        let mut result = candidates.into_iter().min_by(|a, b| {
            a.length()
                .total_cmp(&b.length())
                .then_with(|| a.roads.cmp(&b.roads))
        })?;
        // Only short in-corridor entry/exit pieces, never a shortcut between fronts.
        if horizontal(here, start_at) > 1e-6 {
            result.prepend(&[here]);
        }
        if horizontal(target, goal_at) > 1e-6 {
            result.append(&[target]);
        }
        Some(result)
    }
}
pub struct Campaign {
    air_frontline: bool,
    lanes: BTreeMap<String, String>,
    initial: BTreeMap<String, Option<Team>>,
    edges: BTreeMap<String, (String, String, bool)>,
    entries: [BTreeSet<String>; 2],
    terminals: [BTreeSet<String>; 2],
    capture_seconds: f64,
    ticket_seconds: f64,
    pressure_seconds: [f64; 2],
    navigation: Navigation,
    route_constraints: BTreeMap<String,[bool;2]>,
}
#[derive(Default)]
pub struct CampaignOutcome {
    pub readiness_cost: [u32; 2],
    pub events: Vec<Value>,
}
fn index(team: Team) -> usize {
    if team == Team::Blue {
        0
    } else {
        1
    }
}
impl Campaign {
    pub fn load(map: &Value, points: &mut [ObjectiveView]) -> Result<Self, String> {
        if points.is_empty() {
            return Err("campaign has no active objectives".into());
        }
        let ids: BTreeSet<_> = points.iter().map(|p| p.id.clone()).collect();
        if ids.len() != points.len() {
            return Err("duplicate campaign objective".into());
        }
        let cfg = &map["campaign"];
        let capture_seconds = cfg["captureSeconds"].as_f64().unwrap_or(30.0);
        let ticket_seconds = cfg["pressureTicketSeconds"].as_f64().unwrap_or(10.0);
        if !capture_seconds.is_finite()
            || !(10.0..=300.0).contains(&capture_seconds)
            || !ticket_seconds.is_finite()
            || !(1.0..=300.0).contains(&ticket_seconds)
        {
            return Err("invalid campaign capture/pressure timing".into());
        }
        let read_ids = |key: &str, side: usize| -> Result<BTreeSet<String>, String> {
            let values: BTreeSet<_> = cfg[key][side]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect();
            if values.iter().any(|id| !ids.contains(id)) {
                return Err(format!("unknown campaign {key}"));
            }
            Ok(values)
        };
        let mut entries = [
            read_ids("supplyEntrypoints", 0)?,
            read_ids("supplyEntrypoints", 1)?,
        ];
        // Compatibility for the existing single-objective road scene. Larger
        // authored campaigns must register their rear supply entry objectives.
        if points.len() == 1 {
            for side in &mut entries {
                if side.is_empty() {
                    side.insert(points[0].id.clone());
                }
            }
        } else if entries.iter().any(BTreeSet::is_empty) {
            return Err("multi-objective campaign needs explicit supply entries".into());
        }
        let navigation = Navigation::load(map)?;
        let mut edges = BTreeMap::new();
        for road in map["roads"].as_array().into_iter().flatten() {
            let (Some(id), Some(a), Some(b)) = (
                road["id"].as_str(),
                road["from"].as_str(),
                road["to"].as_str(),
            ) else {
                continue;
            };
            if ids.contains(a) && ids.contains(b) && road["connected"] == true {
                // A topology extract is insufficient: only an authored enabled
                // runtime route grants supply or an advance to its next point.
                edges.insert(id.into(), (a.into(), b.into(), road["navEnabled"] == true));
            }
        }
        let lanes = points
            .iter()
            .map(|p| {
                let lane = map["objectives"]
                    .as_array()
                    .and_then(|v| v.iter().find(|o| o["id"] == p.id))
                    .and_then(|o| o["lane"].as_str())
                    .unwrap_or("centre");
                (p.id.clone(), lane.into())
            })
            .collect();
        let route_constraints=navigation.routes.iter().map(|(id,r)|(id.clone(),[r.open,true])).collect();
        let mut result = Self {
            air_frontline: false,
            lanes,
            initial: points.iter().map(|p| (p.id.clone(), p.owner)).collect(),
            edges,
            entries,
            terminals: [
                read_ids("terminalObjectives", 0)?,
                read_ids("terminalObjectives", 1)?,
            ],
            capture_seconds,
            ticket_seconds,
            pressure_seconds: [0.0; 2],
            navigation,
            route_constraints,
        };
        result.refresh(points);
        Ok(result)
    }
    fn access(&self, points: &[ObjectiveView], team: Team) -> (BTreeSet<String>, BTreeSet<String>) {
        let mut supplied = BTreeSet::new();
        let mut capturable = self.entries[index(team)].clone();
        let mut queue = VecDeque::new();
        for p in points
            .iter()
            .filter(|p| p.owner == Some(team) && self.entries[index(team)].contains(&p.id))
        {
            supplied.insert(p.id.clone());
            queue.push_back(p.id.clone());
        }
        while let Some(id) = queue.pop_front() {
            for (a, b, open) in self.edges.values() {
                if !open {
                    continue;
                }
                let next = if a == &id {
                    b
                } else if b == &id {
                    a
                } else {
                    continue;
                };
                capturable.insert(next.clone());
                if points
                    .iter()
                    .any(|p| &p.id == next && p.owner == Some(team))
                    && supplied.insert(next.clone())
                {
                    queue.push_back(next.clone());
                }
            }
        }
        (supplied, capturable)
    }
    pub(crate) fn set_air_frontline(&mut self, points: &mut [ObjectiveView], enabled: bool) {
        self.air_frontline = enabled;
        self.refresh(points);
    }
    pub fn refresh(&mut self, points: &mut [ObjectiveView]) {
        let access = [
            self.access(points, Team::Blue),
            self.access(points, Team::Red),
        ];
        for p in points {
            p.lane = self.lanes[&p.id].clone();
            p.capturable = [access[0].1.contains(&p.id), access[1].1.contains(&p.id)];
            p.supplied = [access[0].0.contains(&p.id), access[1].0.contains(&p.id)];
            if self.air_frontline {
                // The retained rear objectives are navigation/supply anchors,
                // not additional capture prerequisites or playable zones.
                p.capturable = [matches!(p.id.as_str(), "W2" | "C2" | "E2"); 2];
            }
        }
    }
    /// Native infrastructure owner controls only registered routes. It must
    /// aggregate every bridge/facility on a road before reopening that road;
    /// repairing one bridge does not independently authorize a route here.
    pub fn set_route_open(&mut self, road: &str, open: bool, points: &mut [ObjectiveView]) -> Result<(), String> {
        self.set_route_constraint(road,open,0,points)
    }
    pub(crate) fn set_facility_route_open(&mut self,road:&str,open:bool,points:&mut[ObjectiveView])->Result<(),String>{
        self.set_route_constraint(road,open,1,points)
    }
    fn set_route_constraint(&mut self,road:&str,open:bool,owner:usize,points:&mut[ObjectiveView])->Result<(),String>{
        let constraints=self.route_constraints.get_mut(road).ok_or("unregistered campaign route")?;
        if constraints[owner]==open {return Ok(());}
        constraints[owner]=open;let open=constraints.iter().all(|v|*v);
        let route = self.navigation.routes.get_mut(road).ok_or("unregistered campaign route")?;
        route.open = open;
        if let Some(edge) = self.edges.get_mut(road) { edge.2 = open; }
        self.refresh(points);
        Ok(())
    }
    pub fn close_route(&mut self, road: &str, points: &mut [ObjectiveView]) -> Result<(), String> {
        self.set_route_open(road, false, points)
    }
    pub(crate) fn route_open(&self, road: &str) -> bool {
        self.navigation.routes.get(road).is_some_and(|r| r.open)
    }
    pub(crate) fn route_front(&self, road: &str) -> Option<&str> {
        self.navigation
            .routes
            .get(road)
            .filter(|r| r.open)
            .map(|r| r.lane.as_str())
    }
    pub(crate) fn plan_route(
        &self,
        position: [f64; 3],
        target: [f64; 2],
        road: Option<&str>,
    ) -> Option<NavigationPlan> {
        self.navigation
            .plan([position[0], position[2]], target, road)
    }
    pub(crate) fn plan_open(&self, plan: &NavigationPlan) -> bool {
        plan.roads.iter().all(|id| self.route_open(id))
    }
    /// Engineering candidate only. This never opens the campaign edge. The
    /// native caller must truncate at the first unsupported/occupied footprint
    /// before admitting controls; an entire broken span is never a route.
    pub(crate) fn plan_recovery_route(&self,position:[f64;3],target:[f64;2],road:&str)->Option<NavigationPlan> {
        if !self.route_constraints.get(road)?[0] {return None;}
        let mut candidates=self.navigation.clone();
        candidates.routes.get_mut(road)?.open=true;
        candidates.plan([position[0],position[2]],target,None)
    }
    pub(crate) fn front_target(
        &self,
        points: &[ObjectiveView],
        team: Team,
        front: &str,
    ) -> Option<[f64; 2]> {
        if self.air_frontline {
            return points.iter()
                .find(|p| p.lane == front && matches!(p.id.as_str(), "W2" | "C2" | "E2"))
                .map(|p| [p.pos[0], p.pos[2]]);
        }
        let side = index(team);
        let advanced = points
            .iter()
            .filter(|p| p.lane == front && p.capturable[side] && p.owner != Some(team))
            .max_by(|a, b| {
                a.progress
                    .abs()
                    .total_cmp(&b.progress.abs())
                    .then_with(|| a.id.cmp(&b.id))
            });
        advanced
            .or_else(|| {
                points
                    .iter()
                    .filter(|p| p.lane == front && p.supplied[side])
                    .min_by(|a, b| {
                        if side == 0 {
                            b.id.cmp(&a.id)
                        } else {
                            a.id.cmp(&b.id)
                        }
                    })
            })
            .map(|p| [p.pos[0], p.pos[2]])
    }
    pub fn step(
        &mut self,
        points: &mut [ObjectiveView],
        bodies: &[Presence],
        dt: f64,
    ) -> CampaignOutcome {
        let mut out = CampaignOutcome::default();
        if !dt.is_finite() || !(0.0..=0.25).contains(&dt) {
            return out;
        }
        self.refresh(points);
        for p in points.iter_mut() {
            let mut count = [0u16; 2];
            for b in bodies.iter().filter(|b| {
                b.alive
                    && b.pos.iter().all(|v| v.is_finite())
                    && (b.pos[0] - p.pos[0]).hypot(b.pos[2] - p.pos[2]) <= p.radius
            }) {
                let side = index(b.team);
                count[side] = count[side].saturating_add(1);
            }
            p.presence = count;
            p.contested = count[0] > 0 && count[1] > 0;
            let previous = p.owner;
            let side = if count[0] > 0 && count[1] == 0 && p.capturable[0] {
                Some(0)
            } else if count[1] > 0 && count[0] == 0 && p.capturable[1] {
                Some(1)
            } else {
                None
            };
            if let Some(side) = side {
                let rate = 1.0 + 0.25 * (count[side].min(3) - 1) as f64;
                let sign = if side == 0 { 1.0 } else { -1.0 };
                p.progress =
                    (p.progress + sign * dt / self.capture_seconds * rate).clamp(-1.0, 1.0);
                // Retain ownership while being neutralised. A toe in a hostile
                // zone does not erase its owner on the very first simulation tick.
                if p.progress >= 1.0 - 1e-9 {
                    p.progress = 1.0;
                    p.owner = Some(Team::Blue);
                } else if p.progress <= -1.0 + 1e-9 {
                    p.progress = -1.0;
                    p.owner = Some(Team::Red);
                } else if p.owner == Some(Team::Blue) && p.progress <= 1e-9
                    || p.owner == Some(Team::Red) && p.progress >= -1e-9
                {
                    if p.progress.abs() < 1e-9 {
                        p.progress = 0.0;
                    }
                    p.owner = None;
                }
            } else if !p.contested && count == [0, 0] {
                let target = match p.owner {
                    Some(Team::Blue) => 1.0,
                    Some(Team::Red) => -1.0,
                    None => 0.0,
                };
                p.progress += (target - p.progress).clamp(-dt / 60.0, dt / 60.0);
            }
            if previous != p.owner {
                out.events.push(json!({"kind":"objective_owner_changed","objective":p.id,"previous":previous,"owner":p.owner,"progress":p.progress}));
            }
        }
        self.refresh(points);
        if self.air_frontline {
            return out;
        }
        let pressure = self.pressure(points);
        for (side, weight) in pressure.into_iter().enumerate() {
            let opponent = 1 - side;
            self.pressure_seconds[opponent] += dt * weight as f64;
            let tickets =
                ((self.pressure_seconds[opponent] + 1e-9) / self.ticket_seconds).floor() as u32;
            self.pressure_seconds[opponent] -= tickets as f64 * self.ticket_seconds;
            out.readiness_cost[opponent] = tickets;
        }
        if out.readiness_cost != [0, 0] {
            out.events
                .push(json!({"kind":"frontline_pressure","readiness_cost":out.readiness_cost}));
        }
        out
    }
    fn pressure(&self, points: &[ObjectiveView]) -> [u32; 2] {
        let mut lanes: BTreeMap<&str, [u32; 2]> = BTreeMap::new();
        for p in points.iter().filter(|p| !p.contested) {
            if let Some(team) = p.owner {
                let side = index(team);
                if p.supplied[side] {
                    let value = match self.initial[&p.id] {
                        None => 1,
                        Some(t) if t != team => 2,
                        _ => 0,
                    };
                    lanes.entry(&p.lane).or_default()[side] += value;
                }
            }
        }
        let mut result = [0, 0];
        for score in lanes.values() {
            if score[0] > score[1] {
                result[0] += score[0] - score[1];
            } else {
                result[1] += score[1] - score[0];
            }
        }
        result
    }
    pub fn target(&self, points: &[ObjectiveView], team: Team) -> Option<[f64; 2]> {
        let side = index(team);
        points
            .iter()
            .filter(|p| p.capturable[side] && p.owner != Some(team))
            .max_by(|a, b| {
                a.progress
                    .abs()
                    .total_cmp(&b.progress.abs())
                    .then_with(|| a.id.cmp(&b.id))
            })
            .or_else(|| points.iter().find(|p| p.supplied[side]))
            .map(|p| [p.pos[0], p.pos[2]])
    }
    pub fn terminal_winner(&self, points: &[ObjectiveView]) -> Option<Team> {
        if self.air_frontline {
            return None;
        }
        let won = [Team::Blue, Team::Red].map(|team| {
            // Each side lists the hostile objectives that SIDE must capture.
            let targets = &self.terminals[index(team)];
            !targets.is_empty()
                && targets.iter().all(|id| {
                    points
                        .iter()
                        .any(|p| &p.id == id && p.owner == Some(team) && p.supplied[index(team)])
                })
        });
        match won {
            [true, false] => Some(Team::Blue),
            [false, true] => Some(Team::Red),
            _ => None,
        }
    }
    pub fn tiebreak(&self, points: &[ObjectiveView]) -> Option<Team> {
        // Remaining territorial ownership breaks an exact readiness tie; a
        // contested/cut-off owner keeps that territory until truly neutralised.
        // Supply is separately required for continuous offensive pressure.
        let mut score = [0, 0];
        for p in points {
            if let Some(t) = p.owner {
                score[index(t)] += 1;
            }
        }
        match score[0].cmp(&score[1]) {
            std::cmp::Ordering::Greater => Some(Team::Blue),
            std::cmp::Ordering::Less => Some(Team::Red),
            _ => None,
        }
    }
}

#[cfg(test)]
#[path = "frontline_campaign_tests.rs"]
mod tests;
