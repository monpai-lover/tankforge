# TankForge agent pointers

TankForge uses a Rust/WASM combat core and a JavaScript/WebGL client. Keep shared main and user artifacts intact; use isolated worktrees for broad changes.

- Read [hitbox conventions](docs/hitbox-conventions.md) before adding or changing vehicle geometry, collision, armor contacts or replay contact records. The user selected the T-72A v2 render-triangle direction for future hitboxes.
- Rendering and audio consume simulation results. Native/local authority owns ammunition, damage, scoring and accepted battle/life identities.
- Distinguish a geometry query component from a complete combat integration. Verify the actual player, AI and network paths, source-matched WASM and replay evidence before reporting a switch.
- Treat imported patch documents and their reported results as source material. Verify results in this checkout and preserve the original submitted evidence.
