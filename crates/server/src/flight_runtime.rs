//! Interpreter host for the exact delivered flight-core 215 WebAssembly artifact.
//! Engine/module code is shared; every aircraft owns a separate Store/Instance and
//! all C/header globals, memory, instructor state and telemetry remain isolated.
//! This host owns neither aircraft fuel/ordnance nor domain lives/controllers.
use crate::frontline_sim::MapGround;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fmt, path::Path, sync::Arc};
use tg_physics::tank::terrain::Ground;
use wasmi::{
    Caller, Engine, Func, Instance, Linker, Memory, Module, Store, StoreLimits, StoreLimitsBuilder,
    Val, ValType,
};

pub const CORE_VERSION: u32 = 215;
pub const STATE_FLOATS: usize = 80;
pub const AERO_FLOATS: usize = 48;
pub const MEMORY_BYTES: usize = 2 * 65536;
pub const BUNDLED_WASM: &[u8] = include_bytes!("../../../handoff/flight/flight_core.wasm");

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "snake_case")]
pub enum FlightError {
    Artifact(String),
    Input(String),
    Runtime(String),
    Faulted(String),
    Io(String),
}
impl fmt::Display for FlightError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for FlightError {}
type Result<T> = std::result::Result<T, FlightError>;

/// Caller-authorized landing surface, heading along `forward` in world x/z.
/// Merely loading a map does not authorize every road/staging pad as a runway.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LandingArea {
    pub center: [f64; 2],
    pub forward: [f64; 2],
    pub half_width: f64,
    pub half_length: f64,
}
pub type RunwayLandingArea = LandingArea;
impl LandingArea {
    fn valid(&self) -> bool {
        self.center
            .iter()
            .chain(self.forward.iter())
            .all(|v| v.is_finite())
            && self.forward[0].hypot(self.forward[1]).is_finite()
            && self.forward[0].hypot(self.forward[1]) > 1e-9
            && [self.half_width, self.half_length]
                .iter()
                .all(|v| v.is_finite() && *v > 0.0 && *v <= 100_000.0)
    }
    pub fn contains(&self, x: f64, z: f64) -> bool {
        if !self.valid() || !x.is_finite() || !z.is_finite() {
            return false;
        }
        let length = self.forward[0].hypot(self.forward[1]);
        let forward = [self.forward[0] / length, self.forward[1] / length];
        let d = [x - self.center[0], z - self.center[1]];
        (d[0] * forward[1] - d[1] * forward[0]).abs() <= self.half_width
            && (d[0] * forward[0] + d[1] * forward[1]).abs() <= self.half_length
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FlightSpawn {
    pub position: [f32; 3],
    pub heading: f32,
    pub airspeed: f32,
    pub on_ground: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FlightInput {
    pub aim: [f32; 3],
    pub throttle: f32,
    pub pitch: f32,
    pub roll: f32,
    pub yaw: f32,
    pub flags: u32,
}
impl Default for FlightInput {
    fn default() -> Self {
        Self {
            aim: [0.0, 0.0, 1.0],
            throttle: 0.78,
            pitch: 0.0,
            roll: 0.0,
            yaw: 0.0,
            flags: 1,
        }
    }
}
/// Actual core telemetry, not a complete restorable C execution context.
/// Restoring these 128 floats cannot restore hidden plant/instructor globals.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FlightTelemetry {
    pub core_version: u32,
    pub state: Vec<f32>,
    pub aero: Vec<f32>,
}

struct WorldState {
    ground: Arc<MapGround>,
    landing: Arc<[LandingArea]>,
    limits: StoreLimits,
    #[cfg(test)]
    trap_ground: bool,
}
impl WorldState {
    fn surface_height(&self, x: f64, z: f64) -> f64 {
        let terrain = self.ground.height(x, z);
        match self.ground.water_level(x, z) {
            // Outside the terrain grid, a mapped ocean plane remains a real
            // surface; do not extend a clamped coastal mountain over the sea.
            Some(water) if !self.ground.contains(x, z) => water,
            Some(water) => terrain.max(water),
            None => terrain,
        }
    }
    fn landable(&self, x: f64, z: f64) -> bool {
        self.ground.contains(x, z)
            && self.landing.iter().any(|a| a.contains(x, z))
            && self.ground.runway_available_at(x, z)
            && self
                .ground
                .water_level(x, z)
                .is_none_or(|water| self.ground.height(x, z) > water + 0.05)
    }
}

pub struct FlightModule {
    engine: Engine,
    module: Module,
}
pub type FlightFactory = FlightModule;
impl fmt::Debug for FlightModule {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FlightModule")
            .field("core_version", &CORE_VERSION)
            .field("wasm_bytes", &BUNDLED_WASM.len())
            .finish()
    }
}
impl FlightModule {
    pub fn bundled() -> Result<Arc<Self>> {
        Self::from_bytes(BUNDLED_WASM)
    }
    pub fn load(path: &Path) -> Result<Arc<Self>> {
        let bytes =
            std::fs::read(path).map_err(|e| FlightError::Io(format!("{}: {e}", path.display())))?;
        Self::from_bytes(&bytes)
    }
    pub fn from_bytes(bytes: &[u8]) -> Result<Arc<Self>> {
        // A version label alone does not establish that server/browser execute
        // identical aerodynamics. Accept the exact source-matched build artifact.
        if bytes.len() != BUNDLED_WASM.len()
            || bytes != BUNDLED_WASM
            || bytes.get(..8) != Some(b"\0asm\x01\0\0\0")
        {
            return Err(FlightError::Artifact(
                "Flight module differs from the delivered core213 artifact".into(),
            ));
        }
        let engine = Engine::default();
        let module =
            Module::new(&engine, bytes).map_err(|e| FlightError::Artifact(e.to_string()))?;
        Ok(Arc::new(Self { engine, module }))
    }
    pub fn instantiate(
        self: &Arc<Self>,
        ground: Arc<MapGround>,
        landing: Vec<LandingArea>,
    ) -> Result<FlightRuntime> {
        if landing.iter().any(|a| !a.valid()) {
            return Err(FlightError::Input(
                "Invalid landing rectangle/orientation".into(),
            ));
        }
        let mut linker = Linker::<WorldState>::new(&self.engine);
        // Browser Math imports receive f32 operands, compute in f64 and round the
        // result back to f32 at the Wasm boundary. Do not use Rust f32::* here.
        for (name, math) in [
            ("sin", f64::sin as fn(f64) -> f64),
            ("cos", f64::cos),
            ("exp", f64::exp),
            ("asin", f64::asin),
            ("acos", f64::acos),
        ] {
            linker
                .func_wrap("math", name, move |x: f32| -> f32 { math(x as f64) as f32 })
                .map_err(|e| FlightError::Runtime(e.to_string()))?;
        }
        linker
            .func_wrap("math", "atan2", |y: f32, x: f32| -> f32 {
                (y as f64).atan2(x as f64) as f32
            })
            .map_err(|e| FlightError::Runtime(e.to_string()))?;
        linker
            .func_wrap(
                "world",
                "ground",
                |caller: Caller<'_, WorldState>,
                 x: f32,
                 z: f32|
                 -> std::result::Result<f32, wasmi::Error> {
                    #[cfg(test)]
                    if caller.data().trap_ground {
                        return Err(wasmi::Error::new("injected world callback failure"));
                    }
                    if !x.is_finite() || !z.is_finite() {
                        return Err(wasmi::Error::new("Nonfinite world ground query"));
                    }
                    let height = caller.data().surface_height(x as f64, z as f64);
                    let height32 = height as f32;
                    if !height32.is_finite() {
                        return Err(wasmi::Error::new("Nonfinite canonical ground height"));
                    }
                    Ok(height32)
                },
            )
            .map_err(|e| FlightError::Runtime(e.to_string()))?;
        linker
            .func_wrap(
                "world",
                "landable",
                |caller: Caller<'_, WorldState>, x: f32, z: f32| -> i32 {
                    i32::from(caller.data().landable(x as f64, z as f64))
                },
            )
            .map_err(|e| FlightError::Runtime(e.to_string()))?;
        let limits = StoreLimitsBuilder::new()
            .memory_size(MEMORY_BYTES)
            .instances(1)
            .memories(1)
            .tables(1)
            .build();
        let mut store = Store::new(
            &self.engine,
            WorldState {
                ground,
                landing: landing.into(),
                limits,
                #[cfg(test)]
                trap_ground: false,
            },
        );
        store.limiter(|s| &mut s.limits);
        let instance = linker
            .instantiate_and_start(&mut store, &self.module)
            .map_err(|e| FlightError::Runtime(e.to_string()))?;
        let memory = instance
            .get_memory(&store, "memory")
            .ok_or_else(|| FlightError::Artifact("Missing exported memory".into()))?;
        if memory.data_size(&store) != MEMORY_BYTES {
            return Err(FlightError::Artifact(
                "Expected exactly128KiB aircraft memory".into(),
            ));
        }
        let mut functions = BTreeMap::new();
        let f = ValType::F32;
        let i = ValType::I32;
        for (name, params, results) in [
            ("core_version", vec![], vec![i]),
            ("state_ptr", vec![], vec![i]),
            ("state_len", vec![], vec![i]),
            ("aero_state_ptr", vec![], vec![i]),
            ("aero_state_len", vec![], vec![i]),
            ("set_world", vec![i], vec![]),
            ("reset", vec![i], vec![]),
            (
                "configure_airframe",
                vec![f, f, f, f, f, f, f, f, f, f, f, i, f, f],
                vec![],
            ),
            (
                "configure_surfaces",
                vec![f, f, f, f, f, f, f, f, f, f, f, f, f, f, f, i, i],
                vec![],
            ),
            ("configure", vec![f, f, f, f, i], vec![]),
            ("configure_gear_sequence", vec![i, f, f, f, f, f], vec![]),
            ("configure_control", vec![i, i, f, f], vec![]),
            ("configure_envelope", vec![f, f, f, f], vec![]),
            ("spawn", vec![f, f, f, f, f, i], vec![]),
            ("step", vec![f, f, f, f, f, f, f, f, i], vec![]),
            ("impulse", vec![f; 6], vec![]),
            ("set_damage", vec![f; 6], vec![]),
            ("set_gear_failure", vec![i], vec![]),
            ("adopt_kinematics", vec![f; 13], vec![i]),
        ] {
            let function = instance
                .get_func(&store, name)
                .ok_or_else(|| FlightError::Artifact(format!("Missing export {name}")))?;
            let ty = function.ty(&store);
            if ty.params() != params || ty.results() != results {
                return Err(FlightError::Artifact(format!(
                    "Invalid export signature {name}"
                )));
            }
            functions.insert(name, function);
        }
        let integer = |name: &str, store: &mut Store<WorldState>| -> Result<i32> {
            let mut output = [Val::I32(0)];
            functions[name]
                .call(store, &[], &mut output)
                .map_err(|e| FlightError::Runtime(e.to_string()))?;
            output[0]
                .i32()
                .ok_or_else(|| FlightError::Artifact(format!("Invalid integer result {name}")))
        };
        if integer("core_version", &mut store)? != CORE_VERSION as i32
            || integer("state_len", &mut store)? != STATE_FLOATS as i32
            || integer("aero_state_len", &mut store)? != AERO_FLOATS as i32
        {
            return Err(FlightError::Artifact(
                "Wrong core version or telemetry lengths".into(),
            ));
        }
        let state = checked_region(integer("state_ptr", &mut store)?, STATE_FLOATS)?;
        let aero = checked_region(integer("aero_state_ptr", &mut store)?, AERO_FLOATS)?;
        if state.0 < aero.1 && aero.0 < state.1 {
            return Err(FlightError::Artifact("Telemetry regions overlap".into()));
        }
        let mut runtime = FlightRuntime {
            _module: self.clone(),
            store,
            _instance: instance,
            memory,
            functions,
            state,
            aero,
            faulted: None,
            spawned: false,
        };
        runtime.call("set_world", &[Val::I32(1)])?;
        runtime.telemetry()?;
        Ok(runtime)
    }
}
fn checked_region(ptr: i32, count: usize) -> Result<(usize, usize)> {
    let start = usize::try_from(ptr)
        .map_err(|_| FlightError::Artifact("Negative telemetry pointer".into()))?;
    let end = start
        .checked_add(count * 4)
        .filter(|n| *n <= MEMORY_BYTES)
        .ok_or_else(|| FlightError::Artifact("Telemetry lies outside fixed memory".into()))?;
    if start % 4 != 0 {
        return Err(FlightError::Artifact("Misaligned telemetry pointer".into()));
    }
    Ok((start, end))
}
fn finite(values: &[f32], label: &str) -> Result<()> {
    if values.iter().all(|v| v.is_finite()) {
        Ok(())
    } else {
        Err(FlightError::Input(format!("Nonfinite {label}")))
    }
}
fn floats<const N: usize>(values: &[f32; N]) -> [Val; N] {
    std::array::from_fn(|n| Val::from(values[n]))
}

