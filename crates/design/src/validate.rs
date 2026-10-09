//! VehicleValidator: legality of a design. Errors keep a design out of ranked multiplayer;
//! warnings are shown in the editor. Every rule has a stable code (D###) and `refs` naming the
//! elements to highlight ("hull:face:12", "module:engine_1", "crew:crew_gunner_0", "ring", "gun").
use crate::eval::{Ctx, DesignReport};
use crate::layout::BoxKind;
use crate::mesh::{self_intersections, topology, Geo};
use crate::model::*;
use crate::v3::V3;
use serde::Serialize;
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Clone, Debug, Serialize)]
pub struct Issue {
    pub severity: Severity,
    pub code: &'static str,
    pub path: String,
    pub message: String,
    pub refs: Vec<String>,
}

struct Out(Vec<Issue>);

impl Out {
    fn err(&mut self, code: &'static str, path: impl Into<String>, message: impl Into<String>, refs: Vec<String>) {
        self.0.push(Issue { severity: Severity::Error, code, path: path.into(), message: message.into(), refs });
    }
    fn warn(&mut self, code: &'static str, path: impl Into<String>, message: impl Into<String>, refs: Vec<String>) {
        self.0.push(Issue { severity: Severity::Warning, code, path: path.into(), message: message.into(), refs });
    }
}

fn body_name(b: Body) -> &'static str {
    match b {
        Body::Hull => "車體",
        Body::Turret => "炮塔",
    }
}

fn check_mesh(o: &mut Out, m: &MeshDef, g: &Geo, body: Body, inverted_inner: bool) {
    let bn = body_name(body);
    let p = body.as_str();
    if m.vertices.iter().any(|v| !v.is_finite()) {
        o.err("D003", format!("{}_geometry", p), format!("{}有無效的頂點座標", bn), vec![]);
    }
    let t = topology(m);
    if !t.bad_faces.is_empty() {
        o.err("D003", format!("{}_geometry", p), format!("{}有 {} 個無效的面（少於三個頂點或重複頂點）", bn, t.bad_faces.len()), t.bad_faces.iter().map(|f| format!("{}:face:{}", p, f)).collect());
    }
    if !t.duplicate_ids.is_empty() {
        o.err("D003", format!("{}_geometry", p), format!("{}的面編號重複", bn), vec![]);
    }
    if !t.open_edges.is_empty() {
        let faces = faces_with_edges(m, &t.open_edges);
        o.err("D001", format!("{}_geometry", p), format!("{}網格沒有封閉：{} 條邊只連到一個面（車體必須是封閉的實體）", bn, t.open_edges.len()), faces.iter().map(|f| format!("{}:face:{}", p, f)).collect());
    }
    if !t.repeated_edges.is_empty() {
        let faces = faces_with_edges(m, &t.repeated_edges);
        o.err("D001", format!("{}_geometry", p), format!("{}網格方向不一致或非流形：{} 條邊被多個面以同方向使用", bn, t.repeated_edges.len()), faces.iter().map(|f| format!("{}:face:{}", p, f)).collect());
    }
    let (vol, _) = g.volume();
    if t.closed() && vol <= 1e-6 {
        o.err("D003", format!("{}_geometry", p), format!("{}體積為零或內外翻轉", bn), vec![]);
    }
    for f in &g.faces {
        if f.area < 1e-5 {
            o.err("D003", format!("{}:face:{}", p, f.id), format!("{}第 {} 面面積為零", bn, f.id), vec![format!("{}:face:{}", p, f.id)]);
        }
        if f.planarity > 0.02 {
            o.warn("D004", format!("{}:face:{}", p, f.id), format!("{}第 {} 面不在同一平面（偏差 {:.0} mm），以折板計算", bn, f.id, f.planarity * 1000.0), vec![format!("{}:face:{}", p, f.id)]);
        }
    }
    if t.closed() {
        let si = self_intersections(g, 24);
        if !si.is_empty() {
            let mut refs = vec![];
            for (a, b) in &si {
                refs.push(format!("{}:face:{}", p, a));
                refs.push(format!("{}:face:{}", p, b));
            }
            o.err("D002", format!("{}_geometry", p), format!("{}網格自我相交（{} 對面互相穿過）", bn, si.len()), refs);
        }
    }
    if inverted_inner {
        o.err("D013", format!("{}_geometry", p), format!("{}裝甲太厚：內壁互相重疊，車內已沒有空間", bn), vec![]);
    }
}

