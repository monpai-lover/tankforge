//! Report-local identifiers and serialization data; no renderer ownership.
use tg_penetration::impact::{
    FragmentProvenance, FragmentSource, ImpactEvent, ImpactTransition, PhysicalFragment,
    MECHANISM_REVISION,
};
use tg_shared::Vec3;

pub(crate) fn event(
    transition: ImpactTransition,
    entry: Vec3,
    exit: Vec3,
    normal: Vec3,
) -> ImpactEvent {
    ImpactEvent {
        mechanism_revision: MECHANISM_REVISION.into(),
        time_s: transition.entry.elapsed_s,
        entry_position: entry,
        exit_position: exit,
        normal,
        transition,
    }
}

pub(crate) fn core_provenance(transition: &ImpactTransition) -> FragmentProvenance {
    let s = &transition.entry;
    FragmentProvenance {
        fragment_id: s.body_id.clone(),
        parent_event_id: transition.event_id.clone(),
        source: FragmentSource::Core,
        source_layer_or_module: Some(transition.layer_id.clone()),
        physical: Some(PhysicalFragment {
            mass_kg: s.mass_kg,
            energy_j: s.energy_j(),
            area_m2: s
                .effective_diameter_m
                .map(|d| std::f64::consts::PI * (d * 0.5).powi(2)),
            velocity_m_s: s.velocity_m_s,
        }),
        weight: 1.0,
        start_s: Some(s.elapsed_s),
        profile: Some(s.profile.clone()),
    }
}

pub(crate) fn segment_provenance(
    provenance: &FragmentProvenance,
    state: &tg_penetration::impact::ImpactSnapshot,
) -> FragmentProvenance {
    let mut provenance = provenance.clone();
    if let Some(physical) = provenance.physical.as_mut() {
        physical.mass_kg = state.mass_kg;
        physical.energy_j = state.energy_j();
        physical.velocity_m_s = state.velocity_m_s;
    }
    provenance.start_s = Some(state.elapsed_s);
    provenance
}
