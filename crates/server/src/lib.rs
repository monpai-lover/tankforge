//! TankForge's online server: a lobby where players create and join rooms, pick sides and
//! vehicles, and fight on the maps of the single-player game. Std only (plus serde): a
//! hand-written WebSocket ([`ws`]), the room and battle rules with no networking in them
//! ([`lobby`]), and the threads that tie them to sockets ([`server`]).
pub mod aircraft;
pub mod airframe_limits;
pub mod lobby;
pub mod ammo;
pub mod gameplay;
pub mod he_effects;
pub mod missiles;
pub mod server;
pub mod ws;
pub mod frontline_sim;
pub mod frontline;
pub mod flight_runtime;
pub mod frontline_air;
pub mod frontline_campaign;
pub mod frontline_wire;
pub mod frontline_perception;
pub mod frontline_facilities;
pub mod frontline_naval;
pub mod frontline_scenario;

#[cfg(test)]
mod frontline_catalog_test_contract;
