//! `VehicleDesign`: what a player submits. Raw design data only -- geometry, armour, layout
//! and component choices. Nothing derived (mass, armour effectiveness, penetration, power
//! results) is part of this format; the server recomputes all of that from these fields
//! (`crate::evaluate`) and `deny_unknown_fields` rejects a client that tries to send them.
//!
//! Spaces (same as the rest of the project: +Z forward, +X right, +Y up, metres):
//! * hull space: origin on the ground under the hull centre.
//! * turret space: origin at the centre of the turret ring plane, +Y the rotation axis,
//!   +Z the gun direction at turret yaw 0. Hull = ring.position + rot_y(yaw) * turret.
use crate::v3::V3;
use serde::{Deserialize, Serialize};

pub const SCHEMA: &str = "tankforge.design/1";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Body {
    Hull,
    Turret,
}

impl Body {
    pub fn as_str(self) -> &'static str {
        match self {
            Body::Hull => "hull",
            Body::Turret => "turret",
        }
    }
}

/// A closed polygon mesh. Faces list vertex indices counter-clockwise seen from outside.
/// Face ids are stable across edits (armour is keyed by them); vertex indices never shift
/// (editing only appends vertices; unreferenced vertices are ignored).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MeshDef {
    pub vertices: Vec<V3>,
    pub faces: Vec<FaceDef>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaceDef {
    pub id: u32,
    pub v: Vec<u32>,
    /// Editor hint ("upper_front", "side_r", "roof"...). Only used for labels and zones.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub tag: String,
}

/// Main (structural) plate of one mesh face. Its outer surface is the face itself; the plate
/// and any stack layers grow inwards along the face normal and take up interior space.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArmorFaceDef {
    pub body: Body,
    pub face: u32,
    pub material: String,
    pub thickness_mm: f64,
    /// Variable thickness, one value per face corner (same order as the face's vertices).
    /// Interpolated with mean value coordinates, so any convex or concave polygon works.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertex_mm: Option<Vec<f64>>,
    /// Variable thickness as a grid over the face's (u, v) bounding rectangle, bilinear.
    /// u runs horizontally across the face, v up the face. values_mm[j * nu + i].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map: Option<ThicknessMap>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThicknessMap {
    pub nu: u32,
    pub nv: u32,
    pub values_mm: Vec<f64>,
}

