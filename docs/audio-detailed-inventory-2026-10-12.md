# Detailed audio inventory — 2026-10-12

Read-only inventory of `092b926e9df8f751771e7e787d48b3a87c0f4216`. Source of counts: `client/web/tools/load-data.mjs:8–40`, every selected `data/vehicles/<id>/{vehicle,weapons,engine,visual}.json`, `data/machine_guns.json`, `data/missiles.json`, and all `data/projectiles/*.json`. No Cargo, browser, build, credential import or new generation was used for this inventory.

## Coverage and evidence limits

- Garage: **43 vehicles**; **35 tracked / 8 wheeled**. The data directory has 44 vehicles; `fun_hexa` is a six-gun workshop example absent from `ORDER`.
- Stock loadouts: **39 distinct gun / launcher IDs**, including `extra_guns` and `extra_turrets`; 34 are ballistic, 5 are launcher mount IDs. Five mount IDs share four missile / rocket definitions because both TT-250 rails use one rocket.
- Machine-gun catalog: **10 IDs**. KPVT also appears as the main gun `kpvt_145` and can share the same acoustic profile.
- Loaded ammunition: **85 projectile records / 9 present kind strings**. All are loaded into the page; 73 distinct records are referenced by garage guns. Twelve additional records serve unused variants or workshop examples. Bullet definitions are also derived from the MG catalog at runtime.
- Fuel metadata: 24 `petrol`, 16 `diesel`, 3 absent. Puma has a conflict between exhaust fuel and vehicle notes. No stock or designer gas-turbine definition was found.
- `engine.json` supplies horsepower, idle/max RPM, weight, torque curve and transmission. **It has no manufacturer/model/fuel field.** A historical engine name is reported below only when vehicle notes actually name it. Numeric similarity is an acoustic grouping decision, not proof of the same engine model.
- Gun definitions identify caliber, barrel, loading cycle, automatic-feed parameters and missiles. MG definitions identify name/caliber/cyclic rate/belt data. They do **not** document bolt-locking or gas/recoil operating mechanisms; those historical claims require a separate source before entering prompts.

## Garage engine bindings

Profile IDs are proposed authoring bindings, not existing runtime properties. `generic` / `neutral` means an interpreted family; it does not claim a recording of a named engine.

| Profile | Evidence and intended character | Vehicle IDs |
|---|---|---|
| E01 `petrol_compact` | Explicit petrol, 85–160 hp; generic compact engine | `us_m8`, `de_pzjg1`, `de_flakpz38t`, `de_hetzer`, `de_hetzer_flak`, `de_hetzer_mk103`, `de_hetzer_mk103_camo`, `de_sdkfz140_1`, `de_hetzer_sdkfz1401`, `uk_cmp_portee` |
| E02 `petrol_medium` | Explicit petrol, 300 hp; model absent | `de_pz3_j`, `de_pz4_h` |
| E03 `petrol_heavy` | Explicit petrol, 690–700 hp; model absent | `de_tiger_e`, `de_panther_g`, `de_panther_f`, `de_aufkl_panther` |
| E04 `petrol_large` | Explicit petrol, 500–600 hp; model absent | `us_m4a3_75w`, `us_m4a3_76w_hvss`, `uk_cromwell_iv` |
| E05 `r975_radial` | Notes name Continental R975-C4 radial; explicit petrol | `us_m4a1_76w` |
| E06 `hl157` | Notes name Maybach HL 157 P; explicit petrol, 550 hp | `de_vk1602` |
| E07 `diesel_light` | Explicit diesel, 212–400 hp; models absent | `us_m901_itv`, `xp_kda35`, `xp_w78` |
| E08 `diesel_medium` | Explicit diesel, 375–520 hp; models absent | `su_t34_1940`, `su_t34_85`, `su_is2`, `su_t54`, `us_m10` |
| E09 `diesel_heavy` | Explicit diesel, 750–830 hp; models absent | `su_t10m`, `su_t10m_oplot23`, `de_gepard` |
| E10 `gm6046` | Notes name GM 6046 twin diesel, two 6-71s, 410 hp | `us_m4a2` |
| E11 `5tdf` | Notes name 5TDF, 700 hp; explicit diesel; fictional chassis on T-64 components | `xp_bmp_k64`, `xp_bmp_k64_atgm`, `xp_bmp_k64_kornet` |
| E12 `a401` | Notes name A-401 diesel, 415 hp | `su_att_m46` |
| E13 `steyr1500a` | Notes name Steyr 1500A V8, 85 hp; explicit petrol | `de_rso_flak`, `de_rso_pak40` |
| E14 `neutral_compact` | Interim generic: M56 notes name AOI-402-5 but fuel absent; Puma notes name Tatra 103 V12 diesel while exhaust says petrol. Resolve before exact-model prompts | `us_m56`, `de_sdkfz234_2` |
| E15 `neutral_medium` | 500 hp; fuel/model absent. Exhaust fallback infers USSR diesel for BMPT, which is not authored fuel evidence | `su_bmpt34`, `proto_a` |

