# Cloud handoff: replay / damage / aircraft fixes

**Results of this round: see [CHANGES.md](CHANGES.md)** (Traditional Chinese): fixes, root causes,
verification, browser test harness in `tests/`, flight core in `flight/`.

Source of truth is `bundle/app.js.html`, extracted from the user's
`tankforge-full-online-20261014.html` (sha256 84fde108…fb2fd3). It is newer than
`origin/main`: it contains 10 modules this branch's `client/web/src` lacks
(suppliedReplayDraw.js, vendor/suppliedHitReplayV3.js, armorInspection*.js,
localSurfaceCombat.js, physicalNodeKey.js, barrelShapeComposition.js,
trackChain*.js, suspensionForce.js). Edit the bundle, then `./build.sh` reassembles
`tankforge-full-online.html` (head + gunzipped data + script; byte-identical round trip verified).

`supplied/` holds the user's standalone replay (`hit_replay_webgl_wasm_v3.html`,
already vendored as `vendor/suppliedHitReplayV3.js` in the bundle) and the flight
project `aerolab_flight_test_v2_source.zip` (C→WASM flight core, gl.js, runtime.js).

## Finding so far: replay transparency (clouds visible through the tank)
`SuppliedReplayPresentation.acquire()` overlays a second canvas created with
`alpha:true, premultipliedAlpha:false`. Renderer2.view() draws an opaque sky (alpha 1)
but then blends translucent armor/internals with `gl.blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)`,
which also blends the alpha channel (dstA = srcA² + dstA(1-srcA) < 1), and the POST
shader writes `texture(uScene,uv).a` to the canvas. So every ghosted pixel is partly
transparent and the live game view (sky/clouds) shows through. Fix candidates:
`blendFuncSeparate(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)` in
Renderer2.view(), and/or force alpha 1 inside view rects in POST.
