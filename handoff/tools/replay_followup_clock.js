  // Each later round overlaps in the held target view. Sample its recorded
  // incoming and penetration positions slowly enough to survive a render frame;
  // never restart the director or queue rounds behind earlier hits.
  var followupReplayTimings = new WeakMap();
  function followupReplayTiming(e) {
    let timing = followupReplayTimings.get(e);
    if (!timing) {
      const approach = e.flight.length && e.launch_s < e.contact_s ? .18 : 0;
      const end = Math.max(e.contact_s, ...e.traces.map(t => t.end_s), ...(e.bursts || []).map(b => b.time_s));
      // Reserve time for the actual core, then the fuze, then fragments. A single
      // linear contact->last-fragment scale made millisecond core paths vanish.
      const knots = [[0, approach ? e.launch_s : e.contact_s]];
      let film = 0, physical = e.contact_s;
      if (approach) knots.push([film = approach, physical]);
      const add = (p, duration) => {
        if (p > physical + 1e-10) knots.push([film += duration, physical = p]);
      };
      add(Math.max(e.contact_s, ...e.traces.filter(t => t.body).map(t => t.end_s)), .28);
      add(Math.max(physical, ...(e.bursts || []).map(b => b.time_s)), .18);
      add(end, .34);
      timing = Object.freeze({knots, duration: film, contactFilm: approach, end});
      followupReplayTimings.set(e, timing);
    }
    return timing;
  }
  function localReplayPhysical(e, filmS) {
    const {knots, duration, end} = followupReplayTiming(e), t = Math.max(0, filmS);
    for (let i = 1; i < knots.length; i++) {
      const a = knots[i - 1], b = knots[i];
      if (t < b[0]) return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
    }
    return end + t - duration;
  }
  function localReplaySpan(e) {
    const {duration, end} = followupReplayTiming(e);
    return duration + Math.max(0, e.physicalEnd - end);
  }
