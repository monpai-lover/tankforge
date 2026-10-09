# Missile force and guidance model

The browser's `tg-design-wasm` and the server both step `tg-missile::World`.
There is no separate JavaScript guidance simulation. The longest internal step
is 1/120 s, independent of the outer render or server tick.

`turn_accel_ms2` already limited steering acceleration. It remains the legacy
reference for old data. Optional `max_g` replaces that reference with a normal
control load in standard gravities (`g = 9.80665 m/s²`); the two fields are never
multiplied. If `max_g` is missing or null, the limit is `turn_accel_ms2 / g`.
An unguided rocket with zero turn authority stays ballistic, even if an optional
G field is supplied. Negative/nonfinite G, legacy acceleration and guidance lag
are rejected by the typed loader and the strict content validator.

Current values are **game estimates derived from the previous acceleration
tuning**, not measured manufacturer limits:

| Definition | Legacy reference | Normal-control envelope |
| --- | ---: | ---: |
| BGM-71A TOW | 60 m/s² | 6.118297 G |
| 9M113 Konkurs | 50 m/s² | 5.098581 G |
| 9M133 Kornet | 60 m/s² | 6.118297 G |
| TT-250 unguided rocket | 0 m/s² | 0 G control; gravity remains active |

Working lift spends the same budget supporting weight as guidance spends
turning. A horizontal, height-holding turn therefore has available acceleration
`a = sqrt((max_g * g)² - g²)`, and minimum radius `r = v² / a`.
Equivalently `r = v² / (lateral_g * g)`. At the TOW/Kornet 300 m/s reference speed
the saturated horizontal radius is about 1,520 m; Konkurs at 208 m/s is about
882 m. Upward/downward turns spend the gravity budget differently. A limit below
1 G cannot fully support weight and the missile falls despite functioning lift.

The lagged SACLOS command remains separate from actual flight direction. The
velocity turns along a bounded spherical arc, with a deterministic plane for
opposite commands; changing the aim point cannot directly rotate its velocity.
Damaged-fin yaw/pitch drift shares the same force envelope. The finite velocity
change plus weight support must also fit the budget, so a finite integration
step cannot exceed the declared load.

Each server/WASM missile snapshot adds:

- `max_g`: the resolved normal-control limit, including the legacy fallback.
- `g_load`: actual normal-control load in the last internal step, including
  weight support and drift. Motor thrust and axial drag are excluded.
- `lateral_g`: actual path-bending acceleration, excluding motor/drag; it
  includes gravity when lift is absent or insufficient.

These values describe an idealized force envelope. The motor still follows its
existing speed schedule, lift support is idealized, and there is no sourced
angle-of-attack, dynamic-pressure, Mach or structural failure model. Telemetry
reports the last internal step rather than an average or peak over an outer tick.