All 43 IDs appear exactly once above. Shared profiles retain each vehicle's actual RPM range and load response; they do not force identical pitch or gains.

| Vehicle ID | hp | Idle → governed RPM | Exhaust fuel | Main gun ID |
|---|---:|---:|---|---|
| de_pz3_j | 300 | 800→3000 | petrol | kwk39_50_l60 |
| de_pz4_h | 300 | 800→3000 | petrol | kwk40_75_l48 |
| de_tiger_e | 690 | 800→3000 | petrol | kwk36_88_l56 |
| de_panther_g | 700 | 800→3000 | petrol | kwk42_75_l70 |
| de_panther_f | 700 | 800→3000 | petrol | kwk44_1_75_l70 |
| de_sdkfz234_2 | 210 | 600→2250 | petrol; conflict | kwk39_1 |
| su_t34_1940 | 500 | 600→1900 | diesel | l11_76 |
| su_t34_85 | 500 | 600→1900 | diesel | zis_s_53_85 |
| su_is2 | 520 | 600→2000 | diesel | d25t_122 |
| su_t10m | 750 | 600→2100 | diesel | m62_t2_122 |
| su_t10m_oplot23 | 750 | 600→2100 | diesel | m62_t2_122 |
| su_bmpt34 | 500 | 600→1800 | absent | 72k_25 |
| su_t54 | 520 | 600→2000 | diesel | d10t_100 |
| us_m8 | 110 | 550→3200 | petrol | m6_37mm |
| us_m10 | 375 | 500→2100 | diesel | m7_3in |
| us_m4a2 | 410 | 500→2900 | diesel | m3_75 |
| us_m4a3_75w | 500 | 600→2600 | petrol | m3_75 |
| us_m4a1_76w | 400 | 800→2400 | petrol | m1a1_76 |
| us_m4a3_76w_hvss | 500 | 600→2600 | petrol | m1a2_76 |
| us_m56 | 200 | 650→3200 | absent | m54_90mm |
| us_m901_itv | 212 | 600→2800 | diesel | m220_tow |
| uk_cromwell_iv | 600 | 600→2550 | petrol | qf_75_mk5 |
| xp_kda35 | 400 | 650→2600 | diesel | kda_35 |
| xp_w78 | 400 | 650→2600 | diesel | xp_78_lr |
| de_pzjg1 | 100 | 600→3000 | petrol | pak36t_47 |
| de_flakpz38t | 150 | 600→2600 | petrol | flak38_20 |
| de_hetzer | 160 | 600→2600 | petrol | pak39_75_l48 |
| de_hetzer_flak | 160 | 600→2600 | petrol | flak38_20 |
| de_rso_flak | 85 | 550→3000 | petrol | flak38_20 |
| de_rso_pak40 | 85 | 550→3000 | petrol | pak40_75 |
| de_gepard | 830 | 650→2200 | diesel | kda_35_gepard |
| uk_cmp_portee | 85 | 500→3400 | petrol | qf6pdr_mk2 |
| de_aufkl_panther | 700 | 800→3000 | petrol | kwk39_1 |
| de_vk1602 | 550 | 700→3500 | petrol | kwk39_1 |
| de_hetzer_mk103 | 160 | 600→2600 | petrol | mk103_30 |
| de_hetzer_mk103_camo | 160 | 600→2600 | petrol | mk103_30 |
| de_sdkfz140_1 | 160 | 600→2600 | petrol | kwk38_20 |
| de_hetzer_sdkfz1401 | 160 | 600→2600 | petrol | kwk38_20 |
| xp_bmp_k64 | 700 | 800→2800 | diesel | kpvt_145 |
| xp_bmp_k64_atgm | 700 | 800→2800 | diesel | 9p135_konkurs |
| xp_bmp_k64_kornet | 700 | 800→2800 | diesel | 9p163_kornet |
| su_att_m46 | 415 | 500→1700 | diesel | m46_130 |
| proto_a | 500 | 700→2600 | absent | gun_75 |

