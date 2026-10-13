//! Deterministic flat 16-bin SAH acceleration, original primitive IDs retained separately.
use super::ray::{finite, Point};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Bounds {
    pub lo: Point,
    pub hi: Point,
}
impl Bounds {
    pub fn empty() -> Self {
        Self {
            lo: [f64::INFINITY; 3],
            hi: [f64::NEG_INFINITY; 3],
        }
    }
    pub fn point(p: Point) -> Self {
        Self { lo: p, hi: p }
    }
    pub fn union(self, b: Self) -> Self {
        Self {
            lo: std::array::from_fn(|k| self.lo[k].min(b.lo[k])),
            hi: std::array::from_fn(|k| self.hi[k].max(b.hi[k])),
        }
    }
    pub fn valid(self) -> bool {
        finite(self.lo) && finite(self.hi) && (0..3).all(|k| self.lo[k] <= self.hi[k])
    }
    fn area(self) -> f64 {
        if !self.valid() {
            return 0.0;
        }
        let d = std::array::from_fn::<_, 3, _>(|k| self.hi[k] - self.lo[k]);
        2.0 * (d[0] * d[1] + d[0] * d[2] + d[1] * d[2])
    }
    fn center(self, k: usize) -> f64 {
        self.lo[k] * 0.5 + self.hi[k] * 0.5
    }
    fn contains(self, b: Self) -> bool {
        (0..3).all(|k| self.lo[k] <= b.lo[k] && self.hi[k] >= b.hi[k])
    }
    pub fn segment(self, a: Point, b: Point) -> Option<f64> {
        let mut lo: f64 = 0.0;
        let mut hi: f64 = 1.0;
        for k in 0..3 {
            let d = b[k] - a[k];
            // Only candidate bounds get scale-aware numerical outward padding.
            let pad = 8.0 * f64::EPSILON * self.lo[k].abs().max(self.hi[k].abs()).max(1.0);
            if d == 0.0 {
                if a[k] < self.lo[k] - pad || a[k] > self.hi[k] + pad {
                    return None;
                }
            } else {
                let u = (self.lo[k] - pad - a[k]) / d;
                let v = (self.hi[k] + pad - a[k]) / d;
                lo = lo.max(u.min(v));
                hi = hi.min(u.max(v));
                if lo > hi {
                    return None;
                }
            }
        }
        Some(lo)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BvhNode {
    pub bounds: Bounds,
    pub left: Option<u32>,
    pub right: Option<u32>,
    pub first: u32,
    pub count: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct Bvh {
    pub nodes: Vec<BvhNode>,
    pub order: Vec<u32>,
}
#[derive(Default)]
pub struct TraversalStats {
    pub pop_visits: u64,
    pub bounds_tests: u64,
}
impl Bvh {
    pub fn build(items: &[Bounds]) -> Result<Self, String> {
        if items.len() > super::MAX_TRIANGLES || items.iter().any(|b| !b.valid()) {
            return Err("invalid BVH input bounds/count".into());
        }
        let mut out = Self {
            nodes: Vec::new(),
            order: (0..items.len() as u32).collect(),
        };
        if !items.is_empty() {
            out.split(items, 0, items.len(), 0)?;
        }
        out.validate(items)?;
        Ok(out)
    }
    fn split(
        &mut self,
        items: &[Bounds],
        first: usize,
        count: usize,
        depth: usize,
    ) -> Result<u32, String> {
        if depth > 64 {
            return Err("BVH depth overflow".into());
        }
        let id = self.nodes.len() as u32;
        let bounds = self.order[first..first + count]
            .iter()
            .fold(Bounds::empty(), |b, &i| b.union(items[i as usize]));
        self.nodes.push(BvhNode {
            bounds,
            left: None,
            right: None,
            first: first as u32,
            count: count as u32,
        });
        if count <= 8 {
            return Ok(id);
        }
        let mut best: Option<(f64, usize, usize, f64, f64)> = None;
        for axis in 0..3 {
            let lo = self.order[first..first + count]
                .iter()
                .map(|&i| items[i as usize].center(axis))
                .fold(f64::INFINITY, f64::min);
            let hi = self.order[first..first + count]
                .iter()
                .map(|&i| items[i as usize].center(axis))
                .fold(f64::NEG_INFINITY, f64::max);
            if lo == hi {
                continue;
            }
            let mut bs = [Bounds::empty(); 16];
            let mut ns = [0usize; 16];
            for &i in &self.order[first..first + count] {
                let bin =
                    (((items[i as usize].center(axis) - lo) / (hi - lo) * 16.0) as usize).min(15);
                bs[bin] = bs[bin].union(items[i as usize]);
                ns[bin] += 1;
            }
            for cut in 0..15 {
                let l = bs[..=cut]
                    .iter()
                    .copied()
                    .fold(Bounds::empty(), Bounds::union);
                let r = bs[cut + 1..]
                    .iter()
                    .copied()
                    .fold(Bounds::empty(), Bounds::union);
                let nl: usize = ns[..=cut].iter().sum();
                let nr: usize = ns[cut + 1..].iter().sum();
                if nl == 0 || nr == 0 {
                    continue;
                }
                let cost = l.area() * nl as f64 + r.area() * nr as f64;
                if best.as_ref().map(|b| cost < b.0).unwrap_or(true) {
                    best = Some((cost, axis, cut, lo, hi));
                }
            }
        }
        let slice = &mut self.order[first..first + count];
        let left_count = if let Some((_, axis, cut, lo, hi)) = best {
            slice.sort_by_key(|&i| {
                (
                    (((items[i as usize].center(axis) - lo) / (hi - lo) * 16.0) as usize).min(15)
                        > cut,
                    i,
                )
            });
            slice
                .iter()
                .take_while(|&&i| {
                    (((items[i as usize].center(axis) - lo) / (hi - lo) * 16.0) as usize).min(15)
                        <= cut
                })
                .count()
        } else {
            slice.sort_unstable();
            count / 2
        };
        let l = self.split(items, first, left_count, depth + 1)?;
        let r = self.split(items, first + left_count, count - left_count, depth + 1)?;
        self.nodes[id as usize].left = Some(l);
        self.nodes[id as usize].right = Some(r);
        self.nodes[id as usize].count = 0;
        Ok(id)
    }
    pub fn validate(&self, items: &[Bounds]) -> Result<(), String> {
        if items.is_empty() {
            return if self.nodes.is_empty() && self.order.is_empty() {
                Ok(())
            } else {
                Err("nonempty BVH for empty geometry".into())
            };
        }
        if self.nodes.is_empty()
            || self.nodes.len() > items.len().saturating_mul(2)
            || self.order.len() != items.len()
        {
            return Err("bad BVH size".into());
        }
        let mut permutation = vec![false; items.len()];
        for &i in &self.order {
            let s = permutation
                .get_mut(i as usize)
                .ok_or("bad BVH primitive index")?;
            if *s {
                return Err("duplicate BVH primitive".into());
            }
            *s = true;
        }
        let mut seen = vec![false; self.nodes.len()];
        let mut covered = vec![false; self.order.len()];
        let mut stack = vec![(0usize, 0usize)];
        while let Some((i, depth)) = stack.pop() {
            if depth > 64 {
                return Err("BVH depth overflow".into());
            }
            let s = seen.get_mut(i).ok_or("bad BVH child index")?;
            if *s {
                return Err("BVH cycle or shared child".into());
            }
            *s = true;
            let n = &self.nodes[i];
            if !n.bounds.valid() {
                return Err("invalid BVH bounds".into());
            }
            match (n.left, n.right) {
                (None, None) => {
                    let first = n.first as usize;
                    let count = n.count as usize;
                    let end = first.checked_add(count).ok_or("BVH range overflow")?;
                    if count == 0 || count > 8 || end > self.order.len() {
                        return Err("invalid BVH leaf range".into());
                    }
                    for j in first..end {
                        if covered[j] {
                            return Err("overlapping BVH leaves".into());
                        }
                        covered[j] = true;
                        if !n.bounds.contains(items[self.order[j] as usize]) {
                            return Err("nonconservative BVH leaf bounds".into());
                        }
                    }
                }
                (Some(l), Some(r)) => {
                    if n.count != 0 || l == r {
                        return Err("bad BVH branch".into());
                    }
                    for c in [l, r] {
                        let child = self.nodes.get(c as usize).ok_or("bad BVH child index")?;
                        if !n.bounds.contains(child.bounds) {
                            return Err("nonconservative BVH branch bounds".into());
                        }
                        stack.push((c as usize, depth + 1));
                    }
                }
                _ => return Err("incomplete BVH branch".into()),
            }
        }
        if seen.iter().any(|v| !*v) || covered.iter().any(|v| !*v) {
            return Err("unreachable BVH node or primitive".into());
        }
        Ok(())
    }
    pub fn refit(&mut self, items: &[Bounds]) -> Result<(), String> {
        if items.len() != self.order.len() || items.iter().any(|b| !b.valid()) {
            return Err("invalid refit bounds".into());
        }
        for i in (0..self.nodes.len()).rev() {
            let n = &self.nodes[i];
            let b = match (n.left, n.right) {
                (Some(l), Some(r)) => self.nodes[l as usize]
                    .bounds
                    .union(self.nodes[r as usize].bounds),
                _ => self.order[n.first as usize..(n.first + n.count) as usize]
                    .iter()
                    .fold(Bounds::empty(), |b, &j| b.union(items[j as usize])),
            };
            self.nodes[i].bounds = b;
        }
        self.validate(items)
    }
    pub fn candidates(
        &self,
        a: Point,
        b: Point,
        stack: &mut Vec<u32>,
        out: &mut Vec<u32>,
        limit: usize,
    ) -> Result<TraversalStats, String> {
        stack.clear();
        out.clear();
        let mut stats = TraversalStats::default();
        if self.nodes.is_empty() {
            return Ok(stats);
        }
        stack.push(0);
        while let Some(i) = stack.pop() {
            // A visit means one stack pop, including a node rejected by its own bounds.
            stats.pop_visits += 1;
            stats.bounds_tests += 1;
            let n = &self.nodes[i as usize];
            if n.bounds.segment(a, b).is_none() {
                continue;
            }
            if let (Some(l), Some(r)) = (n.left, n.right) {
                stats.bounds_tests += 2;
                let dl = self.nodes[l as usize].bounds.segment(a, b);
                let dr = self.nodes[r as usize].bounds.segment(a, b);
                match (dl, dr) {
                    (Some(x), Some(y)) => {
                        if x <= y {
                            stack.push(r);
                            stack.push(l);
                        } else {
                            stack.push(l);
                            stack.push(r);
                        }
                    }
                    (Some(_), None) => stack.push(l),
                    (None, Some(_)) => stack.push(r),
                    _ => {}
                }
            } else {
                if out
                    .len()
                    .checked_add(n.count as usize)
                    .ok_or("candidate overflow")?
                    > limit
                {
                    return Err("candidate capacity exceeded".into());
                }
                out.extend_from_slice(&self.order[n.first as usize..(n.first + n.count) as usize]);
            }
        }
        Ok(stats)
    }
}
