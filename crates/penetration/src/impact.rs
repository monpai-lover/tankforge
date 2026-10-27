//! Pure, versioned kinetic bookkeeping. The compatibility work law is an authored
//! gameplay proxy, not a calibrated material law. Chemical release/fuses are P3.
use serde::{Deserialize, Serialize};
use tg_shared::Vec3;
use tg_weapon::{ProjectileDef, ProjectileKind};

pub const MECHANISM_REVISION: &str = "kinetic_work_v1";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FragmentSource {
    Core,
    ProjectilePiece,
    ArmourSpall,
    CasingFragment,
    JetFragment,
    #[default]
    UnknownLegacy,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct EnergyBudget {
    pub input_j: f64,
    pub core_out_j: f64,
    pub projectile_pieces_j: f64,
    pub armour_debris_j: f64,
    pub target_deposition_j: f64,
    pub deformation_fracture_j: f64,
    pub unresolved_loss_j: f64,
}
impl EnergyBudget {
    pub fn validate(&self) -> Result<(), ImpactError> {
        let values = [
            self.input_j,
            self.core_out_j,
            self.projectile_pieces_j,
            self.armour_debris_j,
            self.target_deposition_j,
            self.deformation_fracture_j,
            self.unresolved_loss_j,
        ];
        if values.iter().any(|v| !v.is_finite() || *v < 0.0) {
            return Err(ImpactError::InvalidEnergy);
        }
        if (values[1..].iter().sum::<f64>() - self.input_j).abs() > 1e-5 * self.input_j.max(1.0) {
            return Err(ImpactError::InvalidEnergy);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ComponentReservoirs {
    pub core_kg: f64,
    pub casing_kg: f64,
    pub cap_kg: f64,
    pub liner_kg: f64,
    pub filler_kg: f64,
    /// The original data does not partition the remaining body into components.
    pub unallocated_kg: f64,
}
impl ComponentReservoirs {
    fn values(&self) -> [f64; 6] {
        [
            self.core_kg,
            self.casing_kg,
            self.cap_kg,
            self.liner_kg,
            self.filler_kg,
            self.unallocated_kg,
        ]
    }
    pub fn total_kg(&self) -> f64 {
        self.values().iter().sum()
    }
    fn subtract(&self, other: &Self) -> Result<Self, ImpactError> {
        let a = self.values();
        let b = other.values();
        if b.iter()
            .enumerate()
            .any(|(i, v)| !v.is_finite() || *v < 0.0 || *v > a[i])
        {
            return Err(ImpactError::InvalidMass);
        }
        Ok(Self {
            core_kg: a[0] - b[0],
            casing_kg: a[1] - b[1],
            cap_kg: a[2] - b[2],
            liner_kg: a[3] - b[3],
            filler_kg: a[4] - b[4],
            unallocated_kg: a[5] - b[5],
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileSource {
    Authored,
    Estimated,
    Unknown,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProfileReference {
    pub id: String,
    pub revision: String,
    pub source: ProfileSource,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapState {
    Absent,
    Unknown,
    Present,
    Consumed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FuseState {
    Unarmed,
    Armed,
    Detonated,
    Failed,
    UnresolvedLegacy,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChargeDisposition {
    Contained,
    PendingP3,
    Released,
    Failed,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChargeOwnership {
    pub charge_id: String,
    pub owner_id: String,
    pub disposition: ChargeDisposition,
}

/// Snapshot deliberately excludes the traversal cursor (no recursive entry states).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ImpactSnapshot {
    pub body_id: String,
    pub admitted_mass_kg: f64,
    pub mass_kg: f64,
    pub velocity_m_s: Vec3,
    pub remaining_pen_mm: f64,
    pub remaining_length_m: Option<f64>,
    pub effective_diameter_m: Option<f64>,
    pub launch_caliber_m: f64,
    pub estimated_footprint_diameter_m: f64,
    pub geometry_profile: ProfileReference,
    pub integrity: f64,
    pub deformation: f64,
    pub cap: CapState,
    pub elapsed_s: f64,
    pub fuse: FuseState,
    pub components: ComponentReservoirs,
    pub charge: Option<ChargeOwnership>,
    pub profile: ProfileReference,
    pub spall_share: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LayerTraversalCursor {
    pub layer_id: String,
    pub traversal_id: u32,
    pub entry: ImpactSnapshot,
    pub cumulative_required_mm: f64,
    pub cumulative_work_j: f64,
    pub cumulative_pen_used_mm: f64,
    /// Passed distance, timed at this traversal's incoming speed (P1 estimate).
    #[serde(default)]
    pub cumulative_path_m: f64,
    pub armour_mass_bound_kg: f64,
    pub cumulative_armour_mass_kg: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ImpactState {
    #[serde(flatten)]
    pub current: ImpactSnapshot,
    pub traversal: Option<LayerTraversalCursor>,
}
impl std::ops::Deref for ImpactState {
    type Target = ImpactSnapshot;
    fn deref(&self) -> &Self::Target {
        &self.current
    }
}
impl std::ops::DerefMut for ImpactState {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.current
    }
}
impl ImpactSnapshot {
    pub fn energy_j(&self) -> f64 {
        let v = self.velocity_m_s;
        0.5 * self.mass_kg * ((v.x as f64).powi(2) + (v.y as f64).powi(2) + (v.z as f64).powi(2))
    }
    pub fn validate(&self) -> Result<(), ImpactError> {
        let values = [
            self.admitted_mass_kg,
            self.mass_kg,
            self.remaining_pen_mm,
            self.remaining_length_m.unwrap_or(0.0),
            self.effective_diameter_m.unwrap_or(0.0),
            self.launch_caliber_m,
            self.estimated_footprint_diameter_m,
            self.integrity,
            self.deformation,
            self.elapsed_s,
            self.spall_share,
        ];
        if values.iter().any(|v| !v.is_finite() || *v < 0.0)
            || self.velocity_m_s.to_array().iter().any(|v| !v.is_finite())
        {
            return Err(ImpactError::InvalidInput);
        }
        if self.mass_kg > self.admitted_mass_kg
            || self.integrity > 1.0
            || self.spall_share > 1.0
            || self
                .components
                .values()
                .iter()
                .any(|v| !v.is_finite() || *v < 0.0)
            || (self.components.total_kg() - self.mass_kg).abs()
                > 1e-9 * self.admitted_mass_kg.max(1.0)
        {
            return Err(ImpactError::InvalidMass);
        }
        if !self.energy_j().is_finite() {
            return Err(ImpactError::InvalidEnergy);
        }
        if let Some(c) = &self.charge {
            if c.owner_id != self.body_id || self.components.filler_kg <= 0.0 {
                return Err(ImpactError::InvalidCharge);
            }
        } else if self.components.filler_kg > 0.0 {
            return Err(ImpactError::InvalidCharge);
        }
        Ok(())
    }
}
impl ImpactState {
    pub fn validate(&self) -> Result<(), ImpactError> {
        self.current.validate()?;
        if let Some(c) = &self.traversal {
            c.entry.validate()?;
            let values = [
                c.cumulative_required_mm,
                c.cumulative_work_j,
                c.cumulative_pen_used_mm,
                c.cumulative_path_m,
                c.armour_mass_bound_kg,
                c.cumulative_armour_mass_kg,
            ];
            if c.layer_id.is_empty()
                || values.iter().any(|v| !v.is_finite() || *v < 0.0)
                || c.cumulative_work_j > c.entry.energy_j() + 1e-8 * c.entry.energy_j().max(1.0)
                || c.cumulative_pen_used_mm > c.entry.remaining_pen_mm
                || c.cumulative_armour_mass_kg > c.armour_mass_bound_kg
                || (self.energy_j() + c.cumulative_work_j - c.entry.energy_j()).abs()
                    > 1e-5 * c.entry.energy_j().max(1.0)
                || (self.remaining_pen_mm + c.cumulative_pen_used_mm - c.entry.remaining_pen_mm)
                    .abs()
                    > 1e-8 * c.entry.remaining_pen_mm.max(1.0)
            {
                return Err(ImpactError::InvalidTraversal);
            }
        }
        Ok(())
    }
    pub fn set_energy_j(&mut self, energy: f64) -> Result<(), ImpactError> {
        if !energy.is_finite()
            || energy < 0.0
            || energy > self.energy_j() + 1e-8 * self.energy_j().max(1.0)
        {
            return Err(ImpactError::InvalidEnergy);
        }
        let before = self.energy_j();
        self.velocity_m_s = if energy == 0.0 || before == 0.0 {
            Vec3::ZERO
        } else {
            self.velocity_m_s * (energy / before).sqrt() as f32
        };
        Ok(())
    }
    pub fn advance_time(&mut self, distance_m: f64) {
        let speed = self.velocity_m_s.length() as f64;
        if distance_m.is_finite() && distance_m >= 0.0 && speed > 0.0 {
            let next = self.elapsed_s + distance_m / speed;
            if next.is_finite() {
                self.elapsed_s = next;
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImpactError {
    InvalidInput,
    InvalidMass,
    InvalidEnergy,
    InvalidCharge,
    InvalidTraversal,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImpactVerdict {
    Passed,
    Stopped,
    Ricochet,
    Shattered,
    Deposited,
    PieceTransfer,
}
#[derive(Clone, Debug)]
pub struct DeclaredLayerContact {
    pub layer_id: String,
    pub traversal_id: u32,
    pub cumulative_required_mm: f64,
    pub cumulative_path_m: f64,
    pub thickness_mm: f64,
    pub density_kg_m3: f64,
    pub verdict: ImpactVerdict,
    pub emit_spall: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SourceAllocation {
    pub source: FragmentSource,
    pub mass_kg: f64,
    pub energy_j: f64,
    pub profile: ProfileReference,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ImpactTransition {
    pub event_id: String,
    pub layer_id: String,
    pub traversal_id: u32,
    pub entry: ImpactSnapshot,
    pub output: ImpactSnapshot,
    pub verdict: ImpactVerdict,
    pub budget: EnergyBudget,
    pub allocations: Vec<SourceAllocation>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PhysicalFragment {
    pub mass_kg: f64,
    pub energy_j: f64,
    pub area_m2: Option<f64>,
    pub velocity_m_s: Vec3,
}
impl PhysicalFragment {
    pub fn validate(&self) -> Result<(), ImpactError> {
        if !self.mass_kg.is_finite()
            || self.mass_kg < 0.0
            || !self.energy_j.is_finite()
            || self.energy_j < 0.0
            || self.area_m2.is_some_and(|a| !a.is_finite() || a < 0.0)
            || self.velocity_m_s.to_array().iter().any(|v| !v.is_finite())
        {
            return Err(ImpactError::InvalidInput);
        }
        let v = self.velocity_m_s;
        let energy = 0.5
            * self.mass_kg
            * ((v.x as f64).powi(2) + (v.y as f64).powi(2) + (v.z as f64).powi(2));
        if !energy.is_finite() || (energy - self.energy_j).abs() > 1e-5 * self.energy_j.max(1.0) {
            return Err(ImpactError::InvalidEnergy);
        }
        Ok(())
    }
}
fn unit_weight() -> f64 {
    1.0
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FragmentProvenance {
    #[serde(default)]
    pub fragment_id: String,
    #[serde(default)]
    pub parent_event_id: String,
    #[serde(default)]
    pub source: FragmentSource,
    #[serde(default)]
    pub source_layer_or_module: Option<String>,
    #[serde(default)]
    pub physical: Option<PhysicalFragment>,
    #[serde(default = "unit_weight")]
    pub weight: f64,
    #[serde(default)]
    pub start_s: Option<f64>,
    #[serde(default)]
    pub profile: Option<ProfileReference>,
}
impl Default for FragmentProvenance {
    fn default() -> Self {
        Self {
            fragment_id: String::new(),
            parent_event_id: String::new(),
            source: FragmentSource::UnknownLegacy,
            source_layer_or_module: None,
            physical: None,
            weight: 1.0,
            start_s: None,
            profile: None,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ImpactEvent {
    pub mechanism_revision: String,
    pub time_s: f64,
    pub entry_position: Vec3,
    pub exit_position: Vec3,
    pub normal: Vec3,
    #[serde(flatten)]
    pub transition: ImpactTransition,
}

pub fn initialize_impact(
    shell: &ProjectileDef,
    velocity: Vec3,
    penetration_mm: f64,
    body_id: &str,
) -> Result<ImpactState, ImpactError> {
    if !shell.mass_kg.is_finite()
        || shell.mass_kg < 0.0
        || !shell.explosive_mass_kg.is_finite()
        || shell.explosive_mass_kg < 0.0
    {
        return Err(ImpactError::InvalidMass);
    }
    let fraction = match shell.kind {
        ProjectileKind::Apcr => 0.35,
        ProjectileKind::Apds => 0.6,
        _ => 1.0,
    };
    let mass = shell.mass_kg as f64 * fraction;
    let filler = shell.explosive_mass_kg as f64;
    if filler > mass {
        return Err(ImpactError::InvalidMass);
    }
    let profile = ProfileReference {
        id: match shell.kind {
            ProjectileKind::Apcr => "legacy_apcr_admitted_mass_035",
            ProjectileKind::Apds => "legacy_apds_admitted_mass_060",
            _ => "legacy_body_unpartitioned",
        }
        .into(),
        revision: MECHANISM_REVISION.into(),
        source: ProfileSource::Estimated,
    };
    let subcal = matches!(
        shell.kind,
        ProjectileKind::Apcr | ProjectileKind::Apds | ProjectileKind::Apfsds
    );
    if !shell.length_mm.is_finite()
        || shell.length_mm < 0.0
        || !shell.caliber_mm.is_finite()
        || shell.caliber_mm < 0.0
    {
        return Err(ImpactError::InvalidInput);
    }
    let current = ImpactSnapshot {
        body_id: body_id.into(),
        admitted_mass_kg: mass,
        mass_kg: mass,
        velocity_m_s: velocity,
        remaining_pen_mm: penetration_mm,
        remaining_length_m: if subcal {
            None
        } else {
            Some(shell.length_mm as f64 * 0.001)
        },
        effective_diameter_m: if subcal {
            None
        } else {
            Some(shell.caliber_mm as f64 * 0.001)
        },
        launch_caliber_m: shell.caliber_mm as f64 * 0.001,
        estimated_footprint_diameter_m: shell.caliber_mm as f64 * 0.001,
        geometry_profile: ProfileReference {
            id: if subcal {
                "unknown_flight_core_geometry"
            } else {
                "authored_body_dimensions"
            }
            .into(),
            revision: MECHANISM_REVISION.into(),
            source: if subcal {
                ProfileSource::Unknown
            } else {
                ProfileSource::Authored
            },
        },
        integrity: 1.0,
        deformation: 0.0,
        cap: if shell.kind == ProjectileKind::Apcbc {
            CapState::Unknown
        } else {
            CapState::Absent
        },
        elapsed_s: 0.0,
        fuse: if filler > 0.0 {
            FuseState::UnresolvedLegacy
        } else {
            FuseState::Unarmed
        },
        components: ComponentReservoirs {
            filler_kg: filler,
            unallocated_kg: mass - filler,
            ..Default::default()
        },
        charge: if filler > 0.0 {
            Some(ChargeOwnership {
                charge_id: format!("{body_id}/charge:0"),
                owner_id: body_id.into(),
                disposition: ChargeDisposition::PendingP3,
            })
        } else {
            None
        },
        profile,
        spall_share: match shell.kind {
            ProjectileKind::Apcr | ProjectileKind::Apds => 0.12,
            ProjectileKind::Apfsds => 0.15,
            _ => 0.30,
        },
    };
    current.validate()?;
    Ok(ImpactState {
        current,
        traversal: None,
    })
}

/// Only the incremental work of one declared traversal is charged. Calling twice at
/// the same cumulative progress (shared triangle edge, substep) consumes nothing.
pub fn advance_kinetic_layer(
    state: &mut ImpactState,
    contact: &DeclaredLayerContact,
) -> Result<ImpactTransition, ImpactError> {
    state.validate()?;
    if [
        contact.cumulative_required_mm,
        contact.cumulative_path_m,
        contact.thickness_mm,
        contact.density_kg_m3,
    ]
    .iter()
    .any(|v| !v.is_finite() || *v < 0.0)
        || contact.layer_id.is_empty()
    {
        return Err(ImpactError::InvalidInput);
    }
    let entry = state.current.clone();
    let mut next = state.clone();
    let radius = entry.estimated_footprint_diameter_m * 0.5;
    let mass_bound = contact.density_kg_m3
        * contact.thickness_mm
        * 0.001
        * std::f64::consts::PI
        * radius
        * radius;
    if !mass_bound.is_finite() {
        return Err(ImpactError::InvalidMass);
    }
    let mut cursor = match &state.traversal {
        Some(c) if c.layer_id == contact.layer_id && c.traversal_id == contact.traversal_id => {
            c.clone()
        }
        _ => LayerTraversalCursor {
            layer_id: contact.layer_id.clone(),
            traversal_id: contact.traversal_id,
            entry: entry.clone(),
            cumulative_required_mm: 0.0,
            cumulative_work_j: 0.0,
            cumulative_pen_used_mm: 0.0,
            cumulative_path_m: 0.0,
            armour_mass_bound_kg: mass_bound,
            cumulative_armour_mass_kg: 0.0,
        },
    };
    if contact.cumulative_required_mm < cursor.cumulative_required_mm
        || contact.cumulative_path_m < cursor.cumulative_path_m
        || (mass_bound - cursor.armour_mass_bound_kg).abs() > 1e-9 * mass_bound.max(1.0)
    {
        return Err(ImpactError::InvalidTraversal);
    }
    let input = entry.energy_j();
    let verdict = if cursor.entry.energy_j() == 0.0
        && contact.cumulative_required_mm > 0.0
        && contact.verdict == ImpactVerdict::Passed
    {
        ImpactVerdict::Stopped
    } else {
        contact.verdict
    };
    let q = if cursor.entry.remaining_pen_mm > 0.0 {
        (contact.cumulative_required_mm / cursor.entry.remaining_pen_mm).clamp(0.0, 1.0)
    } else if contact.cumulative_required_mm == 0.0 {
        0.0
    } else {
        1.0
    };
    let cumulative_work = cursor.entry.energy_j() * q * q;
    let mut work = (cumulative_work - cursor.cumulative_work_j)
        .max(0.0)
        .min(input);
    let used = if verdict == ImpactVerdict::Passed {
        contact
            .cumulative_required_mm
            .min(cursor.entry.remaining_pen_mm)
    } else {
        cursor.entry.remaining_pen_mm
    };
    next.remaining_pen_mm =
        (entry.remaining_pen_mm - (used - cursor.cumulative_pen_used_mm)).max(0.0);
    if verdict == ImpactVerdict::Passed {
        // P1 compatibility transit uses the traversal's incoming speed, so
        // subdivision/duplicate boundaries have the same time as one contact.
        // In particular, a Passed/E0 exit still has a finite actual exit time.
        let speed = cursor.entry.velocity_m_s.length() as f64;
        let distance = contact.cumulative_path_m - cursor.cumulative_path_m;
        if distance > 0.0 && speed > 0.0 {
            next.elapsed_s += distance / speed;
        }
        cursor.cumulative_path_m = contact.cumulative_path_m;
    }
    if verdict != ImpactVerdict::Passed {
        work = input;
        next.remaining_pen_mm = 0.0;
    }
    next.set_energy_j((input - work).max(0.0))?;
    let spall = if contact.emit_spall && verdict == ImpactVerdict::Passed {
        work * entry.spall_share
    } else {
        0.0
    };
    let unresolved = matches!(verdict, ImpactVerdict::Ricochet | ImpactVerdict::Shattered);
    let budget = EnergyBudget {
        input_j: input,
        core_out_j: next.energy_j(),
        armour_debris_j: spall,
        target_deposition_j: if unresolved { 0.0 } else { work - spall },
        unresolved_loss_j: if unresolved { work } else { 0.0 },
        ..Default::default()
    };
    budget.validate()?;
    let mut allocations = Vec::new();
    if spall > 0.0 {
        // Estimated local cylindrical footprint, explicitly not a fracture-size law.
        // Mobilized target mass follows cumulative work fraction within a single
        // fixed local bound, so a subdivided traversal cannot generate it again.
        let cumulative_mass = cursor.armour_mass_bound_kg * q * q;
        let mass = (cumulative_mass - cursor.cumulative_armour_mass_kg).max(0.0);
        cursor.cumulative_armour_mass_kg = cumulative_mass;
        if mass > 0.0 && mass.is_finite() {
            allocations.push(SourceAllocation {
                source: FragmentSource::ArmourSpall,
                mass_kg: mass,
                energy_j: spall,
                profile: ProfileReference {
                    id: "legacy_spall_share_work_fraction_local_cylinder".into(),
                    revision: MECHANISM_REVISION.into(),
                    source: ProfileSource::Estimated,
                },
            });
        } else {
            return Err(ImpactError::InvalidMass);
        }
    }
    cursor.cumulative_required_mm = contact.cumulative_required_mm;
    cursor.cumulative_work_j = if verdict == ImpactVerdict::Passed {
        cumulative_work
    } else {
        cursor.entry.energy_j()
    };
    cursor.cumulative_pen_used_mm = used;
    next.traversal = Some(cursor);
    next.validate()?;
    let transition = ImpactTransition {
        event_id: format!(
            "layer:{}/traversal:{}/work:{:.9}",
            contact.layer_id, contact.traversal_id, contact.cumulative_required_mm
        ),
        layer_id: contact.layer_id.clone(),
        traversal_id: contact.traversal_id,
        entry,
        output: next.current.clone(),
        verdict,
        budget,
        allocations,
    };
    *state = next;
    Ok(transition)
}

/// Named compatibility absorption, shared by active serial module/crew contacts.
/// Damage receives the local deposition, never the unchanged carrier energy.
pub fn deposit_contact_energy(
    state: &mut ImpactState,
    absorbed_pen_mm: f64,
    contact_id: &str,
) -> Result<ImpactTransition, ImpactError> {
    deposit_compatibility(state, absorbed_pen_mm, contact_id, false)
}
pub fn deposit_fragment_contact_energy(
    state: &mut ImpactState,
    absorbed_pen_mm: f64,
    contact_id: &str,
) -> Result<ImpactTransition, ImpactError> {
    deposit_compatibility(state, absorbed_pen_mm, contact_id, true)
}
fn deposit_compatibility(
    state: &mut ImpactState,
    absorbed_pen_mm: f64,
    contact_id: &str,
    fragment: bool,
) -> Result<ImpactTransition, ImpactError> {
    state.validate()?;
    if !absorbed_pen_mm.is_finite() || absorbed_pen_mm < 0.0 {
        return Err(ImpactError::InvalidInput);
    }
    let entry = state.current.clone();
    let ratio = if entry.remaining_pen_mm > 0.0 {
        (absorbed_pen_mm / entry.remaining_pen_mm).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let mut next = state.clone();
    next.remaining_pen_mm = (entry.remaining_pen_mm - absorbed_pen_mm).max(0.0);
    next.set_energy_j(
        entry.energy_j()
            * if fragment {
                (1.0 - ratio).powi(2)
            } else {
                1.0 - ratio
            },
    )?;
    next.traversal = None;
    let budget = EnergyBudget {
        input_j: entry.energy_j(),
        core_out_j: next.energy_j(),
        target_deposition_j: (entry.energy_j() - next.energy_j()).max(0.0),
        ..Default::default()
    };
    budget.validate()?;
    next.validate()?;
    let transition = ImpactTransition {
        event_id: format!("contact:{contact_id}"),
        layer_id: contact_id.into(),
        traversal_id: 0,
        entry,
        output: next.current.clone(),
        verdict: ImpactVerdict::Deposited,
        budget,
        allocations: vec![],
    };
    *state = next;
    Ok(transition)
}

pub fn fragment_state(
    physical: &PhysicalFragment,
    remaining_pen_mm: f64,
    id: &str,
    profile: &ProfileReference,
) -> Result<ImpactState, ImpactError> {
    physical.validate()?;
    let s = ImpactState {
        current: ImpactSnapshot {
            body_id: id.into(),
            admitted_mass_kg: physical.mass_kg,
            mass_kg: physical.mass_kg,
            velocity_m_s: physical.velocity_m_s,
            remaining_pen_mm,
            remaining_length_m: None,
            effective_diameter_m: None,
            launch_caliber_m: 0.0,
            estimated_footprint_diameter_m: 0.0,
            geometry_profile: ProfileReference {
                id: "unknown_fragment_geometry".into(),
                revision: MECHANISM_REVISION.into(),
                source: ProfileSource::Unknown,
            },
            integrity: 1.0,
            deformation: 0.0,
            cap: CapState::Absent,
            elapsed_s: 0.0,
            fuse: FuseState::Unarmed,
            components: ComponentReservoirs {
                unallocated_kg: physical.mass_kg,
                ..Default::default()
            },
            charge: None,
            profile: profile.clone(),
            spall_share: 0.0,
        },
        traversal: None,
    };
    s.validate()?;
    if !physical.energy_j.is_finite()
        || physical.energy_j < 0.0
        || (s.energy_j() - physical.energy_j).abs() > 1e-5 * physical.energy_j.max(1.0)
    {
        return Err(ImpactError::InvalidEnergy);
    }
    Ok(s)
}

/// Atomic finite inventory transfer. A piece inherits the single charge only if
/// it receives the entire remaining filler; all other pieces have no charge.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProjectilePieceTransfer {
    pub piece: ImpactSnapshot,
    pub transition: ImpactTransition,
}
pub fn transfer_projectile_piece(
    state: &mut ImpactState,
    piece_id: &str,
    components: ComponentReservoirs,
    energy_j: f64,
    carries_charge: bool,
) -> Result<ProjectilePieceTransfer, ImpactError> {
    state.validate()?;
    let remaining = state.components.subtract(&components)?;
    let mass = components.total_kg();
    if mass <= 0.0
        || mass >= state.mass_kg
        || piece_id.is_empty()
        || piece_id == state.body_id
        || !energy_j.is_finite()
        || energy_j < 0.0
        || energy_j > state.energy_j()
    {
        return Err(ImpactError::InvalidMass);
    }
    let charge = if carries_charge {
        let mut c = state.charge.clone().ok_or(ImpactError::InvalidCharge)?;
        if components.filler_kg != state.components.filler_kg || remaining.filler_kg != 0.0 {
            return Err(ImpactError::InvalidCharge);
        }
        c.owner_id = piece_id.into();
        Some(c)
    } else {
        if components.filler_kg > 0.0 {
            return Err(ImpactError::InvalidCharge);
        }
        None
    };
    let input = state.energy_j();
    let dir = state.velocity_m_s.normalized();
    let mut next = state.clone();
    next.mass_kg -= mass;
    next.components = remaining;
    next.traversal = None;
    if carries_charge {
        next.charge = None;
        next.fuse = FuseState::Unarmed;
    }
    next.velocity_m_s = dir * (2.0 * (input - energy_j) / next.mass_kg).sqrt() as f32;
    let mut piece = state.current.clone();
    piece.body_id = piece_id.into();
    piece.mass_kg = mass;
    piece.components = components;
    piece.charge = charge;
    piece.velocity_m_s = dir * (2.0 * energy_j / mass).sqrt() as f32;
    if !carries_charge {
        piece.fuse = FuseState::Unarmed;
    }
    next.validate()?;
    piece.validate()?;
    let budget = EnergyBudget {
        input_j: input,
        core_out_j: next.energy_j(),
        projectile_pieces_j: piece.energy_j(),
        ..Default::default()
    };
    budget.validate()?;
    let transition = ImpactTransition {
        event_id: format!("piece:{piece_id}"),
        layer_id: state.body_id.clone(),
        traversal_id: 0,
        entry: state.current.clone(),
        output: next.current.clone(),
        verdict: ImpactVerdict::PieceTransfer,
        budget,
        allocations: vec![SourceAllocation {
            source: FragmentSource::ProjectilePiece,
            mass_kg: mass,
            energy_j: piece.energy_j(),
            profile: piece.profile.clone(),
        }],
    };
    *state = next;
    Ok(ProjectilePieceTransfer { piece, transition })
}