## Stock guns, feed mechanisms and launchers

`C` = trigger-controlled cannon with the stated loading cycle; `A` = authored automatic belt/clip feed; `R` = custom rotary with authored spin-up; `L` = launcher using a missile definition. Display names here expand source IDs / vehicle notes; they do not establish an authentic acoustic reference.

| Definition ID / name | mm | Source cadence | Type | Garage platforms |
|---|---:|---:|---|---|
| kwk39_50_l60 — KwK 39 L/60 | 50 | 15/min | C | de_pz3_j |
| kwk40_75_l48 — KwK 40 L/48 | 75 | 10/min | C | de_pz4_h |
| kwk36_88_l56 — KwK 36 L/56 | 88 | 8/min | C | de_tiger_e |
| kwk42_75_l70 — KwK 42 L/70 | 75 | 8/min | C | de_panther_g |
| kwk44_1_75_l70 — KwK 44/1 L/70 | 75 | 8/min | C | de_panther_f |
| kwk39_1 — KwK 39/1 | 50 | 15/min | C | de_sdkfz234_2, de_aufkl_panther, de_vk1602 |
| l11_76 — L-11 | 76.2 | 8/min | C | su_t34_1940 |
| zis_s_53_85 — ZiS-S-53 | 85 | 7.5/min | C | su_t34_85 |
| d25t_122 — D-25T | 121.92 | 2.7/min | C | su_is2 |
| m62_t2_122 — M-62-T2 | 121.92 | 4/min | C | su_t10m, su_t10m_oplot23 |
| oplot_mo_14_5x6 — Oplot-MO custom six-barrel | 14.5 | auto 10,000/min | R | su_t10m extra turret |
| oplot23_gsh6_23_custom — hypothetical Oplot23 | 23 | auto 8,000/min | R | su_t10m_oplot23 extra turret |
| 72k_25 — 72-K | 25 | auto 240/min | A | su_bmpt34 main + extra gun |
| tt250_rail_r / tt250_rail_l — TT-250 rails | 420 | 60/min each mount | L | su_bmpt34 extra guns |
| d10t_100 — D-10T | 100 | 7/min | C | su_t54 |
| m6_37mm — M6 | 37 | 20/min | C | us_m8 |
| m7_3in — M7 3-inch | 76.2 | 10/min | C | us_m10 |
| m3_75 — M3 | 75 | 12/min | C | us_m4a2, us_m4a3_75w |
| m1a1_76 — M1A1 | 76.2 | 10/min | C | us_m4a1_76w |
| m1a2_76 — M1A2 | 76.2 | 10/min | C | us_m4a3_76w_hvss |
| m54_90mm — M54 | 90 | 8/min | C | us_m56 |
| m220_tow — M220 | 152 | 5/min | L | us_m901_itv |
| qf_75_mk5 — QF 75 mm | 75 | 12/min | C | uk_cromwell_iv |
| kda_35 — KDA | 35 | auto 550/min | A | xp_kda35 |
| xp_78_lr — experimental 78 mm | 78 | 12/min | C | xp_w78 |
| pak36t_47 — PaK 36(t) | 47 | 13/min | C | de_pzjg1 |
| flak38_20 — FlaK 38 | 20 | auto 420/min | A | de_flakpz38t, de_hetzer_flak, de_rso_flak |
| pak39_75_l48 — PaK 39 L/48 | 75 | 8/min | C | de_hetzer |
| pak40_75 — PaK 40 | 75 | 10/min | C | de_rso_pak40 |
| kda_35_gepard — twin KDA | 35 | auto 550/min per gun | A | de_gepard main + extra gun |
| qf6pdr_mk2 — QF 6-pdr Mk II | 57 | 15/min | C | uk_cmp_portee |
| mk103_30 — MK 103 | 30 | auto 400/min | A | de_hetzer_mk103, de_hetzer_mk103_camo |
| kwk38_20 — KwK 38 | 20 | auto 450/min | A | de_sdkfz140_1, de_hetzer_sdkfz1401 |
| kpvt_145 — KPVT main mount | 14.5 | auto 600/min | A | xp_bmp_k64 |
| 9p135_konkurs — 9P135 | 135 | 3/min | L | xp_bmp_k64_atgm |
| 9p163_kornet — 9P163 | 152 | 4/min | L | xp_bmp_k64_kornet |
| m46_130 — M-46 | 130 | 6/min | C | su_att_m46 |
| gun_75 — generic prototype cannon | 75 | 8/min | C | proto_a |

