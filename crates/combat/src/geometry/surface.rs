use super::{
    manifest::{MeshData, Surface, Topology, TriangleRange},
    ray::{cross, dot, sub, Contact, Point},
};
use serde::{Deserialize, Serialize};
#[cfg(test)]
mod shape_context_tests {
    use super::QueryContext;
    #[test]
    fn legacy_pose_context_defaults_to_stock_geometry_revision() {
        let context: QueryContext = serde_json::from_value(serde_json::json!({
            "entityId":"barrel-actor", "spawnEpoch":1, "buildHash":"b".repeat(64), "poseRevision":3
        })).unwrap();
        let serialized=serde_json::to_value(context).unwrap();
        assert_eq!(serialized["geometryRevision"],0);
        assert!(serialized["shapeHash"].is_null());
    }
    #[test]
    fn accepted_shape_context_retains_independent_geometry_and_pose_revisions() {
        let raw=serde_json::json!({"entityId":"barrel-actor", "spawnEpoch":1,
            "buildHash":"b".repeat(64), "poseRevision":17, "geometryRevision":2, "shapeHash":"c".repeat(64)});
        let context: QueryContext=serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(serde_json::to_value(context).unwrap(),raw);
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueryContext {
    pub entity_id: String,
    pub spawn_epoch: u64,
    pub build_hash: String,
    pub pose_revision: u64,
    #[serde(default)]
    pub geometry_revision: u64,
    #[serde(default)]
    pub shape_hash: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceCrossingV1 {
    pub schema: &'static str,
    pub entity_id: String,
    pub spawn_epoch: u64,
    pub build_hash: String,
    pub pose_revision: u64,
    pub geometry_revision: u64,
    pub shape_hash: Option<String>,
    pub assembly_id: String,
    pub instance_id: String,
    pub mesh_id: String,
    pub triangle_id: u32,
    pub source_triangle_key: String,
    pub solid_id: Option<String>,
    pub binding_id: Option<String>,
    pub surface_id: String,
    pub t: f64,
    pub point: Point,
    pub barycentric: Point,
    pub geometric_normal: Point,
    pub facing_normal: Point,
    pub crossing: &'static str,
    pub physical_role: String,
    pub response_ref: Option<String>,
    pub topology_pending: bool,
}
impl SurfaceCrossingV1 {
    pub fn contact(
        ctx: &QueryContext,
        assembly: &str,
        instance: &str,
        mesh: &str,
        triangle: u32,
        r: &TriangleRange,
        s: &Surface,
        c: Contact,
        v: [Point; 3],
        a: Point,
        b: Point,
        orientation: f64,
    ) -> Self {
        let n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
        let length = dot(n, n).sqrt();
        let n = n.map(|v| v / length);
        let den = dot(n, sub(b, a));
        // Mirroring flips emitted world winding, while a certified local solid's occupancy does not.
        let physical_den = den * orientation;
        let kind =
            if c.coplanar || matches!(s.topology, Topology::AuditPending | Topology::ClosedSolid) {
                "touch"
            } else {
                match s.topology {
                    Topology::OpenSheet | Topology::DecorativeSurface => "sheet",
                    _ => {
                        if physical_den < 0.0 {
                            "enter"
                        } else if physical_den > 0.0 {
                            "exit"
                        } else {
                            "touch"
                        }
                    }
                }
            };
        Self {
            schema: "SurfaceCrossingV1",
            entity_id: ctx.entity_id.clone(),
            spawn_epoch: ctx.spawn_epoch,
            build_hash: ctx.build_hash.clone(),
            pose_revision: ctx.pose_revision,
            geometry_revision: ctx.geometry_revision,
            shape_hash: ctx.shape_hash.clone(),
            assembly_id: assembly.into(),
            instance_id: instance.into(),
            mesh_id: mesh.into(),
            triangle_id: triangle,
            source_triangle_key: format!(
                "{}:triangle:{}",
                r.source_key,
                r.source_triangle_first + (triangle - r.first)
            ),
            solid_id: r.solid_key.clone(),
            binding_id: r.binding_key.clone(),
            surface_id: s.key.clone(),
            t: c.t,
            point: super::ray::point_at(a, b, c.t),
            barycentric: c.barycentric,
            geometric_normal: n,
            facing_normal: if den > 0.0 { n.map(|v| -v) } else { n },
            crossing: kind,
            physical_role: s.role.clone(),
            response_ref: s.response_ref.clone(),
            topology_pending: s.topology == Topology::AuditPending,
        }
    }
}

// This is a numerical predicate error bound, never a displacement/inflation of geometry.
fn determinant(a: Point, b: Point, c: Point) -> (f64, f64) {
    let value = dot(a, cross(b, c));
    let magnitude = (a[0] * b[1] * c[2]).abs()
        + (a[0] * b[2] * c[1]).abs()
        + (a[1] * b[2] * c[0]).abs()
        + (a[1] * b[0] * c[2]).abs()
        + (a[2] * b[0] * c[1]).abs()
        + (a[2] * b[1] * c[0]).abs();
    (
        value,
        magnitude * 64.0 * f64::EPSILON + f64::from_bits(1) * 64.0,
    )
}
fn strict_crossing(a: Point, b: Point, v: [Point; 3]) -> Result<Option<i64>, ()> {
    let mut q = [sub(v[1], v[0]), sub(v[2], v[0]), sub(b, a), sub(a, v[0])];
    let scale = q.iter().flatten().map(|v| v.abs()).fold(0.0, f64::max);
    if !scale.is_finite() || scale == 0.0 {
        return Err(());
    }
    for p in &mut q {
        for component in p {
            let original = *component;
            *component /= scale;
            if original != 0.0 && *component == 0.0 {
                return Err(());
            }
        }
    }
    let [e1, e2, d, p] = q;
    let (det, de) = determinant(e1, d, e2);
    if det.abs() <= de {
        let (at, ae) = determinant(e1, e2, p);
        let (end, ee) = determinant(e1, e2, [p[0] + d[0], p[1] + d[1], p[2] + d[2]]);
        if (at > ae && end > ee) || (at < -ae && end < -ee) {
            return Ok(None);
        }
        return Err(());
    }
    let sign = det.signum();
    let det = det.abs();
    let (u, ue) = determinant(p, d, e2);
    let u = u * sign;
    let (w, we) = determinant(d, p, e1);
    let w = w * sign;
    let (t, te) = determinant(e2, p, e1);
    let t = t * sign;
    let remaining = det - u - w;
    let re = de + ue + we + (det + u.abs() + w.abs()) * 8.0 * f64::EPSILON;
    let end = det - t;
    let ee = de + te + (det + t.abs()) * 8.0 * f64::EPSILON;
    if u < -ue || w < -we || remaining < -re || t < -te || end < -ee {
        return Ok(None);
    }
    if u <= ue || w <= we || remaining <= re || t <= te || end <= ee {
        return Err(());
    }
    Ok(Some(if sign < 0.0 { 1 } else { -1 }))
}
pub(crate) fn occupancy_work(stats: &mut super::QueryStats) -> Result<(), String> {
    if stats.occupancy_triangle_tests >= super::MAX_OCCUPANCY_TRIANGLE_TESTS {
        return Err("closed occupancy triangle-work limit exceeded".into());
    }
    stats.occupancy_triangle_tests += 1;
    Ok(())
}
pub(crate) fn solid_ranges<'a>(
    ranges: &'a [TriangleRange],
    surfaces: &[Surface],
    solid: &str,
) -> Vec<&'a TriangleRange> {
    ranges
        .iter()
        .filter(|r| {
            r.solid_key.as_deref() == Some(solid)
                && surfaces
                    .iter()
                    .any(|s| s.key == r.surface_key && s.topology == Topology::ClosedSolid)
        })
        .collect()
}
pub(crate) fn solid_membership(
    mesh: &MeshData,
    ranges: &[&TriangleRange],
    p: Point,
    a: Point,
    b: Point,
    stats: &mut super::QueryStats,
) -> Result<bool, String> {
    stats.occupancy_point_tests += 1;
    let mut boundary = Vec::new();
    let mut planes: Vec<Point> = Vec::new();
    for range in ranges {
        for ti in range.first..range.first + range.count {
            occupancy_work(stats)?;
            let v = mesh.triangle(ti as usize);
            if let Some(c) = super::ray::triangle(p, p, v)? {
                if !plane_expansion(v, p, coordinate_scale(&[v[0], v[1], v[2], p])?, stats)?
                    .is_empty()
                {
                    return Err(
                        "closed occupancy rounded boundary predicate cannot be certified".into(),
                    );
                }
                if boundary.len() >= 64 {
                    return Err("closed occupancy incident-face limit exceeded".into());
                }
                boundary.push(ti);
                occupancy_work(stats)?;
                let mut interval = false;
                if let Some(line) = super::ray::triangle(a, b, v)? {
                    if line.coplanar {
                        let scale = coordinate_scale(&[v[0], v[1], v[2], a, b])?;
                        if !plane_expansion(v, a, scale, stats)?.is_empty()
                            || !plane_expansion(v, b, scale, stats)?.is_empty()
                        {
                            return Err(
                                "closed occupancy rounded coplanar interval cannot be certified"
                                    .into(),
                            );
                        }
                        if c.barycentric.iter().all(|&x| x > 0.0) {
                            interval = true;
                        }
                        let active: Vec<usize> =
                            (0..3).filter(|&i| c.barycentric[i] != 0.0).collect();
                        if active.len() == 2
                            && cross(sub(v[active[1]], v[active[0]]), sub(b, a))
                                .iter()
                                .all(|&x| x == 0.0)
                        {
                            interval = true;
                        }
                    }
                }
                if !interval {
                    return Err(
                        "closed occupancy sample collapsed onto an isolated boundary feature"
                            .into(),
                    );
                }
                let n = unit(cross(sub(v[1], v[0]), sub(v[2], v[0])))?;
                if !planes
                    .iter()
                    .any(|&other| cross(n, other).iter().all(|&x| x == 0.0))
                {
                    planes.push(n);
                }
            }
        }
    }
    if !boundary.is_empty() {
        return boundary_membership(mesh, ranges, p, a, b, &boundary, &planes, stats);
    }
    let span = (0..3)
        .map(|k| mesh.bounds.hi[k] - mesh.bounds.lo[k])
        .fold(1.0, f64::max);
    // Bounds choose finite exterior ray endpoints only. Occupancy comes exclusively
    // from signed strict-interior crossings of the declared solid's actual faces.
    for attempt in 0..32 {
        stats.occupancy_ray_attempts += 1;
        let n = attempt as f64;
        let end = [
            mesh.bounds.hi[0] + span * (1.137 + n * 0.173),
            mesh.bounds.hi[1] + span * (1.271 + n * 0.317),
            mesh.bounds.hi[2] + span * (1.419 + n * 0.419),
        ];
        if !super::ray::finite(end) || (0..3).any(|k| end[k] <= mesh.bounds.hi[k]) {
            return Err("closed occupancy exterior probe arithmetic overflow".into());
        }
        let mut winding = 0i64;
        let mut uncertain = false;
        'faces: for range in ranges {
            for ti in range.first..range.first + range.count {
                occupancy_work(stats)?;
                match strict_crossing(p, end, mesh.triangle(ti as usize)) {
                    Ok(Some(sign)) => winding += sign,
                    Ok(None) => {}
                    Err(()) => {
                        uncertain = true;
                        break 'faces;
                    }
                }
            }
        }
        if !uncertain {
            return Ok(winding != 0);
        }
    }
    Err("closed occupancy auxiliary predicates could not be certified within 32 directions".into())
}