pub struct FlightRuntime {
    _module: Arc<FlightModule>,
    store: Store<WorldState>,
    _instance: Instance,
    memory: Memory,
    functions: BTreeMap<&'static str, Func>,
    state: (usize, usize),
    aero: (usize, usize),
    faulted: Option<String>,
    spawned: bool,
}
impl fmt::Debug for FlightRuntime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FlightRuntime")
            .field("memory_bytes", &self.memory_bytes())
            .field("faulted", &self.faulted)
            .finish()
    }
}
impl FlightRuntime {
    pub fn memory_bytes(&self) -> usize {
        self.memory.data_size(&self.store)
    }
    pub fn is_faulted(&self) -> bool {
        self.faulted.is_some()
    }
    fn healthy(&self) -> Result<()> {
        match &self.faulted {
            None => Ok(()),
            Some(reason) => Err(FlightError::Faulted(reason.clone())),
        }
    }
    fn call(&mut self, name: &'static str, parameters: &[Val]) -> Result<()> {
        self.healthy()?;
        if let Err(e) = self.functions[name].call(&mut self.store, parameters, &mut []) {
            let reason = format!("{name}: {e}");
            self.faulted = Some(reason.clone());
            return Err(FlightError::Runtime(reason));
        }
        // A trap/nonfinite result may have partially advanced hidden state. Never
        // pretend that copying the public telemetry can roll that execution back.
        if self.memory_bytes() != MEMORY_BYTES || !self.raw_finite() {
            let reason = format!("{name}: invalid memory or nonfinite accepted telemetry");
            self.faulted = Some(reason.clone());
            return Err(FlightError::Runtime(reason));
        }
        Ok(())
    }
    fn raw_finite(&self) -> bool {
        let bytes = self.memory.data(&self.store);
        [self.state, self.aero].iter().all(|&(start, end)| {
            bytes[start..end]
                .chunks_exact(4)
                .all(|v| f32::from_le_bytes(v.try_into().unwrap()).is_finite())
        })
    }
    pub fn telemetry(&self) -> Result<FlightTelemetry> {
        self.healthy()?;
        if !self.raw_finite() {
            return Err(FlightError::Runtime("Nonfinite flight telemetry".into()));
        }
        let memory = self.memory.data(&self.store);
        let read = |range: (usize, usize)| {
            memory[range.0..range.1]
                .chunks_exact(4)
                .map(|v| f32::from_le_bytes(v.try_into().unwrap()))
                .collect()
        };
        Ok(FlightTelemetry {
            core_version: CORE_VERSION,
            state: read(self.state),
            aero: read(self.aero),
        })
    }
    /// Validated movement only; never imports client damage/resources or raw memory.
    pub fn adopt_kinematics(&mut self, position:&[f32;3], quaternion:&[f32;4], velocity:&[f32;3], angular_velocity:&[f32;3]) -> Result<()> {
        self.healthy()?;
        if !self.spawned {return Err(FlightError::Input("Spawn before adopting flight movement".into()));}
        let values:Vec<f32>=position.iter().chain(quaternion).chain(velocity).chain(angular_velocity).copied().collect();
        finite(&values,"flight movement")?;
        let args:Vec<Val>=values.iter().map(|x|(*x).into()).collect();
        let mut result=[Val::I32(0)];
        if let Err(e)=self.functions["adopt_kinematics"].call(&mut self.store,&args,&mut result) {
            let reason=format!("adopt_kinematics: {e}");self.faulted=Some(reason.clone());return Err(FlightError::Runtime(reason));
        }
        if self.memory_bytes()!=MEMORY_BYTES || !self.raw_finite() {self.faulted=Some("invalid adopted movement".into());return Err(FlightError::Runtime("invalid adopted movement".into()));}
        if !matches!(result[0],Val::I32(1)) {return Err(FlightError::Input("Native flight kernel rejected movement".into()));}
        Ok(())
    }
    /// The same fourteen values/order used by browser configure_airframe. This
    /// export resets surface defaults; host must reapply configure_surfaces.
    pub fn configure_airframe(&mut self, values: &[f32; 14]) -> Result<()> {
        finite(values, "airframe")?;
        if values[..7].iter().any(|v| *v <= 0.0)
            || ![0.0, 1.0].contains(&values[11])
            || values[12] <= 0.0
            || values.iter().any(|v| v.abs() > 10_000_000.0)
        {
            return Err(FlightError::Input(
                "Invalid airframe dimensions/inertia/engine".into(),
            ));
        }
        let mut args = floats(values);
        args[11] = Val::I32(values[11] as i32);
        self.call("configure_airframe", &args)
    }
    pub fn configure_surfaces(
        &mut self,
        values: &[f32; 15],
        tailless: bool,
        stabilator: bool,
    ) -> Result<()> {
        finite(values, "surface geometry")?;
        if values.iter().any(|v| v.abs() > 10_000.0)
            || values[1] <= values[0]
            || values[5] <= 0.0
            || values[7] <= 0.0
        {
            return Err(FlightError::Input("Invalid surface extents/area".into()));
        }
        let mut args = floats(values).to_vec();
        args.extend([Val::I32(tailless as i32), Val::I32(stabilator as i32)]);
        self.call("configure_surfaces", &args)
    }
    pub fn configure_gear_sequence(&mut self, mode: bool, seconds: &[f32; 5]) -> Result<()> {
        finite(seconds, "gear sequence timing")?;
        if seconds.iter().any(|v| *v < 0.05 || *v > 60.0) {
            return Err(FlightError::Input("Invalid gear sequence timing".into()));
        }
        let mut args = vec![Val::I32(mode as i32)];
        args.extend(floats(seconds));
        self.call("configure_gear_sequence", &args)
    }
    pub fn configure(
        &mut self,
        wind_knots: f32,
        wind_degrees: f32,
        response: f32,
        max_g: f32,
        protection: bool,
    ) -> Result<()> {
        finite(&[wind_knots, wind_degrees, response, max_g], "environment")?;
        if !(0.0..=45.0).contains(&wind_knots)
            || wind_degrees.abs() > 3600.0
            || !(0.5..=1.6).contains(&response)
            || !(2.0..=9.0).contains(&max_g)
        {
            return Err(FlightError::Input(
                "Invalid environment/control range".into(),
            ));
        }
        self.call(
            "configure",
            &[
                wind_knots.into(),
                wind_degrees.into(),
                response.into(),
                max_g.into(),
                Val::I32(protection as i32),
            ],
        )
    }
    pub fn configure_control(
        &mut self,
        profile: u8,
        handoff: bool,
        delay: f32,
        response: f32,
    ) -> Result<()> {
        finite(&[delay, response], "control handoff")?;
        if profile > 1 || !(0.0..=1.5).contains(&delay) || !(0.4..=2.0).contains(&response) {
            return Err(FlightError::Input("Invalid control profile/handoff".into()));
        }
        self.call(
            "configure_control",
            &[
                Val::I32(profile as i32),
                Val::I32(handoff as i32),
                delay.into(),
                response.into(),
            ],
        )
    }
    pub fn configure_envelope(
        &mut self,
        max_g: f32,
        min_g: f32,
        max_aoa: f32,
        min_aoa: f32,
    ) -> Result<()> {
        finite(&[max_g, min_g, max_aoa, min_aoa], "envelope")?;
        if !(2.0..=12.0).contains(&max_g)
            || !(-9.0..=-0.5).contains(&min_g)
            || !(0.0..=0.65).contains(&max_aoa)
            || !(-0.65..=0.0).contains(&min_aoa)
        {
            return Err(FlightError::Input("Invalid envelope limits".into()));
        }
        self.call(
            "configure_envelope",
            &floats(&[max_g, min_g, max_aoa, min_aoa]),
        )
    }
    pub fn spawn(&mut self, spawn: FlightSpawn) -> Result<()> {
        finite(&spawn.position, "spawn position")?;
        finite(&[spawn.heading, spawn.airspeed], "spawn heading/speed")?;
        if spawn.position.iter().any(|v| v.abs() > 10_000_000.0)
            || spawn.heading.abs() > 1000.0
            || !(0.0..=250.0).contains(&spawn.airspeed)
        {
            return Err(FlightError::Input(
                "Spawn outside kernel coordinate/speed bounds".into(),
            ));
        }
        self.call(
            "spawn",
            &[
                spawn.position[0].into(),
                spawn.position[1].into(),
                spawn.position[2].into(),
                spawn.heading.into(),
                spawn.airspeed.into(),
                Val::I32(spawn.on_ground as i32),
            ],
        )?;
        self.spawned = true;
        Ok(())
    }
    pub fn step(&mut self, dt: f32, input: &FlightInput) -> Result<()> {
        if !self.spawned {
            return Err(FlightError::Input(
                "Spawn the aircraft before advancing it".into(),
            ));
        }
        finite(
            &[dt, input.throttle, input.pitch, input.roll, input.yaw],
            "flight input",
        )?;
        finite(&input.aim, "aim direction")?;
        let aim_length = input.aim.iter().map(|v| v * v).sum::<f32>().sqrt();
        if !(dt > 0.0 && dt <= 0.025)
            || !(0.0..=1.12).contains(&input.throttle)
            || [input.pitch, input.roll, input.yaw]
                .iter()
                .any(|v| v.abs() > 1.0)
            || !(0.5..=1.5).contains(&aim_length)
            || input.flags & !255 != 0
        {
            return Err(FlightError::Input(
                "Input exceeds fixed-step/control/flag bounds".into(),
            ));
        }
        self.call(
            "step",
            &[
                dt.into(),
                input.aim[0].into(),
                input.aim[1].into(),
                input.aim[2].into(),
                input.throttle.into(),
                input.pitch.into(),
                input.roll.into(),
                input.yaw.into(),
                Val::I32(input.flags as i32),
            ],
        )
    }
    pub fn impulse(&mut self, velocity: [f32; 3], angular: [f32; 3]) -> Result<()> {
        finite(&velocity, "linear impulse")?;
        finite(&angular, "angular impulse")?;
        if velocity.iter().any(|v| v.abs() > 5.0) || angular.iter().any(|v| v.abs() > 0.5) {
            return Err(FlightError::Input("Impulse exceeds kernel bounds".into()));
        }
        self.call(
            "impulse",
            &floats(&[
                velocity[0],
                velocity[1],
                velocity[2],
                angular[0],
                angular[1],
                angular[2],
            ]),
        )
    }
    pub fn set_damage(&mut self, factors: [f32; 6]) -> Result<()> {
        finite(&factors, "damage factors")?;
        if factors.iter().any(|v| !(0.0..=1.0).contains(v)) {
            return Err(FlightError::Input("Damage factors must be0..1".into()));
        }
        self.call("set_damage", &floats(&factors))
    }
    /// Host-owned failure; configure_airframe/configure_gear_sequence cannot
    /// clear this latch. Only accepted service or a new spawn may repair it.
    pub fn set_gear_failure(&mut self, failed: bool) -> Result<()> {
        self.call("set_gear_failure", &[Val::I32(failed as i32)])
    }
}

#[cfg(test)]
#[path = "flight_runtime_tests.rs"]
mod tests;