The two TT-250 rail IDs are counted individually in the 39. Oplot-MO has a conflicting nominal `rounds_per_min=3000` versus `autocannon.rate_rpm=10000`; the runtime automatic feed uses the latter. Its APS rate is also 10,000/min. Oplot23 has 8,000/min feed and APS settings. Both use `spin_up_s=0.35`; audio must follow actual spin/firing state instead of spawning a sample per bullet at 133–167 Hz. These are authored custom/hypothetical weapons, not claims about an issued historical configuration.

| MG catalog ID / exact name | mm | Cyclic rate / min | Muzzle m/s | Proposed binding |
|---|---:|---:|---:|---|
| kpvt — KPVT (14.5 mm) | 14.5 | 600 | 1000 | shared with kpvt_145 |
| mg34 — MG 34 (7.92 mm) | 7.92 | 850 | 755 | dedicated MG 34 profile |
| dt — DT (7.62 mm) | 7.62 | 600 | 840 | dedicated DT profile |
| sgmt — SGMT (7.62 mm) | 7.62 | 650 | 800 | dedicated SGMT profile |
| dshk — DShK (12.7 mm) | 12.7 | 600 | 850 | dedicated DShK profile |
| m1919a4 — M1919A4 (.30) | 7.62 | 500 | 853 | dedicated M1919A4 profile |
| m2hb — M2HB (.50) | 12.7 | 520 | 890 | dedicated M2HB profile |
| besa — Besa (7.92 mm) | 7.92 | 700 | 823 | dedicated Besa profile |
| mg42 — MG 42 (7.92 mm) | 7.92 | 1200 | 755 | dedicated MG 42 profile |
| mg_proto — Prototype MG (7.62 mm) | 7.62 | 600 | 830 | generic original-design profile |

All MGs have authored belt capacity, reload and heat behavior. Keep one-round assets separate from runtime cadence. Do not prompt a multi-round burst for each emitted round.

| Missile / rocket ID | Name | Guidance | Launch → max m/s | Boost / burn s | Warhead |
|---|---|---|---|---|---|
| bgm71a_tow | BGM-71A TOW | saclos | 70→300 | 1.6 / 1.6 | heat_152_tow |
| tt250_rocket | TT-250 tank torpedo | none | 60→135 | 1 / 2.5 | he_420_tt250 |
| 9m113_konkurs | 9M113 Konkurs | saclos | 80→208 | 1.2 / 2 | heat_135_konkurs |
| 9m133_kornet | 9M133 Kornet | saclos | 90→300 | 1.5 / 2.5 | heat_152_kornet |

These are the actual game definitions, not measured recordings. The game uses the same `saclos` guidance value for the three guided missiles; do not invent wire/laser-specific runtime sound from it. Launch attack and continuous motor are separate cues. Guidance itself does not justify an audible guidance tone.

## Ammunition and terminal mechanisms

`kind` is canonical. Name prefixes are insufficient: `apbc_100_br412` is `aphe`, `apc_50_pzgr39` is `apcbc`, and the API/APIT/HEI/HEFI labels are represented as `ap` or `he` in this data.

| Present kind | Records | Caliber field mm | Explosive filler kg | Audio selection |
|---|---:|---:|---:|---|
| ap | 14 | 14.5–88 | 0 | solid-shot contact / material / actual outcome |
| aphe | 5 | 76.2–121.92 | 0.065–0.164 | kinetic contact; internal burst only when a report actually contains a burst |
| apcbc | 14 | 35–130 | 0–0.12 | kinetic contact; filler/fuse varies per record |
| apcr | 11 | 14.5–90 | 0 | compact hard-core contact / actual shatter or ricochet |
| apds | 3 | 12–50 | 0 | penetrator-sized flight/contact, source gun-sized muzzle report |
| apfsds | 2 | 14–26 | 0 | long-rod kinetic contact/flight; no explosion by default |
| heat_fs | 6 | 35–152 | 0.055–4.6 | actual shaped-charge detonation and contact; includes three ATGM warheads |
| heat | 4 | 75–121.92 | 0.44–1.4 | actual shaped-charge detonation/contact |
| he | 26 | 20–420 | 0.006–125 | actual burst position/mass; micro to very heavy blast |

