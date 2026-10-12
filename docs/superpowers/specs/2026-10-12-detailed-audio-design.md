# Detailed TankForge audio design — 2026-10-12

The requested result is distinct weapon and engine identities, ammunition-aware impacts and explosions, directional shell/missile flight, and reusable loading stages: **拿炮弹 → 装填 → 装填完毕闭锁 (grab → load → lock)**. German, Soviet and US manual styles share stage clips across different loading durations; physical mechanism takes precedence over regional style. Production uses **Sound Effects V2 (`eleven_text_to_sound_v2`)**, freshly verified against the official convert enum and [model overview](https://elevenlabs.io/docs/overview/models). Preparation has made no additional call. The user has authorized implementation and this three-stage regional design; Root selects each bounded generation batch after internal review.

Source inventory and exact call sites: [audio-detailed-inventory-2026-10-12.md](../../audio-detailed-inventory-2026-10-12.md). Preserve the schema-1 eleven-slot manifest and successful pilot history unchanged. The pilot is a generic 88 mm comparison take, not an automatically approved exact historical weapon recording.

## Bank structure and identity

Create a schema-2 catalog and a separate profile-binding manifest. An entry specifies stable cue ID, source evidence, moment, prompt ≤450 characters, model, duration 0.5–30 seconds, loop, per-cue prompt influence, take number, processing preset, recipe/phase and review state. Bind by **actual gun ID / MG ID / missile ID**, with emitter instance separate from weapon identity. Bind engines through the 15 evidence-labelled profiles in the inventory, preserving real RPM/load parameters. A profile may be shared across platforms while its numerical tuning remains vehicle-specific.

The 39 gun/launcher IDs map to 23 named conventional-cannon attack families, 5 conventional automatic-gun families, 2 custom rotary families, 4 launch families, and the KPVT MG family. Intentional sharing: the two 50 mm KwK 39 definitions share attack texture; KDA 35 / Gepard share attack texture; `kpvt_145` / `kpvt` share a report; both TT-250 rails share launch/motor. M1A1/M1A2/M7 and the named 75 mm guns retain distinct bindings. `gun_75`, generated designer guns and `fun_hexa` use explicit generic light/medium/heavy families, not a guessed historical gun name.

Preserve transplanted gun provenance and designer engine kind through packing. Host vehicle ID must not overwrite a weapon's identity. Exact-name generated sounds are interpreted game assets, not claimed authentic recordings. Unknown/conflicting engine identity stays labelled generic/neutral; resolve Puma metadata before an exact Tatra prompt or binding. Do not add gas-turbine assets without source content.

An intentionally authored generic custom-gun binding is legitimate. Missing, unreviewed or still-decoding assets are silent; **never chain a different sound as a substitute**. Do not introduce runtime oscillators to stand in for the new generated bank. Existing legacy code remains until the bank's affected moments are ready to migrate atomically; existing deterministic state tones are a separate existing feature.

## Concrete candidate envelope

This is a planning ceiling, not a request to generate everything. Initial passes buy one candidate where possible; additional variants are individually budgeted after listening. No automatic retry or credit reserve. Existing pilot cost is excluded.

| Group / cue IDs | Planned raw requests | Requested seconds | Estimated credits at 40/s |
|---|---:|---:|---:|
| 23 conventional attacks, take 1–2, 2 s each | 46 | 92 | 3,680 |
| `72k_25`, `kda_35`, `flak38_20`, `mk103_30`, `kwk38_20`; 3 × 1.2 s isolated reports | 15 | 18 | 720 |
| 10 MG identities; 3 × 1.2 s isolated reports | 30 | 36 | 1,440 |
| Two Oplot families: 4 s firing loop + 1 s spin-up + 1 s stop | 6 | 12 | 480 |
| TOW / Konkurs / Kornet / TT-250 launches; 2 × 1.5 s | 8 | 12 | 480 |
| Four missile/rocket motor loops; 4 s each | 4 | 16 | 640 |
| 15 engine families: idle/mid/high 4 s, load bed 3 s, start 2 s, stop 1 s | 90 | 270 | 10,800 |
| `track_light`, `track_medium`, `track_heavy`, `wheel_road`, `surface_soft`, `surface_gravel`; 5 s each | 6 | 30 | 1,200 |
| `stopped`, `penetrated`, `ricochet`, `shattered` attack layers; 2 × 0.75 s | 8 | 6 | 240 |
| `steel`, `aluminium`, `composite`, `earth_gravel` tails; 2 × 1.5 s | 8 | 12 | 480 |
| `armour_spall`, `metal_debris`, `earth_debris`; 2 × 1 s | 6 | 6 | 240 |
| `heat_small`, `heat_large`; 2 × 1.5 s | 4 | 6 | 240 |
| `internal_filler_small`, `internal_filler_medium`; 2 × 1 s | 4 | 4 | 160 |
| Explosive mass classes: micro 0.75 s, small 2 s, medium 3 s, large 4 s, very-heavy 5 s; 2 takes each | 10 | 29.5 | 1,180 |
| Confirmed ammo cookoff; 2 × 4 s | 2 | 8 | 320 |
| Small/large projectile approach and recede; 2 × 1.5 s for 4 cues | 8 | 12 | 480 |
| Small/large supersonic crack; 3 × 0.5 s | 6 | 3 | 120 |
| Small/large actual ricochet pass; 2 × 1 s | 4 | 4 | 160 |
| Light/medium/heavy ready latch, rangefinder confirmation, console action; 2 × 0.5 s | 10 | 5 | 200 |
| Generic custom-gun light/medium/heavy attacks; 2 × 2 s | 6 | 12 | 480 |
| **Non-reload subtotal** | **281** | **593.5** | **23,740** |
| German / Soviet / US reusable manual grab-load-lock stages; one take per stage | **9** | **9** | **360** |
| **Current required planning envelope** | **290** | **602.5** | **24,100** |
| Optional later unmapped generic autoloader demonstration: drive 1 s + ram 2 s + lock 1 s | **3** | **4** | **160** |
| **Envelope including the optional demonstration** | **293** | **606.5** | **24,260** |

The previous 46 nominal timing recipes / 134 source requests / 391.25 seconds / 15,650-credit reload envelope is **historical and superseded**, not a required purchase or set of delivery files. The same short manual stages now serve multiple durations. Separate-charge handling, validated mechanical assistance, automatic-feed replenishment, MG changes and launcher assemblies require mechanism evidence and separate later selections; their costs are not silently included in the nine-stage batch. The wider non-reload scope remains active, but its envelope is a planning ceiling rather than an approved all-at-once purchase.

The official [capability page](https://elevenlabs.io/docs/overview/capabilities/sound-effects) states 40 credits/s with specified duration. Estimates are not the returned charge or a dollar price. Capture only sanitized request ID and a strictly numeric `character-cost` response value in future receipts; `null` means absent/unavailable, not zero. Do not log any other headers, billing/account bodies, exceptions or key-derived value. Review per-batch totals before sending; preserve a durable attempt receipt before each chargeable invocation.

## First implementation and generation checkpoint

Checkpoint 1 is **tools / schema-2 catalog / local composition / QA only**. No `audio.js`, `main.js`, gameplay source, Cargo or browser work while the V3 gameplay writer owns that lane.

After fresh SPEC then QUALITY review, the proposed first actual slice is **nine reusable manual-stage requests / 9 requested seconds / estimated 360 credits** from `regional-reloads-v1`. Root owns the actual selection and calls; no stage has been generated. Each stage is one shot, not a repeated complete loading cycle:

| Delivery | Source requests / durations | Binding |
|---|---|---|
| German manual style | `de_manual_grab` 0.9 + `de_manual_load` 1.4 + `de_manual_lock` 0.7 s | representative `kwk36_88_l56`; prototype, regional treatment rather than an authentic recording |
| Soviet manual style | `su_manual_grab` 0.9 + `su_manual_load` 1.4 + `su_manual_lock` 0.7 s | representative `zis_s_53_85`; unitary manual category, no assignment to separate-charge weapons |
| US manual style | `us_manual_grab` 0.9 + `us_manual_load` 1.4 + `us_manual_lock` 0.7 s | representative `m3_75`; prototype, same stages reused for compatible manual weapons |

The stages total 3 seconds of source material per regional style; that total is **not the simulated reload duration** and does not prescribe fixed 3-second playback. All entries remain demo-only until audition/QA. Representative identity and loader metadata establish an authoring context, not a detailed breech mechanism or authentic acoustic reference; national style must not imply one mechanism for every weapon of that country. Optional separate-charge stages remain blocked without verified action detail and explicit bindings.

`detailed-v1` retains its original bytes as a held historical demonstration/compatibility fixture. Its former nine-request / 20.7-second selection is superseded and must not be generated as the first batch. The unmapped generic automatic drive/ram/lock demonstration can be selected as a separate later three-request / 4-second / 160-credit batch after review; it is never assigned by nationality or a reload timer. The 72-K clip remains blocked. MG and engine entries remain candidates for later non-reload batches. No fixed 7.5-, 6.25- or 4-second full-cycle production files are required; the compositor remains an optional offline audition/test tool. Schema-1 slots, bounds and pilot history stay unchanged.

Prompt examples for new cues (all under 450 characters):

- Manual grab: “One-shot of a human loader taking one heavy unitary tank round from its rack inside a confined steel fighting compartment: restrained rack contact and a weighty lift. No insertion, no breech slam, no firing, no engine, no music, no voices.”
- Manual load: “One-shot of a human loader guiding and inserting one unitary tank round into the cannon breech inside a confined steel compartment: dry restrained sliding metal and a firm insertion stop. No final locking slam, no gunfire, no engine, no music, no voices.”
- Manual lock: “One-shot of the loaded tank cannon breech engaging its final lock: one distinct compact steel closure attack followed by a short natural resonance tail inside the compartment. No opening, no loading scrape, no firing, no engine, no music, no voices.”
- Auto-machine demo ram: “One-shot of generic automatic ammunition machinery moving one round into a breech on a test rig: powered mechanical travel and a firm stop, close-miked, weighty steel. No human handling, no firing, no engine, no music, no voices.”
- MG report: “Gunshot sound effect: one single MG 42 round at a firing range, recorded close beside it: instantaneous sharp crack, compact punch and a short dry mechanical snap. Documentary field sound, no burst, no explosion, no rumble swell, no debris, no music, no voices. One isolated shot.”

Use cookbook influence 0.6 for cannon/contact transients, 0.75 for small arms, 0.4 for stable beds, and 0.45 for machinery unless a measured defect justifies change. A historical mechanism claim absent from the inventory must be independently sourced before naming it in a prompt.

## Loading duration and mechanism contract

Separate `manual`, `automatic_feed`, `launcher_assembly`, `autoloader`, and `unknown` recipe kinds. Physical `autoloader` requires explicit authored evidence; none is currently assigned. Zero loaders means gunner loading with a penalty. Source-independent cycles do not establish machinery. Magazine/belt changes are different from each automatic shot's feed cycle. A launcher changes loaded tubes only after assembly exhaustion and available reserves; the 0.25 s tube-to-tube launch cooldown is not a reload.

The inventory's duration fields describe state timing, not clip identity. Missing loader roles in `us_m8`, `de_sdkfz234_2`, `de_aufkl_panther`, `de_vk1602`, `de_pzjg1` need explicit source-cycle / gunner-loading decisions; the active combat capability can add 1.6×. The 1-second TT-250 field is normally unreachable as reload because each rail carries one rocket and then becomes empty; keep it catalog-only unless a real reserve/refill path enters loading. `fun_hexa` uses layout work rather than nominal fields. Queue wait is additional silence, never “loading activity.”

Healthy nominal cycles fit 30 seconds, but actual work may not: 22 seconds can become 52.8, a 30-second belt can become 72, and a 183 mm workshop AP round needs about 132.315 seconds handling before carry/queue/damage. Repairs can stall work indefinitely. A pre-generated file cannot predict a later stall or damaged loader.

Use a small bank of concrete normal-pitch actions. Grab sounds once when the loader starts the current job. The load stage presents handling/insertion at explicit milestones of actual work; breech opening may be optional detail inside load rather than a replacement for grab. The source does not expose measured grab/insertion events, so these are presentation milestones owned by the later reload adapter, not invented authoritative simulation facts. Long cycles reuse appropriate handling variants, pauses or a separately verified sustainable handling bed; do not repeat acquisition, repeat a final ram stroke continuously, or globally stretch transients to fill the clock. Short cycles can trim/fade activity to preserve actual readiness. The first nine cues are nonlooping actions and do not pretend to be a sustainable bed.

German/Soviet/US styles are authored texture choices for compatible manual mechanisms. Unitary rounds cannot supply an unqualified separate-charge sequence. M-46 notes explicitly document separate loading; D-25T/M-62 identities and loader roles do not alone document every hand action, and T-10 mechanical assistance is not a true autoloader assignment. Verify separate projectile/charge handling and any assist operation before generating/mapping those exceptions. Transplanted weapons retain their actual mechanism and source identity regardless of the host vehicle's country.

Optional offline audition composition still renders `round(targetSeconds * sampleRate)` frames and preserves source hashes, phases and overlaps. Existing 7.5/6.25/4/52.8/72-second cases test the authoring tool; they are not required production exports or proof of runtime alignment. Reuse clips across modes and durations rather than purchasing a source waveform for every clock value.

At runtime, use the actual per-gun loading transition, work done / remaining, work rate and ready event. Grab starts only when the loader receives work; load activity follows progress and pauses/fades when work rate is zero. Queue waiting/out-of-ammo remain silent. Lock is emitted only after actual per-gun `ready` with ammunition, not from a predicted end time or a completed queue that becomes empty. Mid-cycle damage, gun change, destroyed weapon, abandoned vehicle, failed online prediction, replay replacement or session exit cancels/updates the cue through its owner.

Exact-length offline audition renders are **not evidence of live readiness alignment**. Confirmed ready triggers the lock attack at that instant; its short natural resonance tail may continue as completion feedback. Tests must prove no lock before ready, a stalled cycle has no predicted lock, acquisition does not repeat, empty jobs have no completion cue, and replacement cancels activity/tails. Damage and indefinite repairs change the work timeline without changing the bank or requesting new audio.

An optional long offline demonstration can repeat only an explicitly loopable handling bed at normal pitch while accounting for overlaps. No source generation exceeds 30 seconds. True automatic loading uses separately authored pickup/drive/ram/lock machinery when an actual mechanism is established; manual stages never become its fallback. Regional manual banks do not include automatic feed, belt/disc replenishment or launcher handling merely because their timers resemble a cannon reload.

## Event and terminal selection

Forward existing resolved data into an audio event adapter; do not change hit authority or simulation outcomes. An event carries session, presentation/live-or-replay owner, emitter instance, source weapon/shell/missile IDs, stable event/shot identity, simulation time, world position/direction/velocity, actual contact material/outcome, reported burst position/mass/inside, fragment provenance and loading state as applicable.

Muzzle report uses gun identity, not APDS/APFSDS core caliber. Automatic cadence uses the actual feed rate; rotary firing uses a continuous family loop gated by actual spin/fire state. Contact selects a short attack, actual material tail and reported debris. APHE / filler-bearing APCBC add internal blast only from a real burst. HE/HEAT explosions use actual burst/mass and have one owner; do not also fire a generic impact explosion. `miss` has no armor cue; `unarmoured` may have a body/debris cue but no invented steel plate. HESH/smoke are schema-supported but absent from loaded content, so generate no speculative stock assets. ERA material alone is not a detonation.

Mass classes use **reported explosive kg**, not total missile mass: micro (0<kg<0.05), small [0.05,0.25), medium [0.25,1), large [1,5), very-heavy ≥5. Keep semantic cookoff distinct; do not infer it from HUD “kill.” Gain/body can vary continuously inside a class. Authoritative `bursts` and mechanism events outrank cosmetic impact paths. Design adapter `bursts: []` means no invented burst.

Remote exact identity requires protocol work after the gameplay lane clears: cannon Fire lacks gun instance, remote MG discharge is not broadcast, Damage lacks shot correlation. Define stable identities and deduplicate predicted/local/authoritative presentation. Do not manufacture remote firing from snapshots or apply audio twice to one contact.

## Spatial rendering and flight

Use one consistent 3D listener at the actual camera, with forward/up and velocity; own turret/cockpit perspective is an explicit local mix treatment. World sources pass position, direction, velocity and emission time. UI confirmations use a separate non-positional bus. Directional muzzle cones are authored per family; distance changes attenuation/filter/delay, never weapon identity. Remove positive far-distance gain floors. Do not claim acoustic occlusion from a house label without a supported geometry/material rule.

Schedule a world report at emission time + distance/343 m/s, aligned to AudioContext time through a session clock; own close feedback has naturally negligible delay. Delayed cues have cancellation/session IDs and a bounded queue. Moving vehicles and missile motors update spatial pose from actual state. For subsonic continuous emitters use Doppler `(c - listenerVelocity·u) / (c - sourceVelocity·u)`, with `u` from source to listener, safe bounds and smoothing; RPM pitch and Doppler remain separate factors.

Supersonic projectiles use actual flight segments and a separate shockwave cue. Do not apply the subsonic denominator at or beyond sound speed. Determine retarded arrival from `t_emit + distance/c`; a crack exists only for a segment moving faster than sound whose wavefront reaches the listener. Track earliest applicable cone arrival and emit once per projectile/listener pass; the ordinary body pass uses actual approach/closest/recede phases. Near-miss distance controls audibility. Maintain one-time per-projectile flags, separate firing report versus crack, and stop the body sound on actual removal. Replay illustrative straight approach rays must not create a measured Mach crack.

## Engines, mix, memory and teardown

Each audible vehicle rig owns idle/mid/high loops and a load layer; only the two neighboring RPM bands plus load run simultaneously. Use equal-power crossfade, smoothed actual RPM/load, limited pitch range, separately timed start/stop, and actual engine damage/running state. Turning tracks use both track-side motion, not only longitudinal speed; wheeled vehicles do not play a steel track loop. Terrain layers follow actual terrain IDs. Nearby rigs share decoded family buffers, not source nodes.

World emitters are mastered mono; UI may remain stereo. Use engine/track, weapon, impact/blast, loading, UI and replay buses into a master compressor/limiter with headroom. Start from peak ceilings ≤−6 dBFS for transients and a substantially quieter sustained engine bed; preserve transient attack, do not boost all classes to identical RMS or keep the current loop gain ×3. Verify the combined mix, not only raw take peaks. Keep generation, decode, scoring and mastering local; no API key or provider calls enter the browser.

Initial hard budgets: 32 one-shot/loading chains (up to 8 reserved loading owners), 6 audible vehicle rigs × up to 3 engine + 1 running-gear sources, 4 motor rigs; **60 live sources maximum**. Quiet/distant noncritical events lose admission before player shots/completions. AudioBufferSourceNodes are recreated per start; pool gain/panner/filter chains and reuse buffers. Ended sources disconnect and release refs. Delayed queue ≤128; pass-by trackers ≤128, TTL tied to actual projectile life. No per-frame promise/decode or unbounded history.

Decoded cache ≤32 MiB and ≤96 entries, with active/pinned buffers ineligible for eviction; pressure can evict idle buffers, delay low-priority decoding or reduce audible rigs. Decode concurrency ≤2. The full raw plan is far larger than this cache; never decode the entire bank on first gesture. Pin the active tank, its weapons/reloads, common contact classes and UI moments. Reviewed encoded asset payload ceiling 24 MiB; check the actual mastered files and self-contained HTML growth rather than assume raw requested durations equal shipped duration.

Every source, loop, pending decode, delayed cue and loading controller has a vehicle/session/replay owner. Replacement stops old sources before dropping refs. Garage, pause, hidden page, destroyed/removed vehicle and session reset fade/stop the relevant rigs and cancel schedules. Resume suspended contexts through the existing user gesture. `dispose()` stops/disconnects retained nodes, clears callbacks/queues, drops buffers and closes the owned context. Replay uses a separate bus and owner; only real recorded events are restaged, and replacement/close cancels them without replaying live damage effects.

## QA and completion evidence

Apply the fetched audio handbook/cookbook/quality principles as reference, not as proof its tools exist in TankForge. Read files were `target/reference-audio-generation-skill-20261012.md`, `root-reference-README.md`, `root-reference-prompts.md`, and `root-reference-quality.md`. Existing schema-1 prompts/history remain intact. New prompts use one concrete moment/perspective/material and exclusions; gun shots are documentary attacks, not delayed cinematic booms. Small arms use ≥1.2 s source requests and first-report selection because short source requests can smear or become bursts.

Per take: decode, duration/channels, peak/RMS/clipping, first onset/count, early attack energy, tail, band balance, silence splits, low pitched glides, loop seam where applicable. Listen for one clear grab, one controlled load and a distinct final lock, with each stage usable independently. Optional audition recipes record exact frames and boundary continuity; later runtime tests prove the actual start/work/ready timeline. Never silently rank a wrong effect above a correct lower-level take. Cache re-scoring/composition is free. If the same defect repeats twice, change the prompt/recipe; do not buy automatic retries. Subjective audition remains required before marking a waveform approved.

Checkpoint 1 delivers tooling tests, dry-run budgets, immutable request/composition/QA receipts and a labelled listening set. Later runtime checks prove profile coverage, listener/delay/pass-by math, result-based impact selection, per-emitter cadence, dynamic reload pauses/completion, no duplicate predicted/authoritative cues, cache/voice budgets and teardown. Browser and native work belong to the later exclusive runtime lane. Provider origin and current terms are retained; no unsupported MIT/commercial-rights assertion is introduced.
