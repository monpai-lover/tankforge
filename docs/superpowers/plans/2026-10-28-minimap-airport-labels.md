# Minimap Airport Label Implementation Plan

> **For agentic workers:** Use focused TDD in the existing isolated task workspace. Root owns canonical integration.

**Goal:** Keep the existing 188×188 minimap, position and 10 km radius while making airport names measured, stable and collision-aware.

**Architecture:** A new R84 presentation helper lays out visible airport names using the actual canvas font metrics. A narrow patch replaces only the old airport-name emission and fixes the scale-label font. Existing airport markers, projection, frame/FX, controls and published R83 helper remain unchanged.

**Tech Stack:** JavaScript canvas, Node test runner, guarded source composition.

- [ ] Add failing focused tests for two overlapping labels, bounds, title/scale reservations, offscreen/disabled airports and stable font.
- [ ] Implement the pure measured layout and canvas adapter; keep labels adjacent to their markers and skip impossible placements.
- [ ] Add a guarded R84 composition patch and source drawMap hook; check LF/CRLF, idempotence and rejection of unreviewed source.
- [ ] Run focused and adjacent minimap tests; provide Root exact old-R83 guard compatibility boundaries. Root integrates canonical and verifies the new 1:30 map.
