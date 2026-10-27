// R8.1 M8 source-constructor review. This file changes no mesh or engineering value.
// The registry builder pins original descriptor hashes, declaration keys and ranges.
import { triangulate } from '../../client/web/src/gfx/geo.js';

export const M8_ASSET_HASH = '00085237be905a3dc7fd9b9504aacb00beb866f3ff3d05185d5780f0a6516942';
const SOURCE_PREFIX = `visual:${M8_ASSET_HASH}:part:`;
const ARMOR = (armorRef, boundarySide = 'outer', reason = 'Reviewed M8 constructor feature') =>
  ({ armorRef, boundarySide, reason });
const MODULE = (moduleRef, reason) => ({ moduleRef, reason });
const FITTING = reason => ({ decoration: true, reason });
const UNKNOWN = reason => ({ armorRef: null, boundarySide: null, reason });

function hullFeature(feature) {
  const cap = /^loft:cap:([01]):fan:\d+$/.exec(feature);
  if (cap) return ARMOR(cap[1] === '0' ? 'hull_rear' : 'hull_lower_front');
  const match = /^loft:band:(\d+):edge:(\d+)$/.exec(feature);
  if (!match) return null;
  const band = Number(match[1]), edge = Number(match[2]);
  if (band > 7 || edge > 15) return null;
  // The nine original sec/section_ring stations run from rear cap to nose.
  // Ring 0->1 is the rear closure; bands 5, 6 and 7 form the upper,
  // middle and lower nose transitions. Edge ordinals retain the authored
  // central tub, sponson underside, lower side, upper side and roof order.
  if (band === 0) return ARMOR('hull_rear');
  if ([0, 15].includes(edge)) return ARMOR(band === 7 ? 'hull_lower_front' : 'hull_floor');
  if ([7, 8].includes(edge)) {
    return ARMOR(band === 5 ? 'hull_upper_front' : band >= 6 ? 'hull_middle_front' : 'hull_roof');
  }
  if ([2, 4, 11, 13].includes(edge)) return ARMOR('hull_floor');
  // Edges 3/12 are the returned inside faces of the 3 cm visual outer
  // lower-side folds; pair them with edges 5/10 in the same authored layer.
  if ([1, 3, 5].includes(edge)) return ARMOR('hull_side_low_r', edge === 3 ? 'inner' : 'outer');
  if ([10, 12, 14].includes(edge)) return ARMOR('hull_side_low_l', edge === 12 ? 'inner' : 'outer');
  if (edge === 6) return ARMOR('hull_side_r');
  if (edge === 9) return ARMOR('hull_side_l');
  return null;
}

function turretSector(edge) {
  // Original 36-point plan: point 0 is front, 9 right, 18 rear, 27 left.
  if (edge <= 4 || edge >= 31) return 'turret_front';
  if (edge <= 12) return 'turret_side_r';
  if (edge <= 22) return 'turret_rear';
  return 'turret_side_l';
}

function hollowPlan(part) {
  if (part.type !== 'plan' || part.outline.length !== 36 || part.hollow !== 0.04 ||
      part.y0 !== 1.5 || part.y1 !== 2) throw Error('M8 open turret descriptor changed');
  // geo.js plan(): bottom, inset floor, interleaved inside-wall/rim per edge,
  // then outside-wall per edge. The open top emits no lid triangles.
  const floorCount = triangulate(part.outline).length;
  if (floorCount !== 34) throw Error('M8 hollow-plan triangulation changed');
  const out = [], add = (feature, count, binding) => {
    out.push({ first: out.reduce((sum, r) => sum + r.count, 0), count, feature, ...binding });
  };
  // There is no accepted turret-floor engineering reference. Retain the
  // unreviewed floor instead of inventing thickness or borrowing hull armor.
  add('plan:bottom', floorCount, UNKNOWN('No accepted M8 turret-floor resistance reference'));
  add('plan:floor', floorCount, UNKNOWN('No accepted M8 turret-floor resistance reference'));
  for (let edge = 0; edge < 36; edge++) {
    add(`plan:inner:${edge}`, 2, ARMOR(turretSector(edge), 'inner'));
    add(`plan:rim:${edge}`, 2, ARMOR(turretSector(edge), 'reveal'));
  }
  for (let edge = 0; edge < 36; edge++) {
    add(`plan:outer:${edge}`, 2, ARMOR(turretSector(edge), 'outer'));
  }
  return out;
}