APDS/APFSDS `caliber_mm` can be the penetrator diameter: the 122 mm gun's `apds_122_3bm11` has a 50 mm core. Muzzle sound must use the **gun definition**, not the shell's core caliber. Filler-bearing APCBC also prevents a simple `kind===aphe` test from representing all delayed-fuse rounds.

Fifteen projectile records have nonzero fuse delays: `apbc_100_br412`, `apcbche_35`, `apcbc_130_br482b`, `apcbc_47_pak36t`, `apcbc_75_m61_m3`, `apcbc_75_pzgr39`, `apcbc_75_pzgr39_42`, `apcbc_75_pzgr39_l43`, `apcbc_76_m62`, `apcbc_88_l56`, `apc_50_pzgr39`, `aphe_122_br471`, `aphe_122_br472`, `aphe_76_br350a_l11`, `aphe_85_br365`. A nonzero fuse parameter alone is not a reported detonation.

`ProjectileKind` also supports `hesh` and `smoke` (`crates/weapon/src/lib.rs:14–26`), and the UI supports aliases (`shellicons.js:6–8`). Neither kind is present in the 85 loaded records. Reserve schema support, but do not spend generation requests or invent stock HESH/smoke events.

Armor materials in `data/materials.json`: `rha`, `cha`, `high_hardness_steel`, `aluminium`, `spaced`, `composite`, `applied`, `skirt`, `era`. Broad steel/aluminium/composite tails can be selected from actual contacted layers. A material named ERA does not by itself prove a detonation event. Ground terrain IDs are `road`, `dirt`, `grass`, `sand`, `mud`, `snow`, `gravel`, `wetland`; those are surface hints, not an armor material field. Building kinds are not proof of wood/brick/concrete material without an explicit binding.

Authoritative stock `Outcome` (`crates/combat/src/lib.rs:701–715`): `miss`, `ricochet`, `shattered`, `stopped`, `penetrated`, `overpressure`, `blast`, `external`, `unarmoured`. Reports include impact/normal, layers/materials, entry/path/ricochet, **bursts with position/inside/mass**, fragments, module/crew damage, events and capabilities (`:774–800`). Mechanism events additionally retain time and entry/exit data (`crates/penetration/src/impact.rs:408–415`).

The design adapter deliberately sets `bursts: []` while preserving actual contact/fragment information (`projectileReplay.js:203–207`); chemical/fuse release is a later mechanism phase in `crates/penetration/src/impact.rs:2`. Do not infer a blast from a shell kind, HUD `kill`, material name, or an illustrative replay path. `ammo_detonation` must come from the actual report/capability. Ground/building HE explosions are already explicit simulation/presentation paths and should not also receive a second generic impact explosion.

## Packed, imported and workshop coverage

- `makeLoadout` traverses main, extra guns and extra turrets, resolves secondary MG definitions and carries the engine (`loadout.js:219–243`). The inventory uses the same traversal.
- Workshop transplanted guns clone a source garage weapon including its definition ID, ammo, feed and missile link (`loadout.js:368–380`); the same weapon profile remains valid on another hull.
- Temporary `sourceVehicle` is dropped during bundle packing (`loadout.js:468,484,494`), while runtime turret `sourceVehicle` becomes the host vehicle ID (`:222,232`). Preserve a gun-level provenance binding during implementation; do not route a transplanted weapon by its host ID.
- Workshop engine is inherited from `base.engine` (`loadout.js:516`). The designer separately has `VehicleDesign.engine.kind` (`gasoline` / `diesel`) and horsepower; the compiled `EngineFile` drops kind (`crates/vehicle/src/files.rs:366–391`). Preserve the design choice through packing rather than infer fuel from nationality.
- Designed guns use generated IDs/properties (`sim/design.js:81–114`); explicit generic light/medium/heavy profiles cover arbitrary valid caliber/barrel combinations.
- `fun_hexa` has two each of `gun_custom_37_l45`, `gun_custom_75_l48`, `gun_custom_88_l56`, using corresponding loaded custom AP records. Its engine is 500 hp / 700–2600 RPM with no fuel identity; use E15 unless design provenance supplies a type. It is not an extra garage pick.
- Twelve loaded projectiles not referenced by garage guns: `apcbc_75_pzgr39_l43`, `apcr_75_pzgr40_l43`, `apds_20_dm43`, `apt_20_rh202`, `ap_custom_37_l45`, `ap_custom_75_l48`, `ap_custom_88_l56`, `heat_122_bk7m`, `heat_75_gr38b`, `hei_20_dm51`, `he_300_tt_rocket`, `he_75_sprgr34_l43`. Use kind/property fallbacks for imported content; do not generate a separate asset per unused record.

