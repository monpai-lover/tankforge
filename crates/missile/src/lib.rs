//! Missiles and rockets in flight, and the active protection systems that shoot at them.
//! One implementation for the browser (through crates/design-wasm) and the server (the
//! authority online): see `world` for how it works.
pub mod def;
pub mod terrain;
pub mod v;
pub mod world;

pub use def::{ApsDef, Guidance, MissileDef};
pub use terrain::HeightGrid;
pub use world::{Actor, Aps, ApsMode, Event, MStatus, Missile, Obb, StepOut, World};

#[cfg(test)]
mod tests;