fn faces_with_edges(m: &MeshDef, edges: &[(usize, usize)]) -> Vec<u32> {
    let set: HashSet<(usize, usize)> = edges.iter().copied().collect();
    let mut out = vec![];
    for f in &m.faces {
        let n = f.v.len();
        if (0..n).any(|k| set.contains(&(f.v[k] as usize, f.v[(k + 1) % n] as usize))) {
            out.push(f.id);
        }
    }
    out
}

pub(crate) fn validate(ctx: &Ctx, r: &DesignReport) -> Vec<Issue> {
    let m = &ctx.model;
    let d = m.d;
    let db = m.db;
    let cat = &db.catalog;
    let mut o = Out(vec![]);

    // ---- identity
    if d.schema != SCHEMA {
        o.err("D095", "schema", format!("schema 必須是 {}", SCHEMA), vec![]);
    }
    if d.id.is_empty() || d.id.len() > 40 || !d.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
        o.err("D095", "id", "id 只能用小寫英文、數字與底線（1–40 字）", vec![]);
    }
    if d.name.trim().is_empty() || d.name.chars().count() > 60 {
        o.err("D095", "name", "名稱必須有 1–60 個字", vec![]);
    }

    // ---- geometry
    check_mesh(&mut o, &d.hull_geometry, &m.hull, Body::Hull, ctx.hull_inverted);
    let hs = r.dimensions.hull.clone();
    if !(2.0..=14.0).contains(&hs.length_m) || !(1.0..=5.0).contains(&hs.width_m) || !(0.5..=4.0).contains(&hs.height_m) {
        o.err("D005", "hull_geometry", format!("車體尺寸超出範圍（長 {:.2} m、寬 {:.2} m、高 {:.2} m；允許長 2–14、寬 1–5、高 0.5–4 m）", hs.length_m, hs.width_m, hs.height_m), vec![]);
    }
    match (&d.turret_geometry, &d.turret_ring) {
        (Some(t), Some(_)) => {
            if let Some(g) = &m.turret {
                check_mesh(&mut o, t, g, Body::Turret, ctx.turret_inverted);
            }
        }
        (Some(_), None) => o.err("D027", "turret_ring", "有炮塔但沒有炮塔環", vec!["ring".into()]),
        (None, Some(_)) => o.err("D027", "turret_geometry", "有炮塔環但沒有炮塔", vec!["ring".into()]),
        (None, None) => o.err("D027", "turret_geometry", "這個版本的對戰需要炮塔與主炮", vec![]),
    }

    // ---- armour
    let mut armored: HashSet<(Body, u32)> = HashSet::new();
    for a in &d.armor_faces {
        let path = format!("armor_faces[{}:{}]", a.body.as_str(), a.face);
        let refs = vec![format!("{}:face:{}", a.body.as_str(), a.face)];
        let exists = m.geo(a.body).map(|g| g.face(a.face).is_some()).unwrap_or(false);
        if !exists {
            o.warn("D014", &path, format!("{}第 {} 面已不存在，這筆裝甲設定會被忽略", body_name(a.body), a.face), vec![]);
            continue;
        }
        if !armored.insert((a.body, a.face)) {
            o.err("D014", &path, "同一面有兩筆裝甲設定", refs.clone());
        }
        if db.materials.get(&a.material).is_none() {
            o.err("D011", &path, format!("未知的裝甲材料「{}」", a.material), refs.clone());
        }
        let mut values = vec![a.thickness_mm];
        if let Some(v) = &a.vertex_mm {
            let n = m.geo(a.body).and_then(|g| g.face(a.face)).map(|f| f.idx.len()).unwrap_or(0);
            if v.len() != n {
                o.err("D015", &path, format!("頂點厚度數量（{}）與該面頂點數（{}）不符", v.len(), n), refs.clone());
            }
            values.extend(v.iter().copied());
        }
        if let Some(mp) = &a.map {
            if mp.nu == 0 || mp.nv == 0 || mp.nu > 16 || mp.nv > 16 || mp.values_mm.len() != (mp.nu * mp.nv) as usize {
                o.err("D015", &path, "厚度圖的格數與數值數量不符（每邊 1–16 格）", refs.clone());
            }
            values.extend(mp.values_mm.iter().copied());
        }
        if values.iter().any(|t| !t.is_finite() || *t <= 0.0) {
            o.err("D010", &path, "裝甲厚度必須大於 0（不允許負厚度）", refs.clone());
        }
        if values.iter().any(|t| *t > cat.max_armor_mm) {
            o.err("D010", &path, format!("裝甲厚度超過上限 {:.0} mm", cat.max_armor_mm), refs.clone());
        }
    }
    for s in &d.armor_layers {
        let path = format!("armor_layers[{}:{}]", s.body.as_str(), s.face);
        let refs = vec![format!("{}:face:{}", s.body.as_str(), s.face)];
        for l in &s.layers {
            if db.materials.get(&l.material).is_none() {
                o.err("D011", &path, format!("未知的裝甲材料「{}」", l.material), refs.clone());
            }
            if !l.thickness_mm.is_finite() || l.thickness_mm <= 0.0 || l.thickness_mm > cat.max_armor_mm {
                o.err("D010", &path, "疊層厚度必須在 0 與上限之間", refs.clone());
            }
            if l.spacing_mm < 0.0 || l.spacing_mm > 1500.0 {
                o.err("D015", &path, "層間空隙必須在 0–1500 mm", refs.clone());
            }
            if l.angle_deg.abs() > 75.0 {
                o.err("D015", &path, "疊層傾角不可超過 ±75°", refs.clone());
            }
        }
    }
    for (body, g) in [(Body::Hull, Some(&m.hull)), (Body::Turret, m.turret.as_ref())] {
        let Some(g) = g else { continue };
        let missing: Vec<u32> = g.faces.iter().filter(|f| !armored.contains(&(body, f.id))).map(|f| f.id).collect();
        if !missing.is_empty() {
            o.err("D012", format!("{}_geometry", body.as_str()), format!("{}有 {} 個面沒有設定裝甲", body_name(body), missing.len()), missing.iter().map(|f| format!("{}:face:{}", body.as_str(), f)).collect());
        }
    }
    for a in &d.addons {
        let path = format!("addons[{}]", a.id);
        let refs = vec![format!("addon:{}", a.id)];
        if db.materials.get(&a.material).is_none() {
            o.err("D011", &path, format!("未知的裝甲材料「{}」", a.material), refs.clone());
        }
        if a.size_m[0] <= 0.0 || a.size_m[1] <= 0.0 || a.size_m[0] > 8.0 || a.size_m[1] > 4.0 || a.thickness_mm <= 0.0 || a.thickness_mm > cat.max_armor_mm || a.standoff_mm < 0.0 || a.standoff_mm > 1000.0 {
            o.err("D016", &path, "附加裝甲的尺寸、厚度或間距超出範圍", refs.clone());
        }
        if a.normal.len() < 0.5 || a.u_axis.cross(a.normal).len() < 0.1 {
            o.err("D016", &path, "附加裝甲方向無效", refs.clone());
        }
        if let Some(g) = m.geo(a.body) {
            let p = m.to_hull(a.body, a.anchor_m, 0.0);
            let dist = (0..g.faces.len()).map(|fi| g.face_distance(fi, p).0).fold(f64::INFINITY, f64::min);
            if dist > 0.15 {
                o.warn("D016", &path, format!("附加裝甲離{}表面 {:.2} m，沒有固定點", body_name(a.body), dist), refs.clone());
            }
        }
    }

    // ---- turret ring & turret
    if let (Some(rd), Some(t)) = (&d.turret_ring, &r.turret) {
        let axis = rd.rotation_axis.norm();
        if (axis - V3::Y).len() > 0.01 {
            o.err("D024", "turret_ring.rotation_axis", "炮塔旋轉軸必須垂直（0, 1, 0）", vec!["ring".into()]);
        }
        if rd.diameter_m < 0.6 || rd.diameter_m > 3.5 {
            o.err("D020", "turret_ring.diameter_m", "炮塔環直徑必須在 0.6–3.5 m", vec!["ring".into()]);
        }
        if t.ring_outside_points > 0 {
            o.err("D020", "turret_ring", format!("炮塔環超出車體或沒有落在車頂上（{} / 24 個取樣點在車體外）", t.ring_outside_points), vec!["ring".into()]);
        }
        if t.ring_buried_points > 0 {
            o.err("D021", "turret_ring", format!("炮塔環陷在車體裡（{} / 24 個取樣點上方仍是車體），炮塔環必須在車頂面上", t.ring_buried_points), vec!["ring".into()]);
        }
        if !t.ring_covered && m.turret.is_some() {
            o.err("D022", "turret_geometry", "炮塔底部沒有完全蓋住炮塔環", vec!["ring".into(), "turret".into()]);
        }
        if !t.sweep.blocked_yaws.is_empty() {
            o.err("D023", "turret_geometry", format!("炮塔轉動時會撞到車體（{} 個方向受阻，例如 {:.0}°）", t.sweep.blocked_yaws.len(), t.sweep.blocked_yaws[0]), vec!["turret".into()]);
        }
        if t.overhang_ratio > cat.turret_ring.max_overhang {
            o.warn("D025", "turret_geometry", format!("炮塔相對炮塔環過大（長度 / 座圈 = {:.2}，建議 ≤ {:.1}）", t.overhang_ratio, cat.turret_ring.max_overhang), vec!["turret".into(), "ring".into()]);
        }
        if t.wider_than_hull_m > 0.3 {
            o.warn("D025", "turret_geometry", format!("炮塔比車體寬出 {:.2} m", t.wider_than_hull_m), vec!["turret".into()]);
        }
        if t.mass_kg > t.ring_capacity_kg * 1.3 {
            o.err("D026", "turret_ring", format!("炮塔 {:.1} t 超過炮塔環承載 {:.1} t 的 130%", t.mass_kg / 1000.0, t.ring_capacity_kg / 1000.0), vec!["ring".into()]);
        } else if t.mass_kg > t.ring_capacity_kg {
            o.warn("D026", "turret_ring", format!("炮塔 {:.1} t 超過炮塔環額定 {:.1} t，迴轉變慢", t.mass_kg / 1000.0, t.ring_capacity_kg / 1000.0), vec!["ring".into()]);
        }
        if !["manual", "electric", "hydraulic"].contains(&rd.drive.as_str()) {
            o.err("D024", "turret_ring.drive", "炮塔驅動必須是 manual / electric / hydraulic", vec!["ring".into()]);
        }
    }

    // ---- gun
    match (&d.weapons, &d.gun_mount, &r.gun) {
        (Some(w), Some(gm), Some(g)) => {
            if !(20.0..=203.0).contains(&w.caliber_mm) || !(12.0..=80.0).contains(&w.length_cal) {
                o.err("D038", "weapons", "口徑必須在 20–203 mm、倍徑 12–80", vec!["gun".into()]);
            }
            match cat.stabilizers.get(&w.stabilizer) {
                None => o.err("D039", "weapons.stabilizer", "穩定器必須是 none / vertical / two_plane", vec!["gun".into()]),
                Some(sc) if sc.powered_traverse && d.turret_ring.as_ref().map(|r| r.drive == "manual").unwrap_or(true) => {
                    o.err("D039", "weapons.stabilizer", format!("{}需要電動或液壓炮塔驅動", sc.label), vec!["gun".into(), "ring".into()])
                }
                _ => {}
            }
            let ax = gm.elevation_axis.norm();
            if (ax - V3::X).len() > 0.01 && (ax + V3::X).len() > 0.01 {
                o.err("D037", "gun_mount.elevation_axis", "俯仰軸必須是水平橫軸（1, 0, 0）", vec!["gun".into()]);
            }
            if let Some(tl) = &m.turret_local {
                if !tl.contains(gm.position_m) {
                    o.err("D037", "gun_mount.position_m", "炮耳軸不在炮塔內", vec!["gun".into()]);
                }
            }
            if gm.min_elevation_deg > 0.0 || gm.min_elevation_deg < -25.0 || gm.max_elevation_deg < 0.0 || gm.max_elevation_deg > 85.0 {
                o.err("D037", "gun_mount", "俯角需在 0 至 −25°、仰角在 0 至 85° 之間", vec!["gun".into()]);
            }
            if g.recoil_m < g.recoil_default_m * cat.gun.min_recoil_fraction {
                o.err("D035", "gun_mount.recoil_distance_m", format!("後座行程 {:.0} mm 太短（這門炮至少要 {:.0} mm，炮架無法吸收後座力）", g.recoil_m * 1000.0, g.recoil_default_m * cat.gun.min_recoil_fraction * 1000.0), vec!["gun".into()]);
            }
            let c = &g.clearance;
            if !c.breech_fits {
                o.err("D030", "gun_mount", format!("炮閂放不進炮塔（{}）：火炮無法安裝", reason(c.elevation_limited_by.as_deref())), vec!["gun".into(), "turret".into()]);
            } else if !c.recoil_fits {
                o.err("D031", "gun_mount.recoil_distance_m", format!("後座空間不足：炮閂後退 {:.0} mm 會撞到炮塔（{}），火炮不能正常安裝", g.recoil_m * 1000.0, reason(c.elevation_limited_by.as_deref())), vec!["gun".into(), "turret".into()]);
            } else {
                if c.max_elevation_deg + 0.01 < c.requested_max_elevation_deg {
                    o.warn("D032", "gun_mount.max_elevation_deg", format!("仰角受限：{:.1}°（要求 {:.0}°；{}）", c.max_elevation_deg, c.requested_max_elevation_deg, reason(c.elevation_limited_by.as_deref())), vec!["gun".into()]);
                }
                if c.max_depression_deg + 0.01 < c.requested_max_depression_deg {
                    o.warn("D033", "gun_mount.min_elevation_deg", format!("俯角受限：−{:.1}°（要求 −{:.0}°；{}）", c.max_depression_deg, c.requested_max_depression_deg, reason(c.depression_limited_by.as_deref())), vec!["gun".into()]);
                }
                if c.frontal_depression_deg + 0.01 < c.max_depression_deg {
                    o.warn("D033", "gun_mount", format!("炮管向前俯下時碰到車體：正面俯角只有 −{:.1}°", c.frontal_depression_deg), vec!["gun".into(), "hull".into()]);
                }
            }
            if !c.barrel_blocked_yaws.is_empty() {
                o.warn("D036", "gun_mount", format!("炮管水平時在 {} 個方向會撞到車體（例如 {:.0}°）", c.barrel_blocked_yaws.len(), c.barrel_blocked_yaws[0]), vec!["gun".into()]);
            }
            for id in &r.interior.breech_hits {
                o.err("D034", "gun_mount", format!("炮閂（含後座與俯仰範圍）撞到 {}", label_of(id)), vec!["gun".into(), box_ref(m, id)]);
            }
            if gm.mantlet.thickness_mm <= 0.0 || gm.mantlet.width_m <= 0.0 || gm.mantlet.height_m <= 0.0 || db.materials.get(&gm.mantlet.material).is_none() {
                o.err("D017", "gun_mount.mantlet", "炮盾尺寸、厚度或材料無效", vec!["gun".into()]);
            }
        }
        _ => o.err("D038", "weapons", "沒有主炮或火炮安裝位置", vec![]),
    }

    // ---- interior
    for b in &r.interior.boxes {
        if b.kind == "gun_breech" {
            continue;
        }
        let rf = box_ref(m, &b.id);
        if !b.inside {
            if b.crew {
                o.err("D042", format!("crew[{}]", b.id), format!("{}不在車內（{} 個取樣點在裝甲外或在裝甲內）", label_of(&b.id), b.outside_points), vec![rf.clone()]);
            } else {
                o.err("D040", format!("internal_modules[{}]", b.id), format!("{}穿出裝甲（{} 個取樣點不在車內空間）", label_of(&b.id), b.outside_points), vec![rf.clone()]);
            }
        }
    }
    for (a, b) in &r.interior.collisions {
        let crew = a.starts_with("crew_") || b.starts_with("crew_");
        o.err(if crew { "D043" } else { "D041" }, "internal_modules", format!("{}與{}重疊", label_of(a), label_of(b)), vec![box_ref(m, a), box_ref(m, b)]);
    }
    for (a, b) in &r.interior.sweep_hits {
        o.err("D046", "internal_modules", format!("炮塔轉動時{}會掃到{}", label_of(a), label_of(b)), vec![box_ref(m, a), box_ref(m, b)]);
    }
    let roles: Vec<CrewRoleDef> = d.crew_positions.iter().map(|c| c.role).collect();
    for (role, required) in [(CrewRoleDef::Driver, true), (CrewRoleDef::Gunner, true), (CrewRoleDef::Commander, false), (CrewRoleDef::Loader, false)] {
        if !roles.contains(&role) {
            let msg = format!("沒有{}", crew_label(role.as_str()));
            if required {
                o.err("D044", "crew_positions", msg, vec![]);
            } else {
                o.warn("D044", "crew_positions", format!("{}（{}）", msg, if role == CrewRoleDef::Loader { "由炮手兼任，裝填 ×1.6" } else { "偵察能力減半" }), vec![]);
            }
        }
    }
    for c in &d.crew_positions {
        if c.role == CrewRoleDef::Driver && c.mount != Body::Hull {
            o.warn("D048", "crew_positions", "駕駛應坐在車體內", vec![]);
        }
    }
    let count = |k: ModuleKindDef| d.internal_modules.iter().filter(|m| m.kind == k).count();
    for (k, label) in [(ModuleKindDef::Engine, "引擎"), (ModuleKindDef::Transmission, "傳動"), (ModuleKindDef::FuelTank, "油箱"), (ModuleKindDef::AmmoRack, "彈藥架")] {
        if count(k) == 0 {
            o.err("D045", "internal_modules", format!("沒有{}", label), vec![]);
        }
    }
    for (k, label) in [(ModuleKindDef::Engine, "引擎"), (ModuleKindDef::Transmission, "傳動")] {
        if count(k) > 1 {
            o.err("D047", "internal_modules", format!("只能有一具{}", label), vec![]);
        }
    }
    if count(ModuleKindDef::Radio) == 0 {
        o.warn("D045", "internal_modules", "沒有無線電", vec![]);
    }
    let mut ids = HashSet::new();
    for mdl in &d.internal_modules {
        if !ids.insert(&mdl.id) {
            o.err("D047", "internal_modules", format!("模組 id「{}」重複", mdl.id), vec![]);
        }
        if mdl.kind.sized_by_player() {
            let s = mdl.size_m.unwrap_or(V3::ZERO);
            if s.x < 0.1 || s.y < 0.1 || s.z < 0.1 || s.x > 3.0 || s.y > 2.0 || s.z > 4.0 {
                o.err("D040", format!("internal_modules[{}]", mdl.id), "油箱 / 彈藥架尺寸必須在 0.1–3 m 之間", vec![box_ref(m, &mdl.id)]);
            }
        }
    }
    if r.volumes.free_m3 < 0.0 {
        o.err("D049", "internal_modules", format!("內部空間不足：設備與乘員比車內空間多 {:.2} m³", -r.volumes.free_m3), vec![]);
    }

    // ---- running gear
    let s = &d.suspension;
    let g = &r.running_gear;
    let sc = cat.suspensions.get(&s.kind);
    if sc.is_none() {
        o.err("D057", "suspension.kind", format!("未知的懸掛「{}」", s.kind), vec![]);
    }
    if s.stations < 2 || s.stations > 12 {
        o.err("D053", "suspension.stations", "每側負重輪 2–12 組", vec![]);
    }
    if !(0.25..=1.3).contains(&s.wheel_diameter_m) {
        o.err("D053", "suspension.wheel_diameter_m", "負重輪直徑必須在 0.25–1.3 m", vec![]);
    }
    if s.front_z_m <= s.rear_z_m {
        o.err("D053", "suspension", "第一組負重輪必須在最後一組之前", vec![]);
    }
    if !["front", "rear"].contains(&s.sprocket.as_str()) {
        o.err("D053", "suspension.sprocket", "主動輪位置必須是 front 或 rear", vec![]);
    }
    if d.tracks.width_m < cat.tracks.min_width_m || d.tracks.width_m > cat.tracks.max_width_m {
        o.err("D053", "tracks.width_m", format!("履帶寬度必須在 {:.2}–{:.2} m", cat.tracks.min_width_m, cat.tracks.max_width_m), vec![]);
    }
    if g.hull_clash_points > 0 {
        o.err("D050", "tracks", format!("履帶與車體互相穿過（{} 個取樣點）：把履帶外移或縮窄下車體", g.hull_clash_points), vec!["tracks".into()]);
    } else if g.gap_to_hull_m > 0.35 {
        o.warn("D051", "tracks", format!("履帶離車體 {:.2} m，懸掛臂太長", g.gap_to_hull_m), vec!["tracks".into()]);
    }
    let gc = r.dimensions.ground_clearance_m;
    if gc < 0.2 {
        o.err("D052", "hull_geometry", format!("離地間隙只有 {:.2} m：車底會拖地（至少 0.2 m）", gc), vec!["hull".into()]);
    } else if gc < 0.3 {
        o.warn("D052", "hull_geometry", format!("離地間隙 {:.2} m 偏低，越野時容易卡住", gc), vec!["hull".into()]);
    }
    if gc > 2.0 * s.wheel_diameter_m + 0.4 {
        o.err("D052", "hull_geometry", "車體離地太高，懸掛搆不到車體", vec!["hull".into()]);
    }
    if hs.length_m > 0.0 && g.contact_length_m < 0.4 * hs.length_m {
        o.warn("D053", "suspension", format!("履帶接地長度 {:.2} m 不到車長的 40%", g.contact_length_m), vec!["tracks".into()]);
    }
    let lb = r.mobility.length_to_gauge;
    if lb > 0.0 && !(0.9..=2.2).contains(&lb) {
        o.warn("D054", "tracks", format!("接地長度 / 履帶中心距 = {:.2}（0.9–2.2 之外轉向會很差或很不穩）", lb), vec!["tracks".into()]);
    }
    if !hs.min.z.is_nan() && (s.front_z_m > hs.max.z + 0.5 || s.rear_z_m < hs.min.z - 0.5) {
        o.warn("D055", "suspension", "負重輪超出車體前後太多", vec!["tracks".into()]);
    }

    // ---- loads
    let sus = &r.suspension;
    if sus.lifted {
        o.err("D061", "suspension", "重心在負重輪範圍外：有負重輪被抬離地面（車會翻）", vec!["com".into()]);
    }
    if sus.max_ratio > 1.3 {
        o.err("D060", "suspension", format!("懸掛嚴重超載：最重的負重輪承受 {:.0}% 額定負荷", sus.max_ratio * 100.0), vec!["tracks".into()]);
    } else if sus.max_ratio > 1.0 {
        o.warn("D060", "suspension", format!("懸掛超載 {:.0}%：行程縮短、越野與轉向變差", sus.max_ratio * 100.0), vec!["tracks".into()]);
    }
    if sus.front.rating_kn > 0.0 && sus.rear.rating_kn > 0.0 && (sus.front.ratio - sus.rear.ratio).abs() > 0.25 {
        o.warn("D063", "suspension", format!("前後負重不均（前 {:.0}%，後 {:.0}%）", sus.front.ratio * 100.0, sus.rear.ratio * 100.0), vec!["com".into()]);
    }
    let gp = r.mobility.ground_pressure_kpa;
    if gp > 220.0 {
        o.err("D062", "tracks", format!("接地壓力 {:.0} kPa：在軟地上會完全陷住", gp), vec!["tracks".into()]);
    } else if gp > 140.0 {
        o.warn("D062", "tracks", format!("接地壓力 {:.0} kPa 偏高，軟地很吃力", gp), vec!["tracks".into()]);
    }

    // ---- power
    let ec = cat.engines.get(&d.engine.kind);
    if ec.is_none() {
        o.err("D070", "engine.kind", format!("未知的引擎「{}」", d.engine.kind), vec![]);
    }
    if cat.transmissions.get(&d.transmission.kind).is_none() {
        o.err("D070", "transmission.kind", format!("未知的變速箱「{}」", d.transmission.kind), vec![]);
    }
    if cat.steering.get(&d.transmission.steering).is_none() {
        o.err("D070", "transmission.steering", format!("未知的轉向機構「{}」", d.transmission.steering), vec![]);
    }
    if let Some(ec) = ec {
        if d.engine.power_hp < ec.min_hp || d.engine.power_hp > ec.max_hp {
            o.err("D071", "engine.power_hp", format!("{}馬力必須在 {:.0}–{:.0} hp", ec.label, ec.min_hp, ec.max_hp), vec![]);
        }
    }
    if !(2..=12).contains(&d.transmission.forward_gears) {
        o.err("D074", "transmission.forward_gears", "前進檔 2–12 個", vec![]);
    }
    if !(10.0..=110.0).contains(&d.transmission.gearing_kmh) {
        o.warn("D074", "transmission.gearing_kmh", "齒比設定的極速應在 10–110 km/h", vec![]);
    }
    let pw = r.mobility.power_to_weight_hp_t;
    if pw > 0.0 && pw < 5.0 {
        o.err("D072", "engine.power_hp", format!("功重比只有 {:.1} hp/t：引擎帶不動這台車", pw), vec![]);
    } else if pw > 0.0 && pw < 8.0 {
        o.warn("D072", "engine.power_hp", format!("功重比 {:.1} hp/t 偏低", pw), vec![]);
    }
    let mob = &r.mobility;
    if mob.top_speed_road_kmh > 0.0 && mob.top_speed_road_kmh < 10.0 {
        o.err("D075", "engine", format!("公路極速只有 {:.1} km/h：引擎無法帶動車輛", mob.top_speed_road_kmh), vec![]);
    }
    if mob.top_speed_road_kmh > 0.0 && mob.max_climb_deg < 8.0 {
        o.warn("D073", "transmission", format!("只能爬 {:.0}° 的坡", mob.max_climb_deg), vec![]);
    }
    if mob.fuel_l > 0.0 && mob.range_road_km < 60.0 {
        o.warn("D085", "internal_modules", format!("公路續航只有 {:.0} km", mob.range_road_km), vec![]);
    }

    // ---- ammunition
    let am = &r.ammunition;
    for k in &am.invalid_kinds {
        o.err("D081", "ammunition", format!("這門炮不能用「{}」彈", k), vec![]);
    }
    if am.rounds == 0 {
        o.err("D082", "ammunition", "沒有配置炮彈", vec![]);
    }
    if am.rounds > am.capacity {
        o.err("D080", "ammunition", format!("炮彈 {} 發超過彈藥架容量 {} 發", am.rounds, am.capacity), vec![]);
    }

    // ---- mass
    let t = r.mass.total_kg / 1000.0;
    if t > 200.0 {
        o.err("D090", "mass", format!("全重 {:.0} t 超過 200 t", t), vec![]);
    } else if t > 120.0 {
        o.warn("D090", "mass", format!("全重 {:.0} t，大多數橋樑過不去", t), vec![]);
    }

    let _ = BoxKind::Breech;
    o.0
}

