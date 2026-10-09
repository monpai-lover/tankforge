//! TankForge's online server: a lobby where players create and join rooms, pick sides and
//! vehicles, and fight on the maps of the single-player game. Std only (plus serde): a
//! hand-written WebSocket ([`ws`]), the room and battle rules with no networking in them
//! ([`lobby`]), and the threads that tie them to sockets ([`server`]).
pub mod lobby;
pub mod missiles;
pub mod server;
pub mod ws;