fn unit(p: Point) -> Result<Point, String> {
    let scale = p.iter().map(|v| v.abs()).fold(0.0, f64::max);
    if scale == 0.0 || !scale.is_finite() {
        return Err("closed occupancy direction arithmetic uncertainty".into());
    }
    let p = p.map(|x| x / scale);
    let length = dot(p, p).sqrt();
    Ok(p.map(|x| x / length))
}
fn boundary_membership(
    mesh: &MeshData,
    ranges: &[&TriangleRange],
    p: Point,
    a: Point,
    b: Point,
    boundary: &[u32],
    planes: &[Point],
    stats: &mut super::QueryStats,
) -> Result<bool, String> {
    if planes.len() > 16 {
        return Err("closed occupancy incident-plane limit exceeded".into());
    }
    let line = unit(sub(b, a))?;
    let radial: Vec<Point> = planes
        .iter()
        .map(|&n| unit(cross(line, n)))
        .collect::<Result<_, _>>()?;
    let mut directions = Vec::new();
    for &n in planes {
        directions.push(n);
        directions.push(n.map(|x| -x));
    }
    // All pairs include every adjacent pair in the cross-section's plane arrangement.
    // Their normalized bisectors cover every open local cell, including nonconvex fans.
    for i in 0..radial.len() {
        for j in i + 1..radial.len() {
            for sign in [-1.0, 1.0] {
                let d = unit([
                    radial[i][0] + sign * radial[j][0],
                    radial[i][1] + sign * radial[j][1],
                    radial[i][2] + sign * radial[j][2],
                ])?;
                directions.push(d);
                directions.push(d.map(|x| -x));
            }
        }
    }
    let span = (0..3)
        .map(|k| mesh.bounds.hi[k] - mesh.bounds.lo[k])
        .fold(1.0, f64::max);
    let mut certified = 0usize;
    for direction in directions {
        let mut signs = Vec::new();
        let mut on_cut = false;
        for &n in planes {
            let terms = [
                n[0] * direction[0],
                n[1] * direction[1],
                n[2] * direction[2],
            ];
            let den = terms.iter().sum::<f64>();
            let error = terms.iter().map(|x| x.abs()).sum::<f64>() * 64.0 * f64::EPSILON;
            if den.abs() <= error && exact_dot_zero(n, direction, stats)? {
                on_cut = true;
                break;
            }
            if den.abs() <= error {
                return Err("closed occupancy incident-fan sign uncertainty".into());
            }
            signs.push(den.signum());
        }
        if on_cut {
            continue;
        }
        let mut result = None;
        for attempt in 0..32 {
            let delta = attempt as f64 * 0.0009765625;
            let d = [
                direction[0] + delta * 0.137,
                direction[1] + delta * 0.271,
                direction[2] + delta * 0.419,
            ];
            if planes.iter().zip(&signs).any(|(&n, &sign)| {
                let terms = [n[0] * d[0], n[1] * d[1], n[2] * d[2]];
                let den = terms.iter().sum::<f64>() * sign;
                den <= terms.iter().map(|x| x.abs()).sum::<f64>() * 64.0 * f64::EPSILON
            }) {
                continue;
            }
            let axis = (0..3)
                .max_by(|&i, &j| d[i].abs().total_cmp(&d[j].abs()))
                .unwrap();
            let target = if d[axis] > 0.0 {
                mesh.bounds.hi[axis] + span
            } else {
                mesh.bounds.lo[axis] - span
            };
            let distance = (target - p[axis]) / d[axis];
            let mut end = std::array::from_fn(|k| p[k] + d[k] * distance);
            end[axis] = target;
            if !super::ray::finite(end) || !distance.is_finite() || distance <= 0.0 {
                return Err("closed occupancy boundary probe arithmetic overflow".into());
            }
            let actual = sub(end, p);
            if planes.iter().zip(&signs).any(|(&n, &sign)| {
                let terms = [n[0] * actual[0], n[1] * actual[1], n[2] * actual[2]];
                terms.iter().sum::<f64>() * sign
                    <= terms.iter().map(|x| x.abs()).sum::<f64>() * 64.0 * f64::EPSILON
            }) {
                continue;
            }
            stats.occupancy_ray_attempts += 1;
            let mut winding = 0i64;
            let mut uncertain = false;
            'faces: for range in ranges {
                for ti in range.first..range.first + range.count {
                    if boundary.contains(&ti) {
                        continue;
                    }
                    occupancy_work(stats)?;
                    match strict_crossing(p, end, mesh.triangle(ti as usize)) {
                        Ok(Some(sign)) => winding += sign,
                        Ok(None) => {}
                        Err(()) => {
                            uncertain = true;
                            break 'faces;
                        }
                    }
                }
            }
            if !uncertain {
                result = Some(winding);
                break;
            }
        }
        let winding = result.ok_or(
            "closed occupancy boundary-cell predicates could not be certified within 32 directions",
        )?;
        if winding == 0 {
            return Ok(false);
        }
        certified += 1;
    }
    if certified == 0 {
        return Err("closed occupancy incident fan has no certified open cell".into());
    }
    Ok(true)
}