/// Extra layers on top of a face's main plate, outermost first; together with the main plate
/// they form the face's ArmorStack: [layers..., main plate].
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArmorStackDef {
    pub body: Body,
    pub face: u32,
    pub layers: Vec<ArmorLayerDef>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArmorLayerDef {
    pub material: String,
    pub thickness_mm: f64,
    /// Air gap between this layer and the next layer inwards.
    #[serde(default)]
    pub spacing_mm: f64,
    /// Tilt of this layer relative to the face, about the face's horizontal axis.
    #[serde(default)]
    pub angle_deg: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AddonKind {
    /// Bolted-on plate (standoff ~0).
    Plate,
    /// Thin plates hung beside the running gear.
    Skirt,
    /// Plate on brackets with an air gap.
    Spaced,
    Composite,
    /// Explosive reactive bricks.
    Era,
}

/// Add-on armour: a slab placed outside the body surface. center/normal/u_axis are in the
/// space of `body`; the slab spans size_m[0] along u_axis and size_m[1] along normal x u_axis.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AddonDef {
    pub id: String,
    pub kind: AddonKind,
    pub body: Body,
    /// Face the add-on was dropped on (editor reference; the slab itself is free).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub face: Option<u32>,
    /// Point on the host surface the slab stands off from.
    pub anchor_m: V3,
    /// Outward direction of the slab (normally the host face normal).
    pub normal: V3,
    pub u_axis: V3,
    pub size_m: [f64; 2],
    pub material: String,
    pub thickness_mm: f64,
    /// Air gap between the host surface and the inner side of the slab.
    #[serde(default)]
    pub standoff_mm: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TurretRingDef {
    pub diameter_m: f64,
    /// Centre of the ring plane, hull space.
    pub position_m: V3,
    pub rotation_axis: V3,
    /// Traverse drive: "manual" | "electric" | "hydraulic".
    #[serde(default = "d_drive")]
    pub drive: String,
}

fn d_drive() -> String {
    "electric".into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MantletDef {
    pub width_m: f64,
    pub height_m: f64,
    pub thickness_mm: f64,
    pub material: String,
    /// How far in front of the trunnion the mantlet's inner face sits.
    pub offset_m: f64,
}

/// Where and how the main gun sits in the turret. Turret space.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GunMountDef {
    /// Trunnion (elevation axis) position.
    pub position_m: V3,
    pub elevation_axis: V3,
    /// Requested limits; the geometry may reduce them (breech, barrel, recoil clearance).
    pub min_elevation_deg: f64,
    pub max_elevation_deg: f64,
    pub recoil_distance_m: f64,
    pub mantlet: MantletDef,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModuleKindDef {
    Engine,
    Transmission,
    FuelTank,
    AmmoRack,
    Radio,
    TurretDrive,
}

impl ModuleKindDef {
    pub fn as_str(self) -> &'static str {
        match self {
            ModuleKindDef::Engine => "engine",
            ModuleKindDef::Transmission => "transmission",
            ModuleKindDef::FuelTank => "fuel_tank",
            ModuleKindDef::AmmoRack => "ammo_rack",
            ModuleKindDef::Radio => "radio",
            ModuleKindDef::TurretDrive => "turret_drive",
        }
    }
    /// The player chooses the box for these; the others are sized from their specification.
    pub fn sized_by_player(self) -> bool {
        matches!(self, ModuleKindDef::FuelTank | ModuleKindDef::AmmoRack)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModuleDef {
    pub id: String,
    pub kind: ModuleKindDef,
    pub mount: Body,
    pub center_m: V3,
    /// Box size for fuel tanks and ammo racks; ignored for engines, transmissions, radios and
    /// turret drives (their size follows from the specification).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_m: Option<V3>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrewRoleDef {
    Commander,
    Gunner,
    Loader,
    Driver,
    RadioOperator,
}

impl CrewRoleDef {
    pub fn as_str(self) -> &'static str {
        match self {
            CrewRoleDef::Commander => "commander",
            CrewRoleDef::Gunner => "gunner",
            CrewRoleDef::Loader => "loader",
            CrewRoleDef::Driver => "driver",
            CrewRoleDef::RadioOperator => "radio_operator",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CrewDef {
    pub role: CrewRoleDef,
    pub mount: Body,
    /// Centre of the crew member's space (a seated or standing box from the catalog).
    pub position_m: V3,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EngineChoice {
    pub kind: String,
    pub power_hp: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransmissionChoice {
    pub kind: String,
    pub forward_gears: u32,
    /// Gearing target: road speed in top gear at 95% engine speed (whether the engine can
    /// actually reach it is for the server's mobility run to find out).
    pub gearing_kmh: f64,
    pub steering: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SuspensionChoice {
    pub kind: String,
    /// Road-wheel stations per side.
    pub stations: u32,
    pub wheel_diameter_m: f64,
    /// z of the first (front) and last (rear) road-wheel axle.
    pub front_z_m: f64,
    pub rear_z_m: f64,
    /// "front" | "rear" drive sprocket.
    pub sprocket: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TracksChoice {
    pub width_m: f64,
    /// x of the track centre line (the left track is mirrored).
    pub center_x_m: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WeaponsChoice {
    pub caliber_mm: f64,
    pub length_cal: f64,
    /// none | vertical | two_plane (catalog `stabilizers`).
    #[serde(default = "d_stabilizer")]
    pub stabilizer: String,
}

fn d_stabilizer() -> String {
    "none".into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AmmoLoad {
    /// ap | apcbc | aphe | apcr | heat | he
    pub kind: String,
    pub count: u32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VisualChoice {
    #[serde(default)]
    pub paint: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VehicleDesign {
    pub schema: String,
    pub id: String,
    pub name: String,
    pub hull_geometry: MeshDef,
    #[serde(default)]
    pub turret_geometry: Option<MeshDef>,
    pub armor_faces: Vec<ArmorFaceDef>,
    #[serde(default)]
    pub armor_layers: Vec<ArmorStackDef>,
    #[serde(default)]
    pub addons: Vec<AddonDef>,
    #[serde(default)]
    pub turret_ring: Option<TurretRingDef>,
    #[serde(default)]
    pub gun_mount: Option<GunMountDef>,
    pub internal_modules: Vec<ModuleDef>,
    pub crew_positions: Vec<CrewDef>,
    pub engine: EngineChoice,
    pub transmission: TransmissionChoice,
    pub suspension: SuspensionChoice,
    pub tracks: TracksChoice,
    #[serde(default)]
    pub weapons: Option<WeaponsChoice>,
    #[serde(default)]
    pub ammunition: Vec<AmmoLoad>,
    #[serde(default)]
    pub visual: VisualChoice,
    /// Editor state (construction history, base-shape parameters). Opaque to the server and
    /// never used for any computation.
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub editor: serde_json::Value,
}

impl VehicleDesign {
    pub fn mesh(&self, body: Body) -> Option<&MeshDef> {
        match body {
            Body::Hull => Some(&self.hull_geometry),
            Body::Turret => self.turret_geometry.as_ref(),
        }
    }
}
