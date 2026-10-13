//! Double-sided finite segments over emitted f32 vertices, evaluated in f64.
pub type Point = [f64; 3];
pub fn sub(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn dot(a: Point, b: Point) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn cross(a: Point, b: Point) -> Point {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
pub fn finite(p: Point) -> bool {
    p.iter().all(|v| v.is_finite())
}
pub fn point_at(a: Point, b: Point, t: f64) -> Point {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}
#[derive(Clone, Copy, Debug)]
pub struct Contact {
    pub t: f64,
    pub barycentric: Point,
    pub coplanar: bool,
}

// Compensated product difference at cancellation; no geometric epsilon or triangle inflation.
fn edge(a: f64, b: f64, c: f64, d: f64) -> f64 {
    let p = a * b;
    let q = c * d;
    let e = p - q;
    if e.abs() <= (p.abs() + q.abs()) * 8.0 * f64::EPSILON {
        e + (a.mul_add(b, -p) - c.mul_add(d, -q))
    } else {
        e
    }
}
fn coplanar(a: Point, b: Point, v: [Point; 3], n: Point) -> Result<Option<Contact>, String> {
    // A coplanar segment reports its first triangle touch, including an inside start.
    // Both original-coordinate endpoint plane zeros were certified by the caller.
    let k = (0..3)
        .max_by(|&i, &j| n[i].abs().total_cmp(&n[j].abs()))
        .unwrap();
    super::surface::coplanar_contact(a, b, v, k)
}
fn uncertain_dot(a: Point, b: Point) -> bool {
    let terms = [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
    let error =
        terms.iter().map(|x| x.abs()).sum::<f64>() * 64.0 * f64::EPSILON + f64::from_bits(1) * 64.0;
    dot(a, b).abs() <= error
}
pub fn triangle(a: Point, b: Point, v: [Point; 3]) -> Result<Option<Contact>, String> {
    if !finite(a) || !finite(b) || v.iter().any(|&p| !finite(p)) {
        return Err("nonfinite triangle query input".into());
    }
    let d = sub(b, a);
    if !finite(d) {
        return Err("triangle segment arithmetic overflow".into());
    }
    let n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    if !finite(n) {
        return Err("triangle normal arithmetic overflow".into());
    }
    let n_scale = n.iter().map(|v| v.abs()).fold(0.0, f64::max);
    if n_scale == 0.0 {
        for k in 0..3 {
            if !super::surface::projected_orientation_zero(
                v[0],
                v[1],
                v[2],
                (k + 1) % 3,
                (k + 2) % 3,
            )? {
                return Err("triangle normal precision uncertainty".into());
            }
        }
        return Ok(None);
    }
    let n_unit = n.map(|v| v / n_scale);
    let d_scale = d.iter().map(|v| v.abs()).fold(0.0, f64::max);
    let d_unit = if d_scale == 0.0 {
        [0.0; 3]
    } else {
        d.map(|v| v / d_scale)
    };
    if (0..3).any(|k| d[k] != 0.0 && d_unit[k] == 0.0 && n_unit[k] != 0.0) {
        return Err("triangle direction arithmetic underflow".into());
    }
    if uncertain_dot(n_unit, d_unit) {
        let signs = super::surface::plane_endpoint_signs(v, a, b)?;
        if signs[0] != 0 && signs[0] == signs[1] {
            return Ok(None);
        }
        if signs != [0, 0] {
            return Err("triangle plane-predicate precision uncertainty".into());
        }
        let c = coplanar(a, b, v, n_unit)?;
        if c.map(|c| !c.t.is_finite() || !finite(c.barycentric))
            .unwrap_or(false)
        {
            return Err("coplanar arithmetic overflow".into());
        }
        return Ok(c.map(|mut c| {
            if c.t == 0.0 {
                c.t = 0.0;
            }
            c
        }));
    }
    let kz = (0..3)
        .max_by(|&i, &j| d[i].abs().total_cmp(&d[j].abs()))
        .unwrap();
    if d[kz] == 0.0 {
        return Ok(None);
    }
    let mut kx = (kz + 1) % 3;
    let mut ky = (kx + 1) % 3;
    if d[kz] < 0.0 {
        std::mem::swap(&mut kx, &mut ky);
    }
    let sx = d[kx] / d[kz];
    let sy = d[ky] / d[kz];
    let p = v.map(|p| sub(p, a));
    let x = p.map(|p| p[kx] - sx * p[kz]);
    let y = p.map(|p| p[ky] - sy * p[kz]);
    let mut u = edge(x[2], y[1], y[2], x[1]);
    let mut w = edge(x[0], y[2], y[0], x[2]);
    let mut z = edge(x[1], y[0], y[1], x[0]);
    if x.iter().chain(y.iter()).any(|v| !v.is_finite()) || ![u, w, z].iter().all(|v| v.is_finite())
    {
        return Err("triangle edge arithmetic overflow".into());
    }
    for (vertex, value, left, right) in [
        (0, &mut u, (x[2] * y[1]).abs(), (y[2] * x[1]).abs()),
        (1, &mut w, (x[0] * y[2]).abs(), (y[0] * x[2]).abs()),
        (2, &mut z, (x[1] * y[0]).abs(), (y[1] * x[0]).abs()),
    ] {
        if value.abs() <= (left + right) * 64.0 * f64::EPSILON + f64::from_bits(1) * 64.0 {
            if !super::surface::barycentric_numerator_zero(v, a, b, vertex)? {
                return Err("triangle barycentric edge precision uncertainty".into());
            }
            *value = 0.0;
        }
    }
    if (u < 0.0 || w < 0.0 || z < 0.0) && (u > 0.0 || w > 0.0 || z > 0.0) {
        return Ok(None);
    }
    let det = u + w + z;
    if !det.is_finite() {
        return Err("triangle determinant arithmetic overflow".into());
    }
    if det == 0.0 {
        return Ok(None);
    }
    let barycentric = [u / det, w / det, z / det];
    if !finite(barycentric) {
        return Err("triangle barycentric arithmetic overflow".into());
    }
    let t = if v[0][kz] != v[1][kz] || v[1][kz] != v[2][kz] {
        let Some(certified) = super::surface::plane_fraction(v, a, b)? else {
            return Ok(None);
        };
        certified
    } else {
        // Certify this axis-plane fast path with original endpoints. Subtracting
        // an outside endpoint from a distant start may erase its signed offset.
        let plane = v[0][kz];
        if plane < a[kz].min(b[kz]) || plane > a[kz].max(b[kz]) {
            return Ok(None);
        }
        let Some(certified) = super::surface::axis_fraction(plane, a[kz], b[kz])? else {
            return Ok(None);
        };
        certified
    };
    if !t.is_finite() {
        return Err("triangle fraction arithmetic overflow".into());
    }
    if !(0.0..=1.0).contains(&t) {
        return Ok(None);
    }
    Ok(Some(Contact {
        t: if t == 0.0 { 0.0 } else { t },
        barycentric,
        coplanar: false,
    }))
}

#[derive(Clone, Copy, Debug)]
pub struct Affine {
    pub forward: [f64; 16],
    pub inverse: [f64; 16],
    pub orientation: f64,
}
pub fn transform(m: &[f64; 16], p: Point) -> Point {
    [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ]
}
pub(crate) fn transform_query(m: &[f64; 16], p: Point) -> Result<Point, String> {
    let mut out = transform(m, p);
    if !finite(out) {
        return Err("local segment transform overflow".into());
    }
    for k in 0..3 {
        let row = [m[k], m[4 + k], m[8 + k], m[12 + k]];
        let terms = [row[0] * p[0], row[1] * p[1], row[2] * p[2], row[3]];
        // Direct and signed-copy components retain subnormal inputs. Mixed-sign
        // rows use original-product expansions, including lost FMA residuals.
        if terms.iter().any(|x| *x > 0.0) && terms.iter().any(|x| *x < 0.0) {
            out[k] = super::surface::affine_component(row, p)?;
        }
    }
    Ok(out)
}
pub(crate) fn certify_world_contact(
    a: Point,
    b: Point,
    v: [Point; 3],
    c: Contact,
) -> Result<(), String> {
    let n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    let d = sub(b, a);
    let ns = n.iter().map(|x| x.abs()).fold(0.0, f64::max);
    let ds = d.iter().map(|x| x.abs()).fold(0.0, f64::max);
    let uncertain = ds == 0.0 || uncertain_dot(n.map(|x| x / ns), d.map(|x| x / ds));
    if c.coplanar || uncertain {
        if !c.coplanar || super::surface::plane_endpoint_signs(v, a, b)? != [0, 0] {
            return Err("triangle world/local plane precision uncertainty".into());
        }
    }
    Ok(())
}
pub fn multiply(a: [f64; 16], b: [f64; 16]) -> [f64; 16] {
    let mut o = [0.0; 16];
    for c in 0..4 {
        for r in 0..4 {
            o[c * 4 + r] = (0..4).map(|k| a[k * 4 + r] * b[c * 4 + k]).sum();
        }
    }
    o
}
impl Affine {
    pub fn new(m: [f64; 16]) -> Result<Self, String> {
        if m.iter().any(|v| !v.is_finite())
            || m[3] != 0.0
            || m[7] != 0.0
            || m[11] != 0.0
            || m[15] != 1.0
        {
            return Err("nonfinite or non-affine transform".into());
        }
        let a = [m[0], m[1], m[2]];
        let b = [m[4], m[5], m[6]];
        let c = [m[8], m[9], m[10]];
        let bc = cross(b, c);
        let ca = cross(c, a);
        let ab = cross(a, b);
        let det = dot(a, bc);
        if det == 0.0 || !det.is_finite() {
            return Err("singular transform".into());
        }
        let mut inv = [0.0; 16];
        for i in 0..3 {
            inv[i * 4] = bc[i] / det;
            inv[i * 4 + 1] = ca[i] / det;
            inv[i * 4 + 2] = ab[i] / det;
        }
        inv[15] = 1.0;
        let p = transform_query(&inv, [m[12], m[13], m[14]])?;
        for i in 0..3 {
            inv[12 + i] = -p[i];
        }
        if inv.iter().any(|v| !v.is_finite()) {
            return Err("inverse transform overflow".into());
        }
        Ok(Self {
            forward: m,
            inverse: inv,
            orientation: det.signum(),
        })
    }
}
