# Workspace and grid virtualization measurement

This development measurement records deterministic DOM cardinality for the combined
workspace-frame and detailed-grid virtualization path. It is intended as a reproducible
regression reference, not a CI timing threshold.

## Fixture

- Outer surface: 800 × 600 CSS pixels at workspace scale 1.
- Workspace frame overscan: 320 horizontal and 240 vertical workspace pixels.
- Workbook: 42 sheets. Two overlapping sheets intersect the measured viewport; 40 sheets
  are separated beyond the overscan region.
- Detailed grids: one visible sparse grid has 10,000 logical rows × 100 logical columns;
  the other visible grid and all 40 distant grids have 20 rows × 10 columns.
- Grid measurement: JSDOM's deterministic zero-size fallback renders at most 30 rows × 30
  columns per grid. This makes the result stable and intentionally conservative compared
  with the 240 × 160 frame body's ordinary measured virtual window.
- Environment: Linux 6.1.0-50-amd64 x86_64, Node 24.15.0, npm 11.12.1, Vitest 2.1.9.

The pre-Deliverable baseline is derived from the tracked source at commit `4593931`: `Workspace`
mapped every sheet to a frame, and `SheetGrid` nested every projected row over every projected
column while rendering one row header per row, one column header per column, and one corner per
grid. The fixture test validates the derived cardinality from the actual logical axis lengths; it
does not attempt to mount more than a million baseline cells in JSDOM. “Grid virtualized only” is
the same fixture at commit `4ad31fb`, before outer frame culling. “Combined virtualized” is the
current measured projection with both layers enabled.

| Steady-state DOM category | Pre-Deliverable derived baseline | Grid virtualized only | Combined virtualized |
| --- | ---: | ---: | ---: |
| Sheet frames | 42 | 42 | 2 |
| Detailed grids | 42 | 42 | 2 |
| Data cells | 1,008,200 | 9,100 | 1,100 |
| Row headers | 10,820 | 850 | 50 |
| Column headers | 510 | 440 | 40 |
| Header corners | 42 | 42 | 2 |
| All headers and corners | 11,372 | 1,332 | 92 |

The baseline data-cell total is `10,000 × 100 + 41 × 20 × 10 = 1,008,200`; the header totals
follow from the same fixture axes. Detailed-grid virtualization reduces the representative large
grid from 1,000,000 mounted cells to a 30 × 30 deterministic fallback window. Outer culling then
removes the 40 distant small grids, leaving the large window plus the overlapping 20 × 10 grid.

Adding the 40 wholly offscreen sheets therefore adds no steady-state frame, grid, cell, or
header DOM. The mounted data-cell count remains the two visible grids' virtual Cartesian
products. Panning to the first distant sheet replaces the visible set with one frame and grid;
its stored `B2` value remains present, demonstrating that culling affects only DOM projection
and not workbook state.

## Interaction observations

At the pre-Deliverable baseline, every logical cell was mounted and registered in a DOM-ref map.
Keyboard and reference navigation looked up that already-mounted element before scrolling, so the
10,000 × 100 interaction path depended on retaining all 1,000,000 large-grid cells in the DOM.
This is a source-derived observation from `SheetGrid.tsx` at `4593931`, alongside the cardinality
derivation above.

With the combined virtualized path, the 10,000 × 100 component fixture scrolls from `A1` to
`CV10000`, retains overlapping stable identities on return, and keeps each measured window below
1,000 cells. The reference-navigation fixture scrolls to and focuses `CU9999`, highlights through
`CV10000`, and remains below 1,000 mounted cells. At the workspace layer, panning from the two
visible frames to the first distant frame replaces the mounted set and still exposes its stored
`B2` value. These observations cover edge scrolling, focus/highlight transfer, and workbook-state
retention without requiring the destination cell or frame to be mounted in advance.

## Reproduction

From the repository root:

```bash
npm --prefix frontend test -- --run src/App.workspaceFrames.test.tsx
```

The test named `keeps frame, grid, cell, and header DOM bounded when wholly offscreen sheets
are added` constructs the fixture, validates the pre-virtualization cardinality from its logical
axes, measures the combined projection through the ResizeObserver test controller, pans to a
distant sheet, and verifies retained workbook content.

The baseline rendering structure can be inspected without changing the worktree:

```bash
git show 4593931320e2:frontend/src/Workspace.tsx
git show 4593931320e2:frontend/src/SheetGrid.tsx
```

For the detailed-grid edge and interaction observations:

```bash
npm --prefix frontend test -- --run src/SheetGrid.test.tsx src/App.referenceNavigation.test.tsx
```

Related workspace tests cover pan, zoom, surface resize, preview geometry, z-order, drag, resize,
edit, pending-focus pinning, and pin release. `src/App.referenceNavigation.test.tsx` covers the
offscreen sequence from model-driven outer movement through frame mount, inner virtual scroll,
focus/highlight, and navigation-pin release.
