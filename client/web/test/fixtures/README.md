# Preserved compatibility and geometry references

`legacy-core-18a27ae7.wasm` is the unchanged previously committed core from `48fd52c:client/web/assets/tg_design.wasm` (1,646,934 bytes; SHA-256 `18a27ae78002ac872fff88ca90992ce59afd778cd5837cf3a64c0b8bb79e6989`). Replay compatibility tests keep exercising that original binary after the production asset adopts the new source-matched core. The offline game embeds only `client/web/assets/tg_design.wasm`.

`exact-hit-x1-oracle-witness.json` preserves the independent pre-kernel Renderer/Node/Moller witness without regeneration or new source pins (1,524 bytes; SHA-256 `8339fae6a8b5e5b9ee7e69368fdf13906448c24be26d01081b7bf2252880df09`). It was originally recorded in the accepted X1 worktree at `target/exact-hit-x1-oracle-witness.json`. Tests compare current actual geometry against those same contacts, including the historical broad-box defect. It is not certification that live combat uses triangles.

Live replay and geometry receipt tests accept their explicit `TG_*_RECEIPT` paths; these must point at freshly executed native receipts for the candidate being checked.