function reviewedPartBinding(ordinal, feature, mirror) {
  if (ordinal === 0) return hullFeature(feature);
  if ([1, 2].includes(ordinal)) return FITTING('Original thin external mudguard/fender; no separate armor layer');
  if (ordinal === 3) {
    const side = feature === 'box:+x' ? 'outer' : feature === 'box:-x' ? 'inner' : 'reveal';
    return ARMOR(mirror === 0 ? 'hull_side_low_r' : 'hull_side_low_l', side);
  }
  if ([4, 5].includes(ordinal)) return FITTING('Original external hull-side rails; no authored extra armor');
  if (ordinal === 6) {
    const side = feature === 'box:+z' ? 'outer' : feature === 'box:-z' ? 'inner' : 'reveal';
    return ARMOR('hull_upper_front', side, 'Original mirrored armored driver vision lid');
  }
  if (ordinal === 7) return FITTING('Black driver vision-slot insert; hull/lid armor remains separately bound');
  if ([8, 9].includes(ordinal)) return FITTING('Original headlamp/lamp stem; no armor engineering layer');
  if ([10, 11].includes(ordinal)) return FITTING('Original bumper and tow fittings; no armor engineering layer');
  if (ordinal === 12) return FITTING('Original shallow engine grille overlay on the independently bound roof');
  if ([13, 14, 15].includes(ordinal)) return FITTING('Original rear lamp, roof hinge or tow fitting');
  if ([16, 17].includes(ordinal)) return MODULE('radio', 'Original aerial base and aerial source parts');
  if ([19, 20, 21].includes(ordinal)) {
    return MODULE('mg:aa_m2:receiver', 'Original AA machine-gun skate rail and supporting posts');
  }
  if (ordinal === 22) {
    const side = feature === 'box:+z' ? 'outer' : feature === 'box:-z' ? 'inner' : 'reveal';
    return ARMOR('gun_shield', side, 'Original shield front/back/reveal are one authored material region');
  }
  if ([23, 24].includes(ordinal)) return MODULE('breech', 'Original main-gun trunnion and fixed receiver/cradle');
  if (ordinal === 25) return MODULE('gun_barrel', 'Original main-gun barrel-root sleeve');
  if (ordinal === 28) return MODULE('mg:coax_m1919:barrel', 'Original coaxial M1919 tube source');
  if (ordinal === 30) return FITTING('Original small black gun-sight/optic tube; no authored armor layer');
  return null;
}

/** Review one immutable original declaration; caller merges only explicit returned runs. */
export function reviewM8Declaration(d, part, context = {}) {
  if (d.resistancePolicy !== 'unsupported') return null;
  const source = d.sourceKey || '';
  const match = source.startsWith(SOURCE_PREFIX) && /:part:(\d+)(?::mirror:([01]))?$/.exec(source);
  if (match) {
    const ordinal = Number(match[1]), mirror = match[2] == null ? null : Number(match[2]);
    if (!part) throw Error('M8 reviewed source descriptor absent');
    if (ordinal === 18) {
      if (d.count !== 284) throw Error('M8 hollow-plan range changed');
      return hollowPlan(part).map(r => ({ ...r, first: d.first + r.first }));
    }
    if ([3, 6].includes(ordinal) && d.count === 12) {
      if (part.type !== 'box') throw Error('M8 armored plate box descriptor changed');
      return ['+z', '-z', '+x', '-x', '+y', '-y'].map((face, index) => {
        const feature = `box:${face}`;
        return { first: d.first + index * 2, count: 2, feature,
          ...reviewedPartBinding(ordinal, feature, mirror) };
      });
    }
    const feature = d.owners?.find(o => o.kind === 'source_constructor')?.featureKey || 'unreviewed';
    const binding = reviewedPartBinding(ordinal, feature, mirror);
    return binding ? [{ first: d.first, count: d.count, feature, ...binding }] : null;
  }
  if (context.catalog?.specId !== 'us_m8') return null;
  // These exact generated nodes are fixed by this packet's build and declaration
  // hashes. Their source functions establish the component owner directly.
  const base = 'mesh:vehicle/0:body/2:turret_0/';
  let binding;
  if (d.meshKey === base + '2:mg_post' || d.meshKey === base + '3:mg_gun') {
    binding = MODULE('mg:aa_m2:receiver', 'tankmodel.js roof-pintle AA M2 post and complete gun assembly');
  } else if (d.meshKey === base + '4:interior') {
    // buildInterior adds geo.wheel (14 rim limbs, 3 spokes, handle, axle,
    // pinion box) to this node. It is the gun's elevating handwheel; M8's
    // accepted anatomy has no separate vertical-drive module.
    const counts = new Map([[0, 560], [560, 120], [680, 40], [720, 32], [752, 12]]);
    if (counts.get(d.first) !== d.count) throw Error('M8 elevating-wheel source range changed');
    binding = MODULE('breech', 'interior.js breechGeometry wheel/pinion belongs to the main-gun functional assembly');
  }
  return binding ? [{ first: d.first, count: d.count, feature: 'reviewed_generated_component', ...binding }] : null;
}
