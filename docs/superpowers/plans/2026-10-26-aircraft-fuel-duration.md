# Aircraft Fuel Duration Implementation Plan

> For agentic workers: execute with subagent-driven development and keep actual bundle integration owned by root.

**Goal:** Select fuel by estimated duration and apply its actual mass in local and native flight.

**Architecture:** A shared browser policy uses existing source fuel tuples; native policy uses the same imported coefficients and validates a small optional command. Both feed existing mass configuration. Frontend controls compose into the established hangar and deployment flows.

**Tech Stack:** bundled JavaScript, Rust, C215/WASM, Node behavioral tests, native server tests.

- [x] Inspect actual local and native fuel/mass/service/reclaim paths and preserve existing local K availability.
- [x] Approve fixed 10/20/30/45 plus full design with user.
- [x] Write failing browser policy tests, implement shared policy, prove actual C215 mass effects.
- [x] Write behavioral native protocol/domain tests and run five intended failures against old production.
- [ ] Implement optional native duration, accepted stock/mass and staged service with no reclaim refill. Run `cargo test --locked -p tg-server --lib air_fuel_domain_tests` until all five pass; retain initial failures.
- [ ] Compose source-backed hangar/deployment controls and selected local launch/service initialization in a candidate, preserving default-full legacy callers.
- [ ] Run actual consumer tests and source sync checks, review diff before root integrates the final bundle.
- [ ] Run full native/frontend gates, rebuild Windows/Linux binaries and verify actual WebSocket launch/service behavior with the selected quantity.