type Expansion = Vec<f64>;
fn grow(e: &mut Expansion, b: f64) -> Result<(), String> {
    if b == 0.0 {
        return Ok(());
    }
    let mut q = b;
    let mut out = Vec::with_capacity(e.len() + 1);
    for &a in e.iter() {
        let sum = q + a;
        let bv = sum - q;
        let low = (q - (sum - bv)) + (a - bv);
        if low != 0.0 {
            out.push(low);
        }
        q = sum;
    }
    if q != 0.0 {
        out.push(q);
    }
    if out.len() > 256 {
        return Err("closed occupancy exact expansion capacity exceeded".into());
    }
    *e = out;
    Ok(())
}
fn difference(a: f64, b: f64) -> Expansion {
    let hi = a - b;
    let bv = a - hi;
    let low = (a - (hi + bv)) + (bv - b);
    let mut e = Vec::new();
    if low != 0.0 {
        e.push(low);
    }
    if hi != 0.0 {
        e.push(hi);
    }
    e
}
fn product(
    a: &Expansion,
    b: &Expansion,
    stats: &mut super::QueryStats,
) -> Result<Expansion, String> {
    let mut out = Vec::new();
    for &x in a {
        for &y in b {
            if stats.occupancy_predicate_products >= super::MAX_OCCUPANCY_PREDICATE_PRODUCTS {
                return Err("closed occupancy exact-predicate product-work limit exceeded".into());
            }
            stats.occupancy_predicate_products += 1;
            let hi = x * y;
            if !hi.is_finite() || (x != 0.0 && y != 0.0 && hi.abs() < 2f64.powi(-900)) {
                return Err(
                    "closed occupancy exact-predicate arithmetic underflow/overflow".into(),
                );
            }
            let low = x.mul_add(y, -hi);
            grow(&mut out, low)?;
            grow(&mut out, hi)?;
        }
    }
    Ok(out)
}
fn coordinate_scale(points: &[Point]) -> Result<f64, String> {
    let max = points.iter().flatten().map(|v| v.abs()).fold(0.0, f64::max);
    if !max.is_finite() {
        return Err("closed occupancy exact coordinates nonfinite".into());
    }
    if max == 0.0 {
        return Ok(1.0);
    }
    let exponent = ((max.to_bits() >> 52) & 2047) as i32 - 1023;
    let scale = 2f64.powi(-exponent);
    if !scale.is_finite() {
        return Err("closed occupancy exact coordinate scale overflow".into());
    }
    Ok(scale)
}
fn plane_expansion(
    v: [Point; 3],
    p: Point,
    scale: f64,
    stats: &mut super::QueryStats,
) -> Result<Expansion, String> {
    let mut points = [v[0], v[1], v[2], p];
    for point in &mut points {
        for x in point {
            let original = *x;
            *x *= scale;
            if !x.is_finite() || (original != 0.0 && x.abs() < f64::MIN_POSITIVE) {
                return Err("closed occupancy exact coordinate scaling underflow/overflow".into());
            }
        }
    }
    let edges: [Vec<Expansion>; 3] = std::array::from_fn(|i| {
        (0..3)
            .map(|k| difference(points[i + 1][k], points[0][k]))
            .collect()
    });
    let mut out = Vec::new();
    for (i, j, k, sign) in [
        (0, 1, 2, 1.),
        (0, 2, 1, -1.),
        (1, 2, 0, 1.),
        (1, 0, 2, -1.),
        (2, 0, 1, 1.),
        (2, 1, 0, -1.),
    ] {
        let xy = product(&edges[0][i], &edges[1][j], stats)?;
        let xyz = product(&xy, &edges[2][k], stats)?;
        for x in xyz {
            grow(&mut out, x * sign)?;
        }
    }
    Ok(out)
}
fn exact_dot_zero(a: Point, b: Point, stats: &mut super::QueryStats) -> Result<bool, String> {
    let mut out = Vec::new();
    for i in 0..3 {
        let terms = product(&vec![a[i]], &vec![b[i]], stats)?;
        for x in terms {
            grow(&mut out, x)?;
        }
    }
    Ok(out.is_empty())
}
pub(crate) fn plane_endpoint_signs(v: [Point; 3], a: Point, b: Point) -> Result<[i8; 2], String> {
    let scale = coordinate_scale(&[v[0], v[1], v[2], a, b])?;
    let mut stats = super::QueryStats::default();
    let sign = |e: Expansion| e.last().map_or(0, |x| if *x < 0.0 { -1 } else { 1 });
    Ok([
        sign(plane_expansion(v, a, scale, &mut stats)?),
        sign(plane_expansion(v, b, scale, &mut stats)?),
    ])
}
pub(crate) fn plane_fraction(v: [Point; 3], a: Point, b: Point) -> Result<Option<f64>, String> {
    let scale = coordinate_scale(&[v[0], v[1], v[2], a, b])?;
    let mut stats = super::QueryStats::default();
    let va = plane_expansion(v, a, scale, &mut stats)?;
    let mut den = plane_expansion(v, b, scale, &mut stats)?;
    for &x in &va {
        grow(&mut den, -x)?;
    }
    if den.is_empty() {
        return Err("triangle plane fraction precision uncertainty".into());
    }
    let sign = den.last().unwrap().signum();
    let numerator: Expansion = va.into_iter().map(|x| -x * sign).collect();
    for x in &mut den {
        *x *= sign;
    }
    certified_fraction(numerator, den, &mut stats)
}
fn certified_fraction(
    numerator: Expansion,
    den: Expansion,
    stats: &mut super::QueryStats,
) -> Result<Option<f64>, String> {
    if numerator.is_empty() {
        return Ok(Some(0.0));
    }
    if *numerator.last().unwrap() < 0.0 {
        return Ok(None);
    }
    let mut end = numerator.clone();
    for &x in &den {
        grow(&mut end, -x)?;
    }
    if end.is_empty() {
        return Ok(Some(1.0));
    }
    if *end.last().unwrap() > 0.0 {
        return Ok(None);
    }
    let mut t = numerator.iter().sum::<f64>() / den.iter().sum::<f64>();
    if !t.is_finite() {
        return Err("triangle plane fraction representable interval precision uncertainty".into());
    }
    // Exact expansion signs already proved a strictly interior root. Its
    // nearest representable fraction may nevertheless be an endpoint; certify
    // that rounding interval below rather than rejecting a real surface hit.
    t=t.clamp(0.,1.);
    let residual = |t: f64, stats: &mut super::QueryStats| -> Result<Expansion, String> {
        let mut out = numerator.clone();
        for x in product(&den, &vec![t], stats)? {
            grow(&mut out, -x)?;
        }
        Ok(out)
    };
    // At most four adjacent f64 intervals. No geometric tolerance: compare the
    // exact root with exact interval endpoints and midpoint, including ties.
    for _ in 0..4 {
        let mut at = residual(t, stats)?;
        let Some(last) = at.last() else {
            return Ok(Some(t));
        };
        let direction = last.signum();
        let neighbor = f64::from_bits(if direction > 0.0 {
            t.to_bits() + 1
        } else {
            t.to_bits() - 1
        });
        if !(0.0..=1.0).contains(&neighbor) {
            return Err("triangle plane fraction precision uncertainty".into());
        }
        let other = residual(neighbor, stats)?;
        if other.is_empty() {
            return Ok(Some(neighbor));
        }
        if other.last().unwrap().signum() == direction {
            t = neighbor;
            continue;
        }
        let half = (neighbor - t) * 0.5;
        if half == 0.0 {
            return Err("triangle plane fraction midpoint precision underflow".into());
        }
        for x in product(&den, &vec![half], stats)? {
            grow(&mut at, -x)?;
        }
        return Ok(Some(match at.last() {
            None => {
                if t.to_bits() & 1 == 0 {
                    t
                } else {
                    neighbor
                }
            }
            Some(x) => {
                if x.signum() == direction {
                    neighbor
                } else {
                    t
                }
            }
        }));
    }
    Err("triangle plane fraction rounding interval could not be certified".into())
}
pub(crate) fn axis_fraction(plane: f64, a: f64, b: f64) -> Result<Option<f64>, String> {
    // Scale only the three original axis scalars, so unrelated triangle extents
    // cannot erase a direct subnormal crossing. Power-of-two scaling and exact
    // difference expansions retain the endpoint subtraction's rounding residual.
    let original = [plane, a, b];
    let scale = coordinate_scale(&[original])?;
    let values = original.map(|x| x * scale);
    for (before, after) in original.iter().zip(&values) {
        if !after.is_finite() || (*before != 0.0 && after.abs() < f64::MIN_POSITIVE) {
            return Err("triangle axis fraction scaling precision uncertainty".into());
        }
    }
    let mut numerator = difference(values[0], values[1]);
    let mut den = difference(values[2], values[1]);
    let Some(sign) = den.last().map(|x| x.signum()) else {
        return Err("triangle axis fraction precision uncertainty".into());
    };
    for x in numerator.iter_mut().chain(den.iter_mut()) {
        *x *= sign;
    }
    certified_fraction(numerator, den, &mut super::QueryStats::default())
}
fn projected_expansion(
    a: Point,
    b: Point,
    c: Point,
    x: usize,
    y: usize,
    stats: &mut super::QueryStats,
) -> Result<Expansion, String> {
    let mut result = product(&difference(b[x], a[x]), &difference(c[y], a[y]), stats)?;
    for term in product(&difference(b[y], a[y]), &difference(c[x], a[x]), stats)? {
        grow(&mut result, -term)?;
    }
    Ok(result)
}
pub(crate) fn coplanar_contact(
    a: Point,
    b: Point,
    v: [Point; 3],
    k: usize,
) -> Result<Option<Contact>, String> {
    // Every half-space is evaluated from the original represented coordinates.
    // Bounds are positive-denominator exact ratios until their ordering and
    // intersection are certified. Rounded endpoint differences never certify
    // an endpoint touch or an overlap of disjoint competing half-spaces.
    let scale = coordinate_scale(&[v[0], v[1], v[2], a, b])?;
    let original = [v[0], v[1], v[2], a, b];
    let points = original.map(|p| p.map(|value| value * scale));
    for (before, after) in original.iter().flatten().zip(points.iter().flatten()) {
        if !after.is_finite() || (*before != 0.0 && after.abs() < f64::MIN_POSITIVE) {
            return Err("triangle coplanar coordinate scaling precision uncertainty".into());
        }
    }
    let x = (k + 1) % 3;
    let y = (k + 2) % 3;
    let mut stats = super::QueryStats::default();
    let mut area = projected_expansion(points[0], points[1], points[2], x, y, &mut stats)?;
    let Some(sign) = area.last().map(|x| x.signum()) else {
        return Ok(None);
    };
    for term in &mut area {
        *term *= sign;
    }
    let mut aa = Vec::with_capacity(3);
    let mut bb = Vec::with_capacity(3);
    for i in 0..3 {
        let mut at = projected_expansion(
            points[(i + 1) % 3],
            points[(i + 2) % 3],
            points[3],
            x,
            y,
            &mut stats,
        )?;
        let mut end = projected_expansion(
            points[(i + 1) % 3],
            points[(i + 2) % 3],
            points[4],
            x,
            y,
            &mut stats,
        )?;
        for term in at.iter_mut().chain(end.iter_mut()) {
            *term *= sign;
        }
        if at.last().is_some_and(|&x| x < 0.0) && end.last().is_some_and(|&x| x < 0.0) {
            return Ok(None);
        }
        aa.push(at);
        bb.push(end);
    }
    let compare = |a: &(Expansion, Expansion),
                   b: &(Expansion, Expansion),
                   stats: &mut super::QueryStats|
     -> Result<i8, String> {
        let mut result = product(&a.0, &b.1, stats)?;
        for term in product(&b.0, &a.1, stats)? {
            grow(&mut result, -term)?;
        }
        Ok(result.last().map_or(0, |&x| if x < 0.0 { -1 } else { 1 }))
    };
    let mut lo = (Vec::new(), vec![1.0]);
    let mut hi = (vec![1.0], vec![1.0]);
    for i in 0..3 {
        if aa[i].last().is_some_and(|&x| x < 0.0) {
            let numerator: Expansion = aa[i].iter().map(|x| -x).collect();
            let mut den = bb[i].clone();
            for &x in &aa[i] {
                grow(&mut den, -x)?;
            }
            let bound = (numerator, den);
            if compare(&bound, &lo, &mut stats)? > 0 {
                lo = bound;
            }
        } else if bb[i].last().is_some_and(|&x| x < 0.0) {
            let mut den = aa[i].clone();
            for &x in &bb[i] {
                grow(&mut den, -x)?;
            }
            let bound = (aa[i].clone(), den);
            if compare(&bound, &hi, &mut stats)? < 0 {
                hi = bound;
            }
        }
    }
    if compare(&lo, &hi, &mut stats)? > 0 {
        return Ok(None);
    }
    let t = certified_fraction(lo.0.clone(), lo.1.clone(), &mut stats)?
        .ok_or("triangle coplanar clipping interval precision uncertainty")?;
    let den = product(&area, &lo.1, &mut stats)?;
    let mut barycentric = [0.0; 3];
    for i in 0..3 {
        let mut numerator = product(&aa[i], &lo.1, &mut stats)?;
        let mut delta = bb[i].clone();
        for &x in &aa[i] {
            grow(&mut delta, -x)?;
        }
        for term in product(&delta, &lo.0, &mut stats)? {
            grow(&mut numerator, term)?;
        }
        barycentric[i] = certified_fraction(numerator, den.clone(), &mut stats)?
            .ok_or("triangle coplanar barycentric precision uncertainty")?;
    }
    Ok(Some(Contact {
        t,
        barycentric,
        coplanar: true,
    }))
}
pub(crate) fn projected_orientation_zero(
    a: Point,
    b: Point,
    c: Point,
    x: usize,
    y: usize,
) -> Result<bool, String> {
    let scale = coordinate_scale(&[a, b, c])?;
    let points = [a, b, c].map(|p| p.map(|value| value * scale));
    for (original, scaled) in [a, b, c].iter().flatten().zip(points.iter().flatten()) {
        if !scaled.is_finite() || (*original != 0.0 && scaled.abs() < f64::MIN_POSITIVE) {
            return Err("triangle projected-edge scaling precision uncertainty".into());
        }
    }
    let mut stats = super::QueryStats::default();
    let mut result = product(
        &difference(points[1][x], points[0][x]),
        &difference(points[2][y], points[0][y]),
        &mut stats,
    )?;
    let other = product(
        &difference(points[1][y], points[0][y]),
        &difference(points[2][x], points[0][x]),
        &mut stats,
    )?;
    for term in other {
        grow(&mut result, -term)?;
    }
    Ok(result.is_empty())
}
pub(crate) fn barycentric_coordinates(
    v: [Point; 3],
    a: Point,
    b: Point,
) -> Result<Option<Point>, String> {
    let scale = coordinate_scale(&[v[0], v[1], v[2], a, b])?;
    let mut stats = super::QueryStats::default();
    let mut numerators = Vec::with_capacity(3);
    for vertex in 0..3 {
        numerators.push(plane_expansion(
            [a, b, v[(vertex + 1) % 3]],
            v[(vertex + 2) % 3],
            scale,
            &mut stats,
        )?);
    }
    let negative = numerators
        .iter()
        .any(|e| e.last().is_some_and(|&x| x < 0.0));
    let positive = numerators
        .iter()
        .any(|e| e.last().is_some_and(|&x| x > 0.0));
    if negative && positive {
        return Ok(None);
    }
    if !negative && !positive {
        return Err("triangle barycentric edge precision uncertainty".into());
    }
    let sign = if negative { -1.0 } else { 1.0 };
    let mut denominator = Vec::new();
    for numerator in &mut numerators {
        for term in numerator {
            *term *= sign;
            grow(&mut denominator, *term)?;
        }
    }
    let mut barycentric = [0.0; 3];
    for (vertex, numerator) in numerators.into_iter().enumerate() {
        barycentric[vertex] = certified_fraction(numerator, denominator.clone(), &mut stats)?
            .ok_or("triangle barycentric fraction precision uncertainty")?;
    }
    Ok(Some(barycentric))
}
pub(crate) fn affine_component(row: [f64; 4], p: Point) -> Result<f64, String> {
    // At most four original terms. Correct mixed-sign accumulation before BVH
    // traversal; certify the nearest representable scalar using exact residuals.
    let mut stats = super::QueryStats::default();
    let mut result = Vec::new();
    for k in 0..3 {
        for term in product(&vec![row[k]], &vec![p[k]], &mut stats)? {
            grow(&mut result, term)?;
        }
    }
    grow(&mut result, row[3])?;
    let value = result.iter().sum::<f64>();
    if !value.is_finite() {
        return Err("triangle affine accumulation precision overflow".into());
    }
    let mut residual = result;
    grow(&mut residual, -value)?;
    let Some(last) = residual.last() else {
        return Ok(value);
    };
    let sign = last.signum();
    let neighbor = if value == 0.0 {
        sign * f64::from_bits(1)
    } else {
        let bits = value.to_bits();
        f64::from_bits(if (value > 0.0) == (sign > 0.0) {
            bits + 1
        } else {
            bits - 1
        })
    };
    let width = neighbor - value;
    if !neighbor.is_finite() || width * 0.5 == 0.0 {
        return Err("triangle affine rounding precision uncertainty".into());
    }
    let mut beyond = residual.clone();
    grow(&mut beyond, -width)?;
    if beyond.last().is_some_and(|x| x.signum() == sign) {
        return Err("triangle affine rounding interval could not be certified".into());
    }
    grow(&mut residual, -width * 0.5)?;
    Ok(match residual.last() {
        None => {
            if value.to_bits() & 1 == 0 {
                value
            } else {
                neighbor
            }
        }
        Some(x) => {
            if x.signum() == sign {
                neighbor
            } else {
                value
            }
        }
    })
}
pub(crate) fn same_line_contact(
    v: [Point; 3],
    w: [Point; 3],
    a: Point,
    b: Point,
    stats: &mut super::QueryStats,
) -> Result<bool, String> {
    let scale = coordinate_scale(&[v[0], v[1], v[2], w[0], w[1], w[2], a, b])?;
    let va = plane_expansion(v, a, scale, stats)?;
    let vb = plane_expansion(v, b, scale, stats)?;
    let wa = plane_expansion(w, a, scale, stats)?;
    let wb = plane_expansion(w, b, scale, stats)?;
    // A genuinely coplanar face uses clipping contacts rather than a plane root.
    if (va.is_empty() && vb.is_empty()) || (wa.is_empty() && wb.is_empty()) {
        return Ok(true);
    }
    let x = product(&va, &wb, stats)?;
    let y = product(&wa, &vb, stats)?;
    let mut delta = x;
    for term in y {
        grow(&mut delta, -term)?;
    }
    Ok(delta.is_empty())
}
