//! Per-actor geometry and build-time anatomy associations. Engineering planes
//! supply resistance only; they never supply a contact to this scene.
use super::ray::{cross, dot, sub, Point};
use super::{
    manifest::{check_hash, sha256},
    surface::{QueryContext, SurfaceCrossingV1},
    Geometry,
};
use crate::{Ev, EvKind, SurfaceTransit, Target};
use serde_json::Value;
use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
};
use tg_shared::Vec3;
#[cfg(test)]
std::thread_local! {
    static DAMAGE_REGISTRATION_CHECKS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}
#[cfg(test)]
pub(crate) fn damage_registration_checks_for_test() -> u64 {
    DAMAGE_REGISTRATION_CHECKS.with(std::cell::Cell::get)
}
#[cfg(test)]
#[path="barrel_scene_tests.rs"]
mod barrel_scene_tests;
#[cfg(test)]
#[path="material_region_tests.rs"]
mod material_region_tests;

fn closest_triangle(p: Point, [a, b, c]: [Point; 3]) -> Option<Point> {
    let ab = sub(b, a);
    let ac = sub(c, a);
    let n = cross(ab, ac);
    if dot(n, n) == 0. {
        return None;
    }
    let ap = sub(p, a);
    let d1 = dot(ab, ap);
    let d2 = dot(ac, ap);
    if d1 <= 0. && d2 <= 0. {
        return Some(a);
    }
    let bp = sub(p, b);
    let d3 = dot(ab, bp);
    let d4 = dot(ac, bp);
    if d3 >= 0. && d4 <= d3 {
        return Some(b);
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0. && d1 >= 0. && d3 <= 0. {
        let t = d1 / (d1 - d3);
        return Some(std::array::from_fn(|k| a[k] + ab[k] * t));
    }
    let cp = sub(p, c);
    let d5 = dot(ab, cp);
    let d6 = dot(ac, cp);
    if d6 >= 0. && d5 <= d6 {
        return Some(c);
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0. && d2 >= 0. && d6 <= 0. {
        let t = d2 / (d2 - d6);
        return Some(std::array::from_fn(|k| a[k] + ac[k] * t));
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0. && d4 - d3 >= 0. && d5 - d6 >= 0. {
        let t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return Some(std::array::from_fn(|k| b[k] + (c[k] - b[k]) * t));
    }
    let den = va + vb + vc;
    if den == 0. || !den.is_finite() {
        return None;
    }
    let v = vb / den;
    let w = vc / den;
    Some(std::array::from_fn(|k| a[k] + ab[k] * v + ac[k] * w))
}

#[derive(Clone)]
struct Binding {
    kind: EvKind,
    region: Option<String>,
    side: Option<String>,
}
pub struct CombatScene {
    geometry: RefCell<Geometry>,
    context: QueryContext,
    target_id: String,
    target_signature: String,
    catalog_hash: String,
    bindings: HashMap<String, Binding>,
    instance_bindings: HashMap<String, HashMap<String, Binding>>,
    error: RefCell<Option<String>>,
}
/// A build-pinned derivative. Runtime callers cannot admit their own record.
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct BarrelShapeVariantV1 {
    pub schema:String,
    pub shape_id:String,
    pub shape_hash:String,
    pub parent_stock_manifest_hash:String,
    pub parent_stock_catalog_hash:String,
    pub build_hash:String,
    pub anatomy_hash:String,
    pub target_registration_hash:String,
    #[serde(skip)]
    pub source_mesh_key:String,
    pub instance_id:String,
    pub physical_barrel_id:String,
    pub physical_contact_source_keys:Vec<String>,
    pub module_ref:String,
    pub mounted_weapon_key:String,
    pub recipe:Value,
    pub renderer_attribute_upload_hash:String,
    pub position_payload_hash:String,
    pub damaged_manifest_hash:String,
    pub damaged_catalog_hash:String,
    pub triangle_provenance_hash:String,
    #[serde(default,skip_serializing_if="Vec::is_empty")]
    pub changed_meshes:Vec<BarrelChangedMeshV1>,
}
/// One explicitly reviewed upload in a physical weapon's derivative. The
/// optional ancestor is an identity assertion, never a proximity/name lookup.
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct BarrelChangedMeshV1 {
    pub source_mesh_key:String,
    pub instance_id:String,
    pub physical_contact_source_keys:Vec<String>,
    pub recipe:Value,
    pub renderer_attribute_upload_hash:String,
    pub position_payload_hash:String,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub triangle_provenance_hash:Option<String>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub effective_recoil_assembly_key:Option<String>,
}
impl BarrelShapeVariantV1 {
    pub fn mesh_changes(&self)->Vec<BarrelChangedMeshV1>{
        if self.changed_meshes.is_empty(){vec![BarrelChangedMeshV1 {source_mesh_key:self.source_mesh_key.clone(),
            instance_id:self.instance_id.clone(),physical_contact_source_keys:self.physical_contact_source_keys.clone(),
            recipe:self.recipe.clone(),renderer_attribute_upload_hash:self.renderer_attribute_upload_hash.clone(),
            position_payload_hash:self.position_payload_hash.clone(),triangle_provenance_hash:Some(self.triangle_provenance_hash.clone()),effective_recoil_assembly_key:None}]}
        else{self.changed_meshes.clone()}
    }
    pub fn parse_pinned(bytes:&[u8],hash:&str,approved:&[u8])->Result<Self,String>{
        if bytes.len()>1024*1024||approved.len()>1024*1024{return Err("barrel variant record byte limit".into());}
        check_hash(bytes,hash)?;
        let mut record:Self=serde_json::from_slice(bytes).map_err(|e|format!("barrel variant record: {e}"))?;
        let pinned:Self=serde_json::from_slice(approved).map_err(|e|format!("compiled barrel variant: {e}"))?;
        canonical_hash_member(bytes,"shapeHash",&record.shape_hash)?;
        canonical_hash_member(approved,"shapeHash",&pinned.shape_hash)?;
        if record.shape_hash!=pinned.shape_hash||record.schema!="BarrelShapeVariantV1" {return Err("unapproved barrel shape variant".into());}
        record.source_mesh_key=text(&record.recipe,"sourceMeshKey")?.to_owned();
        let valid_hash=|s:&str|s.len()==64&&s.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase());
        if [&record.parent_stock_manifest_hash,&record.parent_stock_catalog_hash,&record.build_hash,&record.anatomy_hash,
            &record.target_registration_hash,&record.renderer_attribute_upload_hash,&record.position_payload_hash,
            &record.damaged_manifest_hash,&record.damaged_catalog_hash,&record.triangle_provenance_hash]
            .into_iter().any(|h|!valid_hash(h))||record.shape_id.is_empty()||record.shape_id.len()>128
            ||record.shape_id=="stock"||record.physical_barrel_id.is_empty()||record.physical_contact_source_keys.is_empty()
            ||record.physical_contact_source_keys.len()>32{return Err("invalid pinned barrel variant identity".into());}
        let changes=record.mesh_changes();let mut keys=HashSet::new();let mut instances=HashSet::new();
        if changes.len()>32{return Err("barrel changed upload count limit".into());}
        for c in &changes {
            if c.source_mesh_key.is_empty()||!keys.insert(&c.source_mesh_key)||c.instance_id.is_empty()
                ||!instances.insert(&c.instance_id)||c.physical_contact_source_keys.len()>32
                ||!valid_hash(&c.position_payload_hash)||!valid_hash(&c.renderer_attribute_upload_hash)
                ||c.triangle_provenance_hash.as_ref().is_some_and(|h|!valid_hash(h))
                ||c.effective_recoil_assembly_key.as_ref().is_some_and(|k|k.is_empty()||k.len()>1024){
                return Err("invalid pinned barrel changed upload identity".into());
            }
            let bits=c.recipe["cutPlaneBits"].as_u64().filter(|b|*b<=u32::MAX as u64).ok_or("barrel cut bits missing")?;
            let cut=f32::from_bits(bits as u32);
            if c.recipe["schema"]!="BarrelFractureRecipeV1"||c.recipe["sourceMeshKey"]!=c.source_mesh_key
                ||c.recipe["keepSide"]!="local_z_le_cut"||!cut.is_finite()
                ||c.recipe["cutPlaneLocalZ"].as_f64()!=Some(cut as f64){return Err("invalid pinned barrel cut recipe".into());}
        }
        let primary=changes.iter().find(|c|c.source_mesh_key==record.source_mesh_key).ok_or("primary barrel upload is not declared")?;
        if primary.instance_id!=record.instance_id||primary.recipe!=record.recipe
            ||primary.position_payload_hash!=record.position_payload_hash
            ||primary.renderer_attribute_upload_hash!=record.renderer_attribute_upload_hash
            ||primary.triangle_provenance_hash.as_ref().is_some_and(|h|h!=&record.triangle_provenance_hash)
            ||primary.physical_contact_source_keys!=record.physical_contact_source_keys {
            return Err("primary barrel upload differs from compatibility fields".into());
        }
        Ok(record)
    }
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    v[key]
        .as_str()
        .ok_or_else(|| format!("binding catalog missing {key}"))
}
fn physical_weapon_module(target:&Target,variant:&BarrelShapeVariantV1)->Result<usize,String>{
    let module=target.def.modules.iter().position(|m|m.id==variant.module_ref)
        .ok_or("variant is not a registered physical weapon module")?;
    let weapon=target.weapon_bindings.get(&variant.mounted_weapon_key).ok_or("variant mounted weapon missing")?;
    let allowed=matches!((target.def.modules[module].kind,weapon.kind),
        (crate::ModuleKind::GunBarrel,crate::weapon_damage::WeaponKind::Cannon)
        |(crate::ModuleKind::ApsGun,crate::weapon_damage::WeaponKind::Cannon)
        |(crate::ModuleKind::MachineGun,crate::weapon_damage::WeaponKind::MachineGun));
    if !allowed||weapon.binding_error.is_some()||!weapon.critical.contains(&module){
        return Err("variant physical module does not belong to mounted weapon".into());
    }Ok(module)
}
fn physical_joint(target:&Target,stock:&super::manifest::HitMeshManifestV1,
    instance:&super::manifest::InstanceRecord,change:&BarrelChangedMeshV1,variant:&BarrelShapeVariantV1)->Result<(),String>{
    let wanted=change.effective_recoil_assembly_key.as_deref().unwrap_or(&instance.assembly_key);
    let mut at=Some(instance.assembly_key.as_str());let mut accepted=None;
    for _ in 0..=stock.assemblies.len(){
        let Some(key)=at else{break;};let assembly=stock.assemblies.iter().find(|a|a.key==key).ok_or("barrel assembly missing")?;
        if key==wanted{accepted=Some(assembly);break;}at=assembly.parent.as_deref();
    }
    let joint=&accepted.ok_or("declared barrel recoil is not an ancestor")?.joint;
    let weapon=target.weapon_bindings.get(&variant.mounted_weapon_key).ok_or("variant mounted weapon missing")?;
    let ti=weapon.turret_index.map(|i|i as u64);let gi=weapon.gun_index.map(|i|i as u64);
    let recoil=(joint["kind"]=="recoil"||joint["kind"]=="gun")&&joint["turret"].as_u64()==ti&&joint["gun"].as_u64()==gi&&ti.is_some()&&gi.is_some();
    let mg=joint["kind"]=="mg"&&joint["mountedWeaponKey"]==weapon.key
        &&joint["machineGunId"].as_str()==weapon.secondary_id.as_deref();
    // The normalizer explicitly registers coax secondaries against gun 0 of
    // turret 0. This association is read from anatomy, never a mesh label.
    let secondary=target.def.weapons["secondary"].as_array().and_then(|rows|rows.iter().find(|s|
        s["id"].as_str()==weapon.secondary_id.as_deref()));
    let coax=secondary.is_some_and(|s|s["mount"]=="coax")&&ti==Some(0)
        &&joint["kind"]=="recoil"&&joint["turret"]==0&&joint["gun"]==0;
    let hull=secondary.is_some_and(|s|s["mount"]=="hull")&&ti.is_none()&&joint["kind"]=="body";
    let owned=match weapon.kind {
        crate::weapon_damage::WeaponKind::Cannon=>recoil,
        crate::weapon_damage::WeaponKind::MachineGun=>mg||coax||hull,
        crate::weapon_damage::WeaponKind::Missile=>false,
    };
    if joint["status"]!="declared"||!owned{return Err("barrel effective joint weapon mismatch".into());}Ok(())
}
fn canonical_hash_member(bytes: &[u8], key: &str, hash: &str) -> Result<(), String> {
    let body = without_member(bytes, key, hash)?;
    check_hash(&body, hash)
}
fn without_member(bytes: &[u8], key: &str, value: &str) -> Result<Vec<u8>, String> {
    let needle = format!("\"{key}\":\"{value}\",");
    let n = needle.as_bytes();
    let offsets: Vec<_> = bytes
        .windows(n.len())
        .enumerate()
        .filter_map(|(i, b)| (b == n).then_some(i))
        .collect();
    if offsets.len() != 1 {
        return Err(format!("noncanonical {key} member"));
    }
    let at = offsets[0];
    let mut body = Vec::with_capacity(bytes.len() - n.len());
    body.extend_from_slice(&bytes[..at]);
    body.extend_from_slice(&bytes[at + n.len()..]);
    Ok(body)
}
impl CombatScene {
    pub fn new(
        geometry: Geometry,
        manifest_hash: &str,
        catalog: &[u8],
        catalog_hash: &str,
        target: &Target,
        context: QueryContext,
    ) -> Result<Self, String> {
        Self::new_checked(geometry,manifest_hash,catalog,catalog_hash,target,context,None)
    }
    pub fn new_barrel_variant(geometry:Geometry,manifest_hash:&str,catalog:&[u8],catalog_hash:&str,
        target:&Target,context:QueryContext,parent:&Self,variant:&BarrelShapeVariantV1)->Result<Self,String>{
        let original=parent.geometry.borrow();let stock=&original.manifest;let next=&geometry.manifest;
        if original.manifest_file_hash()!=variant.parent_stock_manifest_hash||parent.catalog_hash!=variant.parent_stock_catalog_hash
            ||stock.build_hash!=variant.build_hash||stock.anatomy_data_hash!=variant.anatomy_hash
            ||target.registration_hash()!=variant.target_registration_hash||manifest_hash!=variant.damaged_manifest_hash
            ||catalog_hash!=variant.damaged_catalog_hash||next.build_hash!=stock.build_hash
            ||next.anatomy_data_hash!=stock.anatomy_data_hash||next.spec_id!=stock.spec_id
            ||next.meshes.len()!=stock.meshes.len()
            ||serde_json::to_value(&next.mesh_instances).unwrap()!=serde_json::to_value(&stock.mesh_instances).unwrap()
            ||serde_json::to_value(&next.assemblies).unwrap()!=serde_json::to_value(&stock.assemblies).unwrap(){
            return Err("barrel variant parent/build/anatomy/instance mismatch".into());
        }
        let module=physical_weapon_module(target,variant)?;
        let changes=variant.mesh_changes();let mut changed_keys=HashSet::new();
        if changes.is_empty()||changes.len()>32{return Err("barrel changed upload count limit".into());}
        for change in &changes {
            if !changed_keys.insert(change.source_mesh_key.as_str()){return Err("duplicate changed barrel upload".into());}
            let instance=stock.mesh_instances.iter().find(|i|i.key==change.instance_id&&i.mesh_key==change.source_mesh_key)
                .ok_or("variant physical barrel instance missing")?;
            // A shared upload cannot fracture one instance without fracturing its peers.
            if stock.mesh_instances.iter().filter(|i|i.mesh_key==change.source_mesh_key).count()!=1 {
                return Err("variant upload has multiple physical instances".into());
            }
            physical_joint(target,stock,instance,change,variant)?;
            let mesh=stock.meshes.iter().find(|m|m.key==change.source_mesh_key).ok_or("variant source upload absent")?;
            let derivative=next.meshes.iter().find(|m|m.key==mesh.key).ok_or("variant removed original mesh key")?;
            if derivative.payload_hash!=change.position_payload_hash||derivative.render_buffer_hash!=change.renderer_attribute_upload_hash
                ||mesh.payload_hash==derivative.payload_hash{return Err("variant recoil payload mismatch".into());}
            for source in &change.physical_contact_source_keys {
                let ranges:Vec<_>=mesh.ranges.iter().filter(|r|r.source_key==*source).collect();
                if ranges.is_empty(){return Err("unreviewed physical barrel source".into());}
                for range in ranges {
                    let surface=stock.surfaces.iter().find(|s|s.key==range.surface_key).ok_or("barrel physical surface missing")?;
                    if !matches!(parent.binding(&instance.key,surface.response_ref.as_deref(),&surface.key).map(|b|&b.kind),Some(EvKind::Module(i)) if *i==module){
                        return Err("physical tube source lacks barrel response".into());
                    }
                }
            }
        }
        if changes.iter().all(|c|c.physical_contact_source_keys.is_empty()){return Err("variant lacks physical tube source".into());}
        for mesh in &stock.meshes {
            let derivative=next.meshes.iter().find(|m|m.key==mesh.key).ok_or("variant removed original mesh key")?;
            if !changed_keys.contains(mesh.key.as_str())&&serde_json::to_value(mesh).unwrap()!=serde_json::to_value(derivative).unwrap(){
                return Err("barrel variant changed unrelated mesh".into());
            }
        }
        drop(original);
        Self::new_checked(geometry,manifest_hash,catalog,catalog_hash,target,context,Some(variant))
    }
    fn new_checked(geometry:Geometry,manifest_hash:&str,catalog:&[u8],catalog_hash:&str,target:&Target,
        mut context:QueryContext,variant:Option<&BarrelShapeVariantV1>)->Result<Self,String>{
        if catalog.len() > 16 * 1024 * 1024 {
            return Err("binding catalog byte limit".into());
        }
        check_hash(catalog, catalog_hash)?;
        let c: Value = serde_json::from_slice(catalog).map_err(|e| e.to_string())?;
        canonical_hash_member(catalog, "catalogHash", text(&c, "catalogHash")?)?;
        let m = &geometry.manifest;
        if text(&c,"targetRegistrationHash")? != target.registration_hash() {
            return Err("registered target differs from accepted engineering registration".into());
        }
        if c["schema"] != "HitBindingCatalogV1"
            || geometry.manifest_file_hash() != manifest_hash
            || text(&c, "manifestHash")? != manifest_hash
            || text(&c, "specId")? != m.spec_id
            || text(&c, "buildHash")? != m.build_hash
            || text(&c, "anatomyHash")? != m.anatomy_data_hash
            || c["geometryBytesChanged"] != if variant.is_some(){1}else{0}
            || text(&c, "sourceGeneratorHash")? != text(&m.generator, "sha256")?
            || context.build_hash != m.build_hash
        {
            return Err("binding catalog/target/context identity mismatch".into());
        }
        let expected_shape=variant.map(|v|v.shape_hash.as_str()).unwrap_or(manifest_hash);
        if context.shape_hash.as_deref().is_some_and(|h|h!=expected_shape)
            ||(variant.is_none()&&context.geometry_revision!=0){return Err("surface initial shape identity mismatch".into());}
        context.shape_hash=Some(expected_shape.into());
        if let Some(v)=variant {
            if c["shapeVariant"]["shapeId"]!=v.shape_id||c["shapeVariant"]["parentStockManifestHash"]!=v.parent_stock_manifest_hash
                ||c["shapeVariant"]["parentStockCatalogHash"]!=v.parent_stock_catalog_hash||c["shapeVariant"]["recipe"]!=v.recipe {
                return Err("derivative catalog lacks pinned variant parent recipe".into());
            }
        }
        if context.entity_id.is_empty() || context.entity_id.len() > 128 || context.spawn_epoch == 0
        {
            return Err("invalid accepted actor identity".into());
        }
        let rows = c["declarations"]
            .as_array()
            .ok_or("binding declarations missing")?;
        #[derive(serde::Deserialize)]
        struct RawCatalog {
            declarations: Vec<Box<serde_json::value::RawValue>>,
            #[serde(rename="acceptedAnatomy")] accepted_anatomy:Box<serde_json::value::RawValue>,
        }
        let raw: RawCatalog = serde_json::from_slice(catalog).map_err(|e| e.to_string())?;
        check_hash(raw.accepted_anatomy.get().as_bytes(),&m.anatomy_data_hash)?;
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Anatomy {armor:Vec<tg_armor::ArmorPlate>,modules:Vec<crate::Module>,crew:Vec<crate::Crew>,weapons:Value}
        let mut anatomy:Anatomy=serde_json::from_str(raw.accepted_anatomy.get()).map_err(|e|format!("accepted anatomy contract: {e}"))?;
        // The public neutral target adapter emits posed engineering plates and
        // strips their source-only hinge descriptors. Those descriptors remain
        // hash-pinned in acceptedAnatomy and the surface articulation owner.
        // The strict registration hash above still pins every actual target
        // field; this adapter does not admit a changed plate pose or fold.
        for (source,registered) in anatomy.armor.iter_mut().zip(&target.def.plates){
            if registered.hinge.is_none(){source.hinge=None;}
        }
        // Both sides are decoded by the same f32 engineering types. This avoids
        // treating JS/Rust decimal reserialization as an anatomy identity test.
        let expected=serde_json::json!({"armor":anatomy.armor,"modules":anatomy.modules,"crew":anatomy.crew,"weapons":anatomy.weapons});
        let actual=serde_json::json!({"armor":target.def.plates,"modules":target.def.modules,"crew":target.def.crew,"weapons":target.def.weapons});
        if expected!=actual {return Err("registered target differs from accepted anatomy".into());}
        let mut module_ids=HashSet::new();
        if target.def.modules.iter().any(|m|!module_ids.insert(m.id.as_str())) {
            return Err("ambiguous registered module identifier".into());
        }
        let layers = c["layers"].as_array().ok_or("binding layers missing")?;
        if rows.len() > 1_000_000 || layers.len() > 16384 {
            return Err("binding catalog count limit".into());
        }
        let mut armor = HashMap::new();
        for l in layers {
            let key = text(l, "key")?;
            let id = text(l, "armorRef")?;
            let i = target
                .def
                .plates
                .iter()
                .position(|p| p.id == id)
                .ok_or("unknown authored armor reference")?;
            let p = &target.def.plates[i];
            let authored_thickness:f32=serde_json::from_value(l["authoredThicknessMm"].clone())
                .map_err(|_|"invalid authored armor thickness")?;
            if l["chargePolicy"] != "once_per_material_region"
                || l["historicalMeasurement"] != false
                || !authored_thickness.is_finite()||authored_thickness.to_bits()!=p.thickness_mm.to_bits()
                || l["authoredMaterial"] != p.material
                || armor.insert(key.to_owned(), i).is_some()
            {
                return Err("authored armor layer mismatch".into());
            }
        }
        let mut bindings = HashMap::new();
        let mut by_range = HashMap::new();
        let mut instance_owned = HashMap::new();
        for (ordinal, d) in rows.iter().enumerate() {
            let key = text(d, "key")?;
            if key.len() > 128 || d["contactEligible"] != true {
                return Err("invalid declaration identity/policy".into());
            }
            // Each declaration is independently content-addressed, with no guessed refs.
            let dh = text(&d["declaration"], "contentHash")?;
            let body = without_member(
                &without_member(raw.declarations[ordinal].get().as_bytes(), "key", key)?,
                "contentHash",
                dh,
            )?;
            if sha256(&body) != dh || key != format!("decl:{dh}") {
                return Err("binding declaration content hash mismatch".into());
            }
            let a = &d["armorBinding"];
            let role = text(d, "role")?;
            if d["declaration"]["basis"]=="authored_running_gear_instance_side"
                && (role!="module" || !d["moduleRef"].is_null() || !d["crewSlot"].is_null()) {
                return Err("instance-side declaration has ambiguous anatomy ownership".into());
            }
            let (kind, region, side) = match role {
                "armor" => {
                    let refs = a["armorRefs"].as_array().ok_or("armor refs missing")?;
                    let i = *armor
                        .get(text(a, "layerKey")?)
                        .ok_or("declared armor layer missing")?;
                    if a["status"] != "declared"
                        || refs.len() != 1
                        || refs[0] != target.def.plates[i].id
                        || a["thicknessSource"] != "authored_engineering"
                        || !["outer", "inner", "reveal"].contains(&text(a, "boundarySide")?)
                    {
                        return Err("unsupported armor declaration".into());
                    }
                    (
                        EvKind::Plate(i),
                        Some(
                            a["materialRegionKey"]
                                .as_str()
                                .unwrap_or(text(a, "layerKey")?)
                                .to_owned(),
                        ),
                        Some(text(a, "boundarySide")?.to_owned()),
                    )
                }
                "module" => {
                    if d["moduleRef"].is_null() {
                        if d["declaration"]["basis"] != "authored_running_gear_instance_side"
                            || d["fuseEligible"] != false
                            || d["resistancePolicy"] != "no_authored_armor"
                        {
                            return Err("module declaration lacks a registered owner".into());
                        }
                        instance_owned.insert(key.to_owned(), (text(d,"meshKey")?.to_owned(), text(d,"sourceKey")?.to_owned()));
                        (EvKind::Unknown, None, None)
                    } else {
                    let id = text(d, "moduleRef")?;
                    let i = target
                        .def
                        .modules
                        .iter()
                        .position(|m| m.id == id)
                        .ok_or("unknown module declaration")?;
                    (EvKind::Module(i), None, None)
                    }
                }
                "crew" => {
                    let i = d["crewSlot"]["index"]
                        .as_u64()
                        .ok_or("crew slot required")? as usize;
                    if i >= target.def.crew.len()
                        || d["crewSlot"]["anatomyHash"] != m.anatomy_data_hash
                        || serde_json::to_value(target.def.crew[i].role)
                            .map_err(|e| e.to_string())?
                            != d["crewSlot"]["role"]
                    {
                        return Err("crew anatomy mismatch".into());
                    }
                    (EvKind::Crew(i), None, None)
                }
                "decoration" if a["status"] == "none" => (EvKind::Decoration, None, None),
                "unknown" if d["resistancePolicy"] == "unsupported" => {
                    (EvKind::Unknown, None, None)
                }
                _ => return Err("unsupported surface role".into()),
            };
            if (!matches!(kind, EvKind::Plate(_) | EvKind::Unknown) || instance_owned.contains_key(key))
                && (a["status"] != "none"
                    || a["armorRefs"].as_array().map_or(true, |x| !x.is_empty())
                    || !a["layerKey"].is_null())
            {
                return Err("nonarmor surface borrows armor".into());
            }
            let range = (
                text(d, "meshKey")?.to_owned(),
                d["first"].as_u64().ok_or("range first missing")?,
                d["count"].as_u64().ok_or("range count missing")?,
            );
            if by_range
                .insert(range, (key.to_owned(), text(d, "sourceKey")?.to_owned()))
                .is_some()
                || bindings
                    .insert(key.to_owned(), Binding { kind, region, side })
                    .is_some()
            {
                return Err("duplicate anatomy declaration".into());
            }
        }
        let mut covered = 0;
        for mesh in &m.meshes {
            for range in &mesh.ranges {
                let (key, source) = by_range
                    .get(&(mesh.key.clone(), range.first as u64, range.count as u64))
                    .ok_or("unregistered physical triangle range")?;
                let surface = m
                    .surfaces
                    .iter()
                    .find(|s| s.key == range.surface_key)
                    .ok_or("surface missing")?;
                if source != &range.source_key
                    || ((!matches!(bindings[key].kind, EvKind::Unknown) || instance_owned.contains_key(key))
                        && surface.response_ref.as_deref() != Some(key.as_str()))
                {
                    return Err("declaration triangle identity mismatch".into());
                }
                covered += 1;
            }
        }
        if covered != by_range.len() {
            return Err("declarations exceed geometry coverage".into());
        }
        // Shared shoe/rod payloads retain their physical identity. Only the
        // explicitly authored instance side may select a registered Track owner.
        // The same resolver is used for direct projectiles and blast exposure.
        #[derive(serde::Deserialize)]
        #[serde(rename_all="camelCase",deny_unknown_fields)]
        struct Override {response_ref:String,source_key:String,module_ref:String,owner_side:i8,policy:String}
        let instance_rows=c["instances"].as_array().ok_or("binding instances missing")?;
        if instance_rows.len()!=m.mesh_instances.len() {return Err("binding instance coverage mismatch".into());}
        let mut instance_bindings:HashMap<String,HashMap<String,Binding>>=HashMap::new();
        let mut instance_keys=HashSet::new();
        for row in instance_rows {
            if row.as_object().map_or(true,|r|r.keys().any(|key|!["instanceKey","assemblyKey","materialFeature","responseOverrides"].contains(&key.as_str()))) {
                return Err("invalid binding instance fields".into());
            }
            let id=text(row,"instanceKey")?;
            let instance=m.mesh_instances.iter().find(|i|i.key==id).ok_or("unknown binding instance")?;
            if !instance_keys.insert(id.to_owned()) || row["assemblyKey"]!=instance.assembly_key || row["materialFeature"]!=instance.material_feature {
                return Err("binding instance identity mismatch".into());
            }
            if row.get("responseOverrides").is_some_and(|v|v.as_array().map_or(true,|a|a.is_empty())) {
                return Err("invalid empty or null instance response overrides".into());
            }
            let overrides:Vec<Override>=serde_json::from_value(row.get("responseOverrides").cloned().unwrap_or_else(||serde_json::json!([]))).map_err(|e|format!("instance response overrides: {e}"))?;
            let required=instance_owned.iter().filter(|(_, (mesh,_))|mesh==&instance.mesh_key).count();
            if overrides.len()!=required {return Err("instance response override coverage mismatch".into());}
            let mut seen=HashSet::new();
            for o in overrides {
                let (mesh,source)=instance_owned.get(&o.response_ref).ok_or("override of a direct or unknown declaration")?;
                if mesh!=&instance.mesh_key || source!=&o.source_key || !seen.insert(o.response_ref.clone())
                    || o.policy!="registered_module_kind" || ![-1,1].contains(&o.owner_side)
                    || instance.material_feature["status"]!="declared_identity"
                    || !["track_link","running_gear_connection"].contains(&instance.material_feature["kind"].as_str().unwrap_or(""))
                    || instance.material_feature["side"].as_i64()!=Some(o.owner_side as i64)
                {return Err("instance response owner identity mismatch".into());}
                let i=target.def.modules.iter().position(|m|m.id==o.module_ref).ok_or("unknown instance module reference")?;
                if target.def.modules[i].kind!=crate::ModuleKind::Track || target.track_side.get(i)!=Some(&o.owner_side) {
                    return Err("instance owner is not the registered running-gear side".into());
                }
                instance_bindings.entry(id.to_owned()).or_default().insert(o.response_ref,Binding{kind:EvKind::Module(i),region:None,side:None});
            }
        }
        // Unknown ranges intentionally keep their pending manifest surface. Resolve
        // those through the range key rather than giving them nearby armor.
        for mesh in &m.meshes {
            for range in &mesh.ranges {
                let (key, _) =
                    &by_range[&(mesh.key.clone(), range.first as u64, range.count as u64)];
                if matches!(bindings[key].kind, EvKind::Unknown) && !instance_owned.contains_key(key) {
                    bindings.insert(
                        format!("surface:{}", range.surface_key),
                        bindings[key].clone(),
                    );
                }
            }
        }
        Ok(Self {
            target_id: target.def.id.clone(),
            target_signature:target.registration_hash(),
            catalog_hash:catalog_hash.into(),
            geometry: RefCell::new(geometry),
            context,
            bindings,
            instance_bindings,
            error: RefCell::new(None),
        })
    }
    fn binding(&self, instance:&str, response:Option<&str>, surface:&str)->Option<&Binding> {
        match response {
            Some(key)=>self.instance_bindings.get(instance).and_then(|map|map.get(key)).or_else(||self.bindings.get(key)),
            None=>self.bindings.get(&format!("surface:{surface}")),
        }
    }
    pub fn accepts(&self, target: &Target) -> bool {
        #[cfg(test)]
        DAMAGE_REGISTRATION_CHECKS.with(|count| count.set(count.get() + 1));
        self.target_id == target.def.id && self.target_signature==target.registration_hash()
    }
    pub fn context(&self)->&QueryContext {&self.context}
    pub fn manifest_hash(&self)->String {self.geometry.borrow().manifest_file_hash().into()}
    /// Complete scene assembled exclusively from already admitted derivatives.
    /// No caller manifest, response binding or mesh upload enters this path.
    pub fn compose_barrel_variants(&self,variants:&[(&Self,&BarrelShapeVariantV1)],
        store:&super::MeshStore,mut context:QueryContext)->Result<Self,String>{
        if variants.len()>8{return Err("actor barrel variant capacity".into());}
        for (scene,record) in variants {
            if record.parent_stock_manifest_hash!=self.manifest_hash()||record.parent_stock_catalog_hash!=self.catalog_hash
                ||scene.target_signature!=self.target_signature||scene.manifest_hash()!=record.damaged_manifest_hash
                ||scene.catalog_hash!=record.damaged_catalog_hash||scene.context.shape_hash.as_deref()!=Some(&record.shape_hash){
                return Err("composed barrel parent/derivative mismatch".into());
            }
        }
        if variants.len()<2 {
            let base=variants.first().map(|(scene,_)|*scene).unwrap_or(self);
            let records:Vec<_>=variants.iter().map(|(_,record)|*record).collect();
            let (_,hash)=barrel_composition_identity(&self.manifest_hash(),&records)?;
            if context.shape_hash.as_ref().is_some_and(|h|h!=&hash){return Err("composed shape identity mismatch".into());}
            context.shape_hash=Some(hash);
            return Ok(Self {geometry:RefCell::new(base.geometry.borrow().clone_for_composition()),context,
                target_id:base.target_id.clone(),target_signature:base.target_signature.clone(),catalog_hash:base.catalog_hash.clone(),
                bindings:base.bindings.clone(),instance_bindings:base.instance_bindings.clone(),error:RefCell::new(None)});
        }
        let stock=self.geometry.borrow();let mut manifest=stock.manifest.clone();
        let mut bindings=self.bindings.clone();let mut instance_bindings=self.instance_bindings.clone();
        let mut used=HashSet::new();let mut surfaces:HashMap<_,_>=manifest.surfaces.iter().map(|s|(s.key.clone(),s.clone())).collect();
        for (scene,record) in variants {
            if record.parent_stock_manifest_hash!=stock.manifest_file_hash()||record.parent_stock_catalog_hash!=self.catalog_hash
                ||scene.target_signature!=self.target_signature{return Err("composed barrel parent mismatch".into());}
            let derivative=scene.geometry.borrow();
            for change in record.mesh_changes(){
                if !used.insert(change.source_mesh_key.clone()){return Err("independent barrel variants overlap an upload".into());}
                let destination=manifest.meshes.iter_mut().find(|m|m.key==change.source_mesh_key).ok_or("composed source upload absent")?;
                let next=derivative.manifest.meshes.iter().find(|m|m.key==change.source_mesh_key).ok_or("composed derivative upload absent")?;
                *destination=next.clone();
                for range in &next.ranges {
                    let surface=derivative.manifest.surfaces.iter().find(|s|s.key==range.surface_key).ok_or("composed derivative surface absent")?;
                    surfaces.insert(surface.key.clone(),surface.clone());
                }
            }
            bindings.extend(scene.bindings.clone());
            for (key,map) in &scene.instance_bindings{instance_bindings.entry(key.clone()).or_default().extend(map.clone());}
            for key in ["unclassifiedPhysicalTriangles","degenerateCount","boundaryEdges","nonmanifoldEdges","missingBindings","ambiguousBindings"]{
                let original=stock.manifest.audits[key].as_u64().ok_or("stock composition audit missing")?;
                let delta=derivative.manifest.audits[key].as_u64().ok_or("variant composition audit missing")? as i128-original as i128;
                let next=manifest.audits[key].as_u64().ok_or("composition audit missing")? as i128+delta;
                if !(0..=u64::MAX as i128).contains(&next){return Err("composed audit overflow".into());}
                manifest.audits[key]=serde_json::json!(next as u64);
            }
        }
        let referenced:HashSet<_>=manifest.meshes.iter().flat_map(|m|m.ranges.iter().map(|r|r.surface_key.clone())).collect();
        manifest.surfaces=surfaces.into_values().filter(|s|referenced.contains(&s.key)).collect();
        manifest.surfaces.sort_by(|a,b|a.key.cmp(&b.key));
        manifest.audits["triangleCoverage"]=serde_json::json!(manifest.meshes.iter().map(|m|m.triangle_count as u64).sum::<u64>());
        let records:Vec<_>=variants.iter().map(|(_,r)|*r).collect();
        let (_,shape_hash)=barrel_composition_identity(stock.manifest_file_hash(),&records)?;
        if context.shape_hash.as_ref().is_some_and(|h|h!=&shape_hash){return Err("composed shape identity mismatch".into());}
        context.shape_hash=Some(shape_hash.clone());manifest.render_geometry_hash=shape_hash;
        let mut value=serde_json::to_value(&manifest).map_err(|e|e.to_string())?;
        value.as_object_mut().unwrap().remove("manifestHash");
        let body=serde_json::to_vec(&value).map_err(|e|e.to_string())?;
        value["manifestHash"]=serde_json::json!(sha256(&body));let bytes=serde_json::to_vec(&value).map_err(|e|e.to_string())?;
        let geometry=Geometry::register(&bytes,&sha256(&bytes),store)?;
        Ok(Self {geometry:RefCell::new(geometry),context,target_id:self.target_id.clone(),target_signature:self.target_signature.clone(),
            catalog_hash:self.catalog_hash.clone(),bindings,instance_bindings,error:RefCell::new(None)})
    }
    pub fn physical_barrel_contact(&self,contact:&Value,variant:&BarrelShapeVariantV1)->bool {
        if contact["geometryRevision"].as_u64()!=Some(self.context.geometry_revision)
            ||contact["shapeHash"].as_str().is_some_and(|h|Some(h)!=self.context.shape_hash.as_deref()) {return false;}
        let Some(triangle)=contact["triangleId"].as_u64() else{return false;};
        let geometry=self.geometry.borrow();variant.mesh_changes().iter().any(|change|{
            if contact["instanceId"]!=change.instance_id||contact["meshId"]!=change.source_mesh_key{return false;}
            let Some(mesh)=geometry.manifest.meshes.iter().find(|m|m.key==change.source_mesh_key) else{return false;};
            mesh.ranges.iter().any(|r|triangle>=r.first as u64&&triangle<(r.first+r.count) as u64
                &&change.physical_contact_source_keys.contains(&r.source_key))
        })
    }
    /// Prepared inactive scene only; the authoritative runtime validates the token first.
    pub fn transition_pose(&mut self,updates:&[(String,[f64;16])],context:QueryContext)->Result<(),String>{
        if context.entity_id!=self.context.entity_id||context.spawn_epoch!=self.context.spawn_epoch||context.build_hash!=self.context.build_hash
            ||context.pose_revision<=self.context.pose_revision||context.geometry_revision<=self.context.geometry_revision
            ||context.shape_hash!=self.context.shape_hash{return Err("stale or foreign shape transition pose".into());}
        let geometry=self.geometry.get_mut();
        if updates.len()!=geometry.manifest.mesh_instances.len(){return Err("shape transition requires complete instance pose".into());}
        geometry.refit(updates)?;self.context=context;Ok(())
    }
    /// Caller must be the accepted pose owner, never a network-supplied matrix.
    pub fn update_pose(
        &mut self,
        updates: &[(String, [f64; 16])],
        mut context: QueryContext,
    ) -> Result<(), String> {
        if context.entity_id != self.context.entity_id
            || context.spawn_epoch != self.context.spawn_epoch
            || context.build_hash != self.context.build_hash
            || context.pose_revision <= self.context.pose_revision
            || context.geometry_revision!=self.context.geometry_revision
            || context.shape_hash.as_ref().is_some_and(|h|Some(h)!=self.context.shape_hash.as_ref())
            ||(context.geometry_revision>0&&context.shape_hash.is_none())
        {
            return Err("stale or foreign accepted pose".into());
        }
        context.shape_hash=self.context.shape_hash.clone();
        self.geometry.get_mut().refit(updates)?;
        self.context = context;
        Ok(())
    }
    pub fn crossings(&self, a: Vec3, b: Vec3) -> Result<Vec<SurfaceCrossingV1>, String> {
        self.geometry
            .borrow_mut()
            .trace(
                a.to_array().map(f64::from),
                b.to_array().map(f64::from),
                &self.context,
                4096,
            )
            .map(|v| v.to_vec())
    }
    /// Finite internal travel along the admitted impact tangent, through this
    /// Query bounds guide numerical solid-angle sampling only; they never grant
    /// a collision, penetration or a cabin/gas boundary.
    pub(crate) fn sampling_ball(&self)->Option<(Vec3,f32)>{let b=self.geometry.borrow().bounds()?;let lo=Vec3::new(b.lo[0]as f32,b.lo[1]as f32,b.lo[2]as f32);let hi=Vec3::new(b.hi[0]as f32,b.hi[1]as f32,b.hi[2]as f32);Some(((lo+hi)*0.5,(hi-lo).length()*0.5))}
    /// Finite internal travel along the admitted impact tangent, through this
    /// same posed scene. A bounds exit never grants an impact or fills an aperture.
    pub fn continuation_end(&self, origin: Vec3, dir: Vec3) -> Result<Vec3, String> {
        let bounds = self
            .geometry
            .borrow()
            .bounds()
            .ok_or("empty surface scene")?;
        let a = origin.to_array().map(f64::from);
        let d = dir.normalized().to_array().map(f64::from);
        let (mut lo, mut hi) = (0f64, f64::INFINITY);
        for k in 0..3 {
            if d[k] == 0. {
                if a[k] < bounds.lo[k] || a[k] > bounds.hi[k] {
                    return Err("impact tangent outside scene extent".into());
                }
            } else {
                let x = (bounds.lo[k] - a[k]) / d[k];
                let y = (bounds.hi[k] - a[k]) / d[k];
                lo = lo.max(x.min(y));
                hi = hi.min(x.max(y));
            }
        }
        if !hi.is_finite() || hi <= 0. || hi < lo {
            return Err("invalid bounded internal extent".into());
        }
        // Conversion guard applies only to the endpoint, not any triangle edge.
        let span = hi as f32 + (hi as f32).abs().max(1.) * 2. * f32::EPSILON;
        Ok(origin + dir.normalized() * span)
    }
    pub(crate) fn exposed_anatomy(
        &self,
        at: Vec3,
        max: f32,
    ) -> Result<Vec<(EvKind, f32, SurfaceCrossingV1)>, String> {
        self.pressure_anatomy(at,max,false)
    }
    /// An initiated interior charge shares air around registered anatomy.
    /// Crew and ordinary modules are not sealed bulkheads; authored armor and
    /// unknown physical surfaces still bound every station independently.
    pub(crate) fn exposed_anatomy_inside(&self,at:Vec3,max:f32) -> Result<Vec<(EvKind,f32,SurfaceCrossingV1)>,String> {
        self.pressure_anatomy(at,max,true)
    }
    fn pressure_anatomy(&self,at:Vec3,max:f32,inside:bool) -> Result<Vec<(EvKind,f32,SurfaceCrossingV1)>,String> {
        let origin = at.to_array().map(f64::from);
        let mut nearest: HashMap<EvKind, (f64, Point)> = HashMap::new();
        let found = self
            .geometry
            .borrow()
            .visit_surface_triangles_selected(Some((origin,max as f64)),|instance, surface| {
                let kind=self.binding(instance,surface.response_ref.as_deref(),&surface.key)?.kind;
                matches!(kind,EvKind::Module(_)|EvKind::Crew(_)).then_some(kind)
            }, |_, _, kind, vertices| {
                let Some(point) = closest_triangle(origin, vertices) else {
                    return;
                };
                let delta = sub(point, origin);
                let distance2 = dot(delta, delta);
                if !distance2.is_finite() || distance2 > (max as f64).powi(2) {
                    return;
                }
                if nearest
                    .get(&kind)
                    .map_or(true, |(best, _)| distance2 < *best)
                {
                    nearest.insert(kind, (distance2, point));
                }
            });
        if let Err(e) = found {
            *self.error.borrow_mut() = Some(e.clone());
            return Err(e);
        }
        let mut candidates: Vec<_> = nearest.into_iter().collect();
        candidates.sort_by_key(|(kind, _)| match kind {
            EvKind::Module(i) => *i,
            EvKind::Crew(i) => 65536 + i,
            _ => usize::MAX,
        });
        let mut exposed = vec![];
        for (kind, (_, point)) in candidates {
            // Closest-point construction is an approximate candidate, not a
            // certified segment endpoint. Traverse through it so the exact
            // triangle predicate owns an interior contact fraction; extending
            // this finite visibility ray never changes or inflates a surface.
            let end = std::array::from_fn(|k| origin[k] + (point[k] - origin[k]) * 2.);
            let mut geometry = self.geometry.borrow_mut();
            let query = geometry.trace(origin, end, &self.context, 4096);
            let crossings = match query {
                Ok(c) => c,
                Err(e) => {
                    *self.error.borrow_mut() = Some(e.clone());
                    return Err(e);
                }
            };
            for contact in crossings {
                let Some(binding) = self.binding(&contact.instance_id, contact.response_ref.as_deref(), &contact.surface_id) else {
                    let e = "blast crossing has no registered response".to_owned();
                    *self.error.borrow_mut() = Some(e.clone());
                    return Err(e);
                };
                if matches!(binding.kind, EvKind::Decoration) {
                    continue;
                }
                if inside && binding.kind != kind && matches!(binding.kind,EvKind::Module(_)|EvKind::Crew(_)) {
                    continue;
                }
                if binding.kind == kind {
                    let delta=sub(contact.point,origin);let measured=dot(delta,delta).sqrt();
                    if measured<=max as f64 {exposed.push((kind, measured as f32, contact.clone()));}
                }
                break;
            }
        }
        Ok(exposed)
    }
    pub(crate) fn events(&self, o: Vec3, d: Vec3, max: f32, plates: bool) -> Vec<Ev> {
        let contacts = match self.crossings(o, o + d * max) {
            Ok(c) => c,
            Err(e) => {
                *self.error.borrow_mut() = Some(e);
                return vec![];
            }
        };
        struct Span {
            kind: EvKind,
            entry: SurfaceCrossingV1,
            exit: Option<SurfaceCrossingV1>,
            deferred: bool,
        }
        // Boundary nesting is scoped to one accepted instance and one authored
        // material region. Constructor pieces may overlap (O O I I); an actual
        // exit followed by another entrance (O I O I) starts a new traversal.
        let mut regions: HashMap<(String, String, EvKind), (String, usize, usize)> = HashMap::new();
        let mut spans: Vec<Span> = vec![];
        let mut targets = HashSet::new();
        let mut out: Vec<Ev> = vec![];
        for contact in contacts {
            let Some(binding) = self.binding(&contact.instance_id, contact.response_ref.as_deref(), &contact.surface_id) else {
                *self.error.borrow_mut() = Some("crossing has no registered response".into());
                return vec![];
            };
            if matches!(binding.kind, EvKind::Plate(_)) && !plates {
                continue;
            }
            if matches!(binding.kind, EvKind::Plate(_)) {
                let side = binding.side.as_deref().unwrap_or("reveal");
                if let Some(region) = binding.region.as_ref().filter(|_| side != "reveal") {
                    let key = (contact.instance_id.clone(), region.clone(), binding.kind);
                    if let Some((first_side, index, depth)) = regions.get_mut(&key) {
                        if first_side == side {
                            *depth += 1;
                        } else {
                            *depth -= 1;
                            if *depth == 0 {
                                spans[*index].exit = Some(contact);
                                regions.remove(&key);
                            }
                        }
                        continue;
                    }
                    regions.insert(key, (side.into(), spans.len(), 1));
                }
                spans.push(Span {kind:binding.kind,entry:contact,exit:None,deferred:false});
                continue;
            }
            if matches!(binding.kind, EvKind::Module(_) | EvKind::Crew(_))
                && !targets.insert(format!("{:?}", binding.kind))
            {
                continue;
            }
            out.push(Ev {
                t: (contact.t * max as f64) as f32,
                kind: binding.kind,
                contact: Some(contact),
                paired_contact: None,
                surface_transit: None,
            });
        }
        // An atomic transit must not jump over another real layer (e.g. the
        // turret front within overlapping mantlet constructor pieces). Deposit
        // each declared layer's resistance at its measured entrance; defer its
        // geometric exit/spall until that actual boundary is reached. Ordinary
        // noninterleaved walls retain the existing atomic transit.
        for i in 0..spans.len() {
            let Some(exit) = &spans[i].exit else {continue};
            let a=spans[i].entry.t;let b=exit.t;
            let interleaved=spans.iter().enumerate().any(|(j,s)| j!=i &&
                (s.entry.t>a && s.entry.t<b || s.exit.as_ref().is_some_and(|e|e.t>a && e.t<b) ||
                    s.exit.as_ref().is_some_and(|e|s.entry.t<=a && e.t>=b))) ||
                out.iter().any(|e|matches!(e.kind,EvKind::Unknown) && (e.t as f64)>a*max as f64 && (e.t as f64)<b*max as f64);
            spans[i].deferred=interleaved;
        }
        for (id,span) in spans.into_iter().enumerate() {
            let transit=SurfaceTransit {id:id as u32,deferred:span.deferred,is_exit:false};
            let exit=span.exit;
            out.push(Ev {t:(span.entry.t*max as f64)as f32,kind:span.kind,contact:Some(span.entry),
                paired_contact:if span.deferred {None}else{exit.clone()},surface_transit:Some(transit)});
            if span.deferred {
                if let Some(contact)=exit {out.push(Ev {t:(contact.t*max as f64)as f32,kind:span.kind,
                    contact:Some(contact),paired_contact:None,surface_transit:Some(SurfaceTransit{is_exit:true,..transit})});}
            }
        }
        out.sort_by(|a,b|a.t.total_cmp(&b.t).then_with(||
            b.surface_transit.is_some_and(|s|s.is_exit).cmp(&a.surface_transit.is_some_and(|s|s.is_exit))));
        out
    }
    pub(crate) fn reset_error(&self) {
        self.error.borrow_mut().take();
    }
    pub(crate) fn take_error(&self) -> Option<String> {
        self.error.borrow_mut().take()
    }
}
impl Geometry {
    fn clone_for_composition(&self)->Self {
        Self {manifest_file_hash:self.manifest_file_hash.clone(),manifest:self.manifest.clone(),instances:self.instances.clone(),
            range_surface_ordinals:self.range_surface_ordinals.clone(),
            tlas:self.tlas.clone(),stack:Vec::new(),candidates:Vec::new(),blas_stack:Vec::new(),triangles:Vec::new(),events:Vec::new(),
            occupancy_contacts:Vec::new(),query_stats:Default::default()}
    }
}
/// Shared UTF-8 identity contract. Sorting is by immutable variant hash.
pub fn barrel_composition_identity(parent:&str,variants:&[&BarrelShapeVariantV1])->Result<(String,String),String>{
    if variants.len()>8{return Err("actor barrel variant capacity".into());}
    if variants.is_empty(){return Ok(("stock".into(),parent.into()));}
    if variants.iter().any(|v|v.parent_stock_manifest_hash!=parent){return Err("barrel composition parent mismatch".into());}
    if variants.len()==1{return Ok((variants[0].shape_id.clone(),variants[0].shape_hash.clone()));}
    let mut hashes:Vec<_>=variants.iter().map(|v|v.shape_hash.as_str()).collect();hashes.sort_unstable();
    if hashes.windows(2).any(|w|w[0]==w[1]){return Err("duplicate barrel composition variant".into());}
    let hash=sha256(format!("BarrelShapeCompositionV1\0{parent}\0{}",hashes.join("\0")).as_bytes());
    Ok((format!("barrels:{hash}"),hash))
}
