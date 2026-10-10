// A cue follows a resolved impact, never a bounding-box prediction or a damage threshold.
const HIT_OUTCOMES = new Set(['stopped', 'shattered', 'ricochet', 'penetrated', 'overpressure', 'blast', 'external', 'unarmoured', 'nopen', 'pen', 'kill', 'track']);

export function showHit(hud, report, killed = false, label = '命中') {
  const outcome = typeof report === 'string' ? report : report?.outcome ?? report?.result;
  if (!HIT_OUTCOMES.has(outcome)) return;
  const destroyed = killed || report?.caps?.destroyed || outcome === 'kill';
  const through = outcome === 'penetrated' || outcome === 'overpressure' || outcome === 'pen';
  const damaged = (report?.modules?.length || report?.crew?.length) && ['blast', 'external', 'unarmoured'].includes(outcome);
  const kind = destroyed ? 'kill' : through || damaged ? 'pen' : outcome === 'ricochet' ? 'ricochet' : 'nopen';
  hud.hitMarker(report?.title || label, kind);
}