## Reload catalog and classification

The user's current loading design is **拿炮弹 → 装填 → 装填完毕闭锁 (grab → load → lock)**, using reusable German, Soviet and US manual styles across different durations. Regional sound texture is an artistic grouping; actual physical loading mechanism wins. Audit evidence: `sim/loading.js:7–81`, `sim/mg.js`, `main.js` loading / autocannon timers, stock weapon JSON and MG definitions. There is **no explicit cannon autoloader property or mechanism in the current stock/runtime**. A source timing clock, zero-loader layout, automatic firing and automatic magazine refill timer do not identify an autoloader. Automatic feed and belt/clip replenishment retain their own cue categories. An unmapped generic automatic test-rig bank stays optional and separate.

Current bounded candidate: `tools/audio/banks/regional-reloads-v1.json` contains nine ready prototype actions, 0.9/1.4/0.7 seconds per style, **9 requested seconds / estimated 360 credits**. Representative bindings are German `kwk36_88_l56`, Soviet `zis_s_53_85`, and US `m3_75`; loader and weapon metadata support their manual authoring context, not a recorded sound or universal national breech type. Three unbound separate-charge concepts are `generationReady=false`. M-46 notes explicitly state separate loading (`data/vehicles/su_att_m46/vehicle.json:12`); precise 122 mm sequences and T-10 assistance need source verification before mapping those exceptions. No actual stage has been generated. The earlier `detailed-v1` nine-cue / 20.7-second batch is held and superseded, with its original catalog bytes retained as history.

For cannons, `reload_s` is the baseline data cycle; manual workshop geometry instead calculates handling/carry work. Zero dedicated loaders means the gunner loads at **1.6× work time**, not automatic loading (`loading.js:9,19,64`). Independent flags remove a gun from the shared loader queue; they do not identify the physical mechanism. No sound starts while the gun is waiting for a loader. Grab starts at the transition to `loading`; final lock waits for actual `ready` with ammunition.

| Baseline cannon reload s | IDs using the cycle |
|---:|---|
| 3 | m6_37mm |
| 4 | kwk39_50_l60, kwk39_1, qf6pdr_mk2 |
| 4.5 | pak36t_47 |
| 5 | m3_75, qf_75_mk5, xp_78_lr |
| 6 | kwk40_75_l48, m7_3in, m1a1_76, m1a2_76, pak40_75 |
| 7 | kwk42_75_l70, kwk44_1_75_l70, l11_76 |
| 7.5 | kwk36_88_l56, m54_90mm, pak39_75_l48, gun_75 |
| 8 | zis_s_53_85 |
| 8.5 | d10t_100 |
| 10 | m46_130; vehicle notes explicitly state separate loading |
| 15 | m62_t2_122 |
| 22 | d25t_122 |

Twenty-five cannon definition IDs above map to 24 **nominal timing groups** if the two 4-second KwK 39 mounts share a family; source values total **175 s**. These are simulation inventory values, not a requirement for 24 different sound recipes. `us_m8`, `de_sdkfz234_2`, `de_aufkl_panther`, `de_vk1602`, and `de_pzjg1` lack a loader role in current crew data; active combat capability can add a 1.6 penalty. Do not call those automatic loaders. Do not substitute `60 / rounds_per_min`: e.g. KwK 42/44 data says 7 seconds even though 8 rounds/min implies 7.5.

| Automatic feed ID | Per-round cycle s (not reload audio length) | Capacity | Replenishment reload s |
|---|---:|---:|---:|
| oplot_mo_14_5x6 | 0.02 nominal; auto cadence is 10,000/min | 900 | 30 |
| oplot23_gsh6_23_custom | 0.0075 | 500 | 30 |
| 72k_25 | 0.25 | 7 | 0.75 |
| kda_35 | 0.11 | 100 | 8 |
| flak38_20 | 0.143 | 20 | 3.5 |
| kda_35_gepard | 0.11 | 320 | 20 |
| mk103_30 | 0.15 | 40 | 6 |
| kwk38_20 | 0.133 | 10 | 3 |
| kpvt_145 | 0.1 | 50 | 8 |