fn reason(r: Option<&str>) -> &'static str {
    match r {
        Some("breech_floor") => "炮閂撞到車底 / 炮塔籃",
        Some("breech_ring") => "炮閂撞到炮塔環",
        Some("breech_roof") => "炮閂撞到炮塔頂",
        Some("recoil_rear_wall") => "後座時撞到炮塔後壁",
        Some("breech_wall") => "炮閂撞到炮塔側壁",
        Some("barrel_hull") => "炮管撞到車體",
        _ => "空間不足",
    }
}

pub fn crew_label(role: &str) -> &'static str {
    match role {
        "commander" => "車長",
        "gunner" => "炮手",
        "loader" => "裝填手",
        "driver" => "駕駛",
        "radio_operator" => "無線電手",
        _ => "乘員",
    }
}

fn module_label(kind: &str) -> &'static str {
    match kind {
        "engine" => "引擎",
        "transmission" => "傳動",
        "fuel_tank" => "油箱",
        "ammo_rack" => "彈藥架",
        "radio" => "無線電",
        "turret_drive" => "炮塔驅動",
        "gun_breech" => "炮閂",
        _ => "模組",
    }
}

/// Human label for a box id ("crew_gunner_0" -> 炮手, "engine" -> 引擎（engine）).
pub fn label_of(id: &str) -> String {
    if let Some(rest) = id.strip_prefix("crew_") {
        let role = rest.rsplit_once('_').map(|(r, _)| r).unwrap_or(rest);
        return crew_label(role).to_string();
    }
    let base = id.trim_end_matches("（迴轉）");
    if base == "gun_breech" {
        return "炮閂".into();
    }
    format!("「{}」", base)
}

fn box_ref(m: &crate::layout::Model, id: &str) -> String {
    if id.starts_with("crew_") {
        return format!("crew:{}", id);
    }
    if id == "gun_breech" {
        return "gun".into();
    }
    let kind = m.boxes.iter().find(|b| b.id == id).map(|b| b.kind.label()).unwrap_or("module");
    let _ = module_label(kind);
    format!("module:{}", id)
}
