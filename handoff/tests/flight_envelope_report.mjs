import fs from 'node:fs';
import path from 'node:path';

// Compare scenario measurements, without inventing acceptance limits.
// node handoff/tests/flight_envelope_report.mjs --before baseline.json --after candidate.json [--json analysis.json]
const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const name = process.argv[i];
  if (!['--before', '--after', '--json'].includes(name) || !process.argv[i + 1]) throw new Error('Expected --before PATH --after PATH [--json PATH]');
  options[name.slice(2)] = path.resolve(process.argv[++i]);
}
if (!options.before || !options.after) throw new Error('Both --before and --after are required');
const before = JSON.parse(fs.readFileSync(options.before, 'utf8'));
const after = JSON.parse(fs.readFileSync(options.after, 'utf8'));
const byId = report => new Map(report.results.map(result => [result.id, result]));
const old = byId(before), current = byId(after);
if (old.size !== before.results.length || current.size !== after.results.length) throw new Error('Duplicate scenario IDs');
const missingBefore = [...current.keys()].filter(id => !old.has(id));
const missingAfter = [...old.keys()].filter(id => !current.has(id));
if (missingBefore.length || missingAfter.length) throw new Error(`Unpaired scenarios: ${JSON.stringify({ missingBefore, missingAfter })}`);
for (const r of after.results) {
  const b = old.get(r.id);
  if (JSON.stringify(b.settings) !== JSON.stringify(r.settings)) throw new Error(`Scenario settings changed: ${r.id}`);
  for (const field of ['maxG', 'minG', 'maxAoA_rad', 'minAoA_rad']) {
    if (b.limits[field] !== r.limits[field]) throw new Error(`Comparison limit changed: ${r.id} ${field}`);
  }
}
const round = n => Number.isFinite(n) ? +n.toFixed(6) : null;
const metrics = ['positiveG', 'negativeG', 'positiveAoA', 'negativeAoA'];
const extent = (r, metric) => Math.max(0, ({
  positiveG: r.maxG - r.limits.maxG,
  negativeG: r.limits.minG - r.minG,
  positiveAoA: r.maxAoA_deg - r.limits.maxAoA_deg,
  negativeAoA: r.limits.minAoA_deg - r.minAoA_deg
})[metric]);
const describe = (r, metric) => ({ id: r.id, extent: round(extent(r, metric)), duration_s: r.beyondLimitsDuration_s[metric], G: [r.minG, r.maxG], AoA_deg: [r.minAoA_deg, r.maxAoA_deg] });
function envelope(rows) {
  return Object.fromEntries(metrics.map(metric => {
    const worstExtent = [...rows].sort((a, b) => extent(b, metric) - extent(a, metric))[0];
    const longest = [...rows].sort((a, b) => b.beyondLimitsDuration_s[metric] - a.beyondLimitsDuration_s[metric])[0];
    return [metric, {
      unit: metric.includes('AoA') ? 'degrees' : 'G',
      scenariosOverLimit: rows.filter(r => r.beyondLimitsDuration_s[metric] > 0).length,
      sumDuration_s: round(rows.reduce((sum, r) => sum + r.beyondLimitsDuration_s[metric], 0)),
      worstExtent: worstExtent ? describe(worstExtent, metric) : null,
      longest: longest ? describe(longest, metric) : null
    }];
  }));
}
const protectedRows = rows => rows.filter(r => r.settings.instructor && r.settings.protection);
const protectedBefore = protectedRows(before.results), protectedAfter = protectedRows(after.results);
const groups = [...new Set(protectedAfter.map(r => r.group))];
const physicalFields = ['initial', 'inversionSetup', 'measuredDuration_s', 'finite', 'crashed', 'crashedAt_s', 'completedRequestedSteps', 'minG', 'maxG', 'minAoA_deg', 'maxAoA_deg', 'positiveGExcess', 'negativeGExcess', 'beyondLimitsDuration_s', 'tailVariation', 'tracking', 'final'];
const controls = after.results.filter(r => !r.settings.instructor || !r.settings.protection).map(r => ({
  id: r.id,
  changedPhysicalFields: physicalFields.filter(field => JSON.stringify(old.get(r.id)[field]) !== JSON.stringify(r[field]))
}));
const compact = r => ({ G: [r.minG, r.maxG], AoA_deg: [r.minAoA_deg, r.maxAoA_deg], beyondLimitsDuration_s: r.beyondLimitsDuration_s, tailG: r.tailVariation.loadG });
const fullStickIntact = after.results.filter(r => r.group === 'upright-matrix' && r.settings.damageName === 'intact' && r.kind.startsWith('full-')).map(r => ({
  id: r.id, type: r.type, speed_m_s: r.settings.speed_m_s, kind: r.kind,
  limits: { maxG: r.limits.maxG, minG: r.limits.minG, maxAoA_deg: r.limits.maxAoA_deg, minAoA_deg: r.limits.minAoA_deg },
  before: compact(old.get(r.id)), after: compact(r)
}));
const tracking = after.results.filter(r => r.tracking).map(r => ({
  id: r.id, type: r.type, before: old.get(r.id).tracking, after: r.tracking,
  captureDelta_s: old.get(r.id).tracking.firstWithin3Degrees_s !== null && r.tracking.firstWithin3Degrees_s !== null ? round(r.tracking.firstWithin3Degrees_s - old.get(r.id).tracking.firstWithin3Degrees_s) : null,
  held1sCaptureDelta_s: Number.isFinite(old.get(r.id).tracking.firstWithin3DegreesHeld1s_s) && Number.isFinite(r.tracking.firstWithin3DegreesHeld1s_s) ? round(r.tracking.firstWithin3DegreesHeld1s_s - old.get(r.id).tracking.firstWithin3DegreesHeld1s_s) : null,
  tailRmsErrorDelta_deg: round(r.tracking.last10sRmsError_deg - old.get(r.id).tracking.last10sRmsError_deg)
}));
const tailChanges = protectedAfter.map(r => ({
  id: r.id,
  loadG: { before: old.get(r.id).tailVariation.loadG, after: r.tailVariation.loadG, rmsDelta: round(r.tailVariation.loadG.centeredRms - old.get(r.id).tailVariation.loadG.centeredRms) },
  aoa_deg: { before: old.get(r.id).tailVariation.aoa_deg, after: r.tailVariation.aoa_deg, rmsDelta: round(r.tailVariation.aoa_deg.centeredRms - old.get(r.id).tailVariation.aoa_deg.centeredRms) },
  pitchRate_rad_s: { before: old.get(r.id).tailVariation.pitchRate_rad_s, after: r.tailVariation.pitchRate_rad_s }
})).sort((a, b) => b.loadG.rmsDelta - a.loadG.rmsDelta);
const analysis = {
  purpose: 'Paired characterization; tail variation also includes trajectory trends and does not alone establish an oscillation frequency or instability',
  before: { file: options.before, engine: before.engine, summary: before.summary },
  after: { file: options.after, engine: after.engine, summary: after.summary },
  comparability: { pairedScenarios: after.results.length, equalRecordedSettingsAndLimits: true, controlsComparedFields: physicalFields, controlsComparisonPrecision: 'Exact equality of recorded JSON aggregates, rounded to six decimals; not a per-step bitwise trajectory comparison' },
  protectedEnvelope: { scenarios: protectedAfter.length, before: envelope(protectedBefore), after: envelope(protectedAfter) },
  byProtectedGroup: Object.fromEntries(groups.map(group => [group, { before: envelope(protectedBefore.filter(r => r.group === group)), after: envelope(protectedAfter.filter(r => r.group === group)) }])),
  fullStickIntact,
  tracking,
  controls: { scenarios: controls.length, equalPhysicalRecords: controls.filter(r => r.changedPhysicalFields.length === 0).length, results: controls },
  tailChanges
};
if (options.json) {
  fs.mkdirSync(path.dirname(options.json), { recursive: true });
  fs.writeFileSync(options.json, JSON.stringify(analysis, null, 2) + '\n');
  console.log(JSON.stringify({ output: options.json, pairedScenarios: after.results.length, controlsEqual: analysis.controls.equalPhysicalRecords, controls: controls.length }));
} else {
  const f = n => n == null ? '未捕获' : Number(n).toFixed(3);
  const lines = [
    `Flight envelope ${before.engine.version} → ${after.engine.version}: ${after.results.length} paired scenarios`,
    '',
    `After: finite ${after.summary.finite}/${after.summary.scenarios}; completed ${after.summary.completedRequestedSteps}; crashed ${after.summary.crashed}; inverted setup ${after.summary.inversionSetupsReached}/${after.summary.inversionSetupsRequested}.`,
    `Off controls: ${analysis.controls.equalPhysicalRecords}/${controls.length} identical recorded physical aggregates (six decimals, not a per-step bitwise comparison).`,
    '',
    '| Protected limit | Worst excess before → after | After duration at worst excess | Longest after duration |',
    '| --- | --- | --- | --- |'
  ];
  for (const metric of metrics) {
    const b = analysis.protectedEnvelope.before[metric], a = analysis.protectedEnvelope.after[metric];
    lines.push(`| ${metric} | ${f(b.worstExtent.extent)} → ${f(a.worstExtent.extent)} ${a.unit} | ${f(a.worstExtent.duration_s)} s (${a.worstExtent.id}) | ${f(a.longest.duration_s)} s (${a.longest.id}) |`);
  }
  lines.push('', '| Intact full-stick | Pull max G / AoA° | Push min G / AoA° | Over-limit duration G+ / G− / AoA+ / AoA− (pull; push) |', '| --- | --- | --- | --- |');
  for (const pull of fullStickIntact.filter(r => r.kind === 'full-pull')) {
    const push = fullStickIntact.find(r => r.type === pull.type && r.speed_m_s === pull.speed_m_s && r.kind === 'full-push');
    const durations = r => metrics.map(m => f(r.after.beyondLimitsDuration_s[m])).join(' / ');
    lines.push(`| ${pull.type} @ ${pull.speed_m_s} m/s | ${f(pull.after.G[1])} / ${f(pull.after.AoA_deg[1])} | ${f(push.after.G[0])} / ${f(push.after.AoA_deg[0])} | ${durations(pull)}; ${durations(push)} |`);
  }
  lines.push('', '| 60° tracking | First ≤3° before → after (s) | ≤3° held 1 s: interval start before → after (s) | Last 10 s error RMS before → after (°) |', '| --- | --- | --- | --- |');
  for (const r of tracking) lines.push(`| ${r.type} | ${f(r.before.firstWithin3Degrees_s)} → ${f(r.after.firstWithin3Degrees_s)} | ${f(r.before.firstWithin3DegreesHeld1s_s)} → ${f(r.after.firstWithin3DegreesHeld1s_s)} | ${f(r.before.last10sRmsError_deg)} → ${f(r.after.last10sRmsError_deg)} |`);
  lines.push('', 'Largest tail G RMS increases (last 3 s; includes trajectory trends):', '', '| Scenario | G RMS before → after | G span before → after | AoA RMS before → after (°) |', '| --- | --- | --- | --- |');
  for (const r of tailChanges.slice(0, 8)) lines.push(`| ${r.id} | ${f(r.loadG.before.centeredRms)} → ${f(r.loadG.after.centeredRms)} | ${f(r.loadG.before.span)} → ${f(r.loadG.after.span)} | ${f(r.aoa_deg.before.centeredRms)} → ${f(r.aoa_deg.after.centeredRms)} |`);
  process.stdout.write(lines.join('\n') + '\n');
}