These nine nominal replenishment timings sum to **109.25 s**; that sum is not a request for nine full-length takes. Mechanism-specific actions can be reused across the 8-second and 20-second KDA 35 loading timelines while following actual progress. Do not request sub-0.5-second provider generations for per-round feed cycles; use the actual firing/feed sound layer and runtime cadence.

| MG ID | Belt/disc capacity | Actual reload s |
|---|---:|---:|
| kpvt | 50 | 8 |
| mg34 | 150 | 6 |
| dt | 63 | 4 |
| sgmt | 250 | 7 |
| dshk | 50 | 9 |
| m1919a4 | 250 | 7 |
| m2hb | 100 | 9 |
| besa | 225 | 7 |
| mg42 | 150 | 6 |
| mg_proto | 200 | 6 |

KPVT shares its main KPVT replenishment mechanism. The other nine MG nominal reload timings sum to **61 s**, not nine required whole-duration takes. Prompt DT's 63-round feed using its actual disc configuration only after validating that mechanical detail; numeric capacity alone does not prove a belt mechanism.

| Launcher reload definition | Actual baseline s | Meaning/evidence |
|---|---:|---|
| m220_tow | 12 | TOW source cycle; launcher-specific loading/locking cues |
| 9p135_konkurs | 18 | Konkurs source cycle |
| 9p163_kornet | 15 | Kornet source cycle |
| tt250_rail_r, tt250_rail_l | 1 | Nominal game reset field; each rail normally carries one rocket and then becomes empty, so this is not a reachable normal reload or proof of one-second handling |

Four nominal launcher recipes total **46 s**. Guided assemblies have two loaded tubes and a 0.25-second launch cooldown between them; actual assembly reload starts only after tube exhaustion and available reserves. The tube cooldown is not reload audio. TT-250's normally unreachable replenishment stays catalog-only until a real reserve path enters loading; do not buy or ship a fake human/automatic rocket reload.

Historical superseded reload envelope: **46 nominal recipes / 391.25 seconds / estimated 15,650 credits**, previously expanded to **134 source-stage requests**. It is no longer a required generation ceiling or set of production delivery files. Current manual loading starts with nine regional actions shared across duration values; later mechanism exceptions and feed/MG/launcher actions receive their own reviewed batches. Casual mode still divides actual manual/missile/feed/MG work by 1.2 exactly once. A change in work time does not require a new sound take or globally stretched playback.

Source-only examples demonstrate the required longer timeline: missing-loader and feed modifiers can combine to 2.4× (22→52.8 s, 30→72 s), and a 183 mm workshop AP round needs about 132.315 s handling before carry, queue or damage. Repairs can pause indefinitely. `fun_hexa` nominal fields are bypassed by geometry: 37 mm approximately 2.723238–2.813213 s, 75 mm 4.891155–5.066691 s, 88 mm 6.970201–7.826922 s depending on mount/loader. Queue wait remains silent.

`loading.progress` exposes real remaining/total values and `tick` advances by a per-gun rate, which can change or become zero. Waiting, out-of-ammo and repair stall can have an indefinite end. Grab starts once on actual loader assignment (`loading.js:63–66`); the current simulation has no measured grab/insertion subevents, so a later presentation owner ties load-stage milestones to actual work progress. Long cycles reuse appropriate handling variants, pauses or an explicitly sustainable bed at normal pitch; the initial one-shot insertion clip is not looped as repeated completed ramming. Pause/fade activity at zero work rate. Lock requires actual ready **with ammunition**: `main.js:4385–4394` can turn completed loading into empty, so completion alone is insufficient. Exact-frame offline compositions remain optional audition/test tools, not required 7.5/6.25/4-second production exports or proof of live alignment.

## Current runtime hookup map

| Current owner/call | What exists now | Required audio context / change |
|---|---|---|
| `main.js:191–192`; `audio.js:18–36` | One global Sound; all supplied URLs decoded when context exists | Bank manifest, lazy decode, profile resolution and memory budget |
| `build.mjs:26–35,51` | Every top-level MP3/OGG/WAV embedded by basename; no slot/duplicate check | Explicit reviewed bank allowlist + metadata; reject duplicate IDs, wrong hash/MIME or unreviewed takes |
| `main.js:3810`; `testrange.js:234` | Own cannon report receives only caliber | Gun ID/instance, shell ID, muzzle pose/direction/velocity and emission time |
| `main.js:2185` | Remote cannon scales shell caliber by 0.8; only within 1500 m | Use actual source weapon; retain caliber; distance affects gain/filter/delay |
| `main.js:3798,3911` | Auto/MG report receives only caliber; global 35 ms gate | Separate emitter cadence and weapon identity; rotary uses spin/firing loop |
| `main.js:2214,2218,2400` | Received damage and cookoff use generic metal impact with constant distance | Actual report/outcome/burst/target pose and stable event identity |
| `main.js:2896,2921,4006,4013,4022,4061,4072` | Missile/shell contacts largely play generic cue before resolution | One resolved contact owner, actual material/outcome; no cosmetic + authoritative duplication |
| `main.js:3935–3965` | MG collision paths exist; no impact sounds | Confirmed bullet contact and outcome adapter |
| `main.js:3991–3995,3925–3929`; `sim/ballistics.js:6–25` | Actual shell/bullet segments, position/velocity and lifetime | Per-projectile approaching/receding pass, shockwave and ricochet tracking; no guessed trajectory |
| `missiles.js:146–174,288` | Actual missile ID/type/segments/motor/velocity; generic launch synth | Four launch profiles, motor lifecycle, spatial emitters |
| `main.js:2885,2912`; `missiles.js:334,342` | Explosive mass passed for ground/building/APS blast | Mass classes, actual burst position/time, one primary blast per event |
| `main.js:2837–2838,2841–2847` | One nearest APS continuous synth and own state tones | Per-APS emitters using actual caliber/spin/fire; keep semantic tones deterministic |
| `main.js:3354,4396` | Rangefinder success and reload completion | Existing success/completion events; define explicit start/handling callbacks before adding those sounds |
| `main.js:4861,1326` | Own RPM/load/speed only; engine enabled by battle mode | Vehicle/source engine identity, damage/running state, turn/terrain, nearby emitter ownership |
| `main.js:4584–4590,2699` | Camera transform and hull velocity already available | Consistent 3D listener pose/velocity; scope/cockpit treatment |
| `hitcam.js:67,92,106,112,119`; `projectileReplay.js:20–44` | Explicit replay stages; some ordinary approach paths are illustrative | Separate replay bus, replacement/close cleanup, timed actual events only; no shockwave on illustrative path |
| `main.js:1450,3492–3497,4884–4889` | Garage resets missiles; visibility/pause stops other updates | Stop/suspend loops and queued cues; resume context through user gesture; explicit dispose |

Current samples have no panner, listener, delay, Doppler, distance low-pass, buses or voice budgets (`audio.js:55–77`). Distances inconsistently use player hull X/Z, camera X/Z, 3D camera or world origin. Cannon/MG samples are unattenuated; other cues have positive distance floors. Recorded loop replacement does not stop the old source; synth and APS sources lack complete retained teardown handles. AudioBufferSourceNodes are single-use: reuse buffers and node chains, not a previously started source node.

Network gaps are real: cannon `Fire` broadcasts origin/direction/shell/from/seq but no gun mount (`crates/server/src/lobby.rs:1679`); MG fire returns `Vec::new()` after proof recording (`:1686–1702`), with no remote MG presentation event; `Damage` has no shot sequence (`:337–347`). Add presentation identity through the protocol if exact remote weapon sound and deduplication are required. Audio must not infer a discharge or impact result from snapshots.

## Latest model and production cost evidence

Fresh official documents checked on 2026-10-12:

- [Convert API](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert): current SFX model enum permits only `eleven_text_to_sound_v2`, supports `loop`, and specifies duration 0.5–30 s. Response declares `character-cost`.
- [Model overview](https://elevenlabs.io/docs/overview/models): `eleven_text_to_sound_v2` is the text-to-sound-effects model. Do not substitute a TTS or music model under the word “latest.”
- [Sound Effects capability](https://elevenlabs.io/docs/overview/capabilities/sound-effects): **40 credits per second when duration is specified**. This is a planning estimate; retain the returned numeric `character-cost` separately when available. The overview's 0.1 s range conflicts with the API's 0.5 s minimum; use the stricter API limit.

The existing 11-slot manifest and `pilot-20261012` history stay unchanged. Root reports a successful first `shot_medium` take: HTTP 200, 2 seconds, 44.1 kHz native stereo decode, peak −10.93 dBFS, no full-scale samples; subjective audition remains pending. No additional takes were requested during this inventory. Generated sounds have provider-generation provenance; exact-name prompts do not make them authentic historical recordings or automatically assign the repository license.
