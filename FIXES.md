# Fixes log

Temporary log for the current fixes session. Remove before any eventual merge.

## Protocol

Fixes mode (per AGENTS.md): address only the requested feedback, update this log
after each fixing turn, and commit each turn. Test updates and test execution are
deferred until the user requests hardening and assurance. Deferral is temporary
and does not weaken final coverage or quality gates.

## Scope

Quick fixes for issues found in recently delivered Beads:

- sheetspace-p9r — explicit positional row references
- sheetspace-q7v — row/column reordering
- sheetspace-km7 — centralized keyboard shortcuts
- sheetspace-xct — extract selections into a sheet
- sheetspace-mxm — maximised sheet mode

## Fix entries

### 1. Wheel and pinch zoom stutter

Reported: zooming in and out is very slow; dragging stays smooth.

Cause: the zoom preview repainted the full-screen background grid on every
preview frame. Scaling the workspace plane makes the browser re-rasterize the
scaled sheet content, and moving a CSS-gradient grid in the same frame repaints
that content again.

Fix:

- The grid is now a canvas drawn from `workspaceGridGeometry`. Redrawing it costs
  about one cheap pass per frame instead of re-rasterizing a scaled CSS layer.
  `paintPanViewport` draws the canvas on every pan and zoom preview frame, so the
  grid moves continuously with the plane while a gesture is in progress.
- Zoom previews still commit React viewport state only when the gesture settles.
  A React commit per frame re-renders every mounted grid and is not needed for
  the canvas to follow the gesture.

Measured with an ad hoc Playwright burst of 40 Ctrl+wheel events:

- CSS grid, continuous: ~2.5–3.0 s wall time, ~1.3–1.7 s browser work outside
  script.
- CSS grid, frozen during zoom: ~1.4 s wall time, ~0.1 s browser work, but the
  grid visibly stops moving until the gesture settles.
- Canvas grid, continuous: ~0.75–0.95 s steady state, ~0.3 s browser work, with
  the grid redrawn on every preview frame. Canvas drawing itself totals under
  2 ms across the whole burst.

Tests deferred (per user request in this fixes session):

- `WorkspaceSurface.test.tsx` still asserts the old grid CSS custom properties.
- `useWorkspaceGestures.test.tsx` still asserts grid transforms and the frozen
  preview timing introduced by the earlier fix commit.
- A test for `workspaceGridGeometry` and canvas drawing will be added during
  hardening.

### 2. Row and column headers are moved by double-click drag

Reported: the six-dot move handles on the row and column headers are visually
distracting, and moving headers should feel physical: a single insertion line,
headers that follow the pointer, and a stacked deck for multi-axis moves.

Fix:

- Removed the `⋮⋮` gather buttons from row and column headers.
- A press, release and second press on the same header (within 650 ms and 6 px)
  starts a move session on the second press, so the header is dragged while the
  pointer is still down. Pressing a header that is already part of a multi-axis
  selection keeps that selection instead of collapsing it to one header.
- The insertion indicator is a single 2 px line at the current gap, spanning the
  full grid width including the sticky header strips, so it is visible between
  header cells as well as in the cell area.
- The grabbed header follows the pointer: it is rendered as a header card in the
  grid's content coordinates, so it tracks the pointer through workspace scaling,
  scrolling, and edge auto-scroll.
- The deck is what is dragged: the grabbed header stays on top, the other
  selected headers tuck in behind it as a neat stack of tinted cards offset by
  4 px each. Only the first three depths are drawn, so a long selection still
  reads as a small deck. On pickup every selected header flies from its real
  position into the deck, and on release every card flies out to its landing
  offset (or home when the drop is cancelled). The existing row/column FLIP
  motion still animates the real headers into place.
- Drops are accepted anywhere over the sheet, not only over the header strip:
  the insertion line already shows the target gap, so the pointer can stay over
  ordinary cells while dragging (cross-axis header strips clamp to the axis
  range).
- `Escape`, blur, sheet deactivation or a projection change cancel the session
  and return the cards home.

Ad hoc Playwright verification against the running app:

- single row move down and up, single column move left and right, multi-row move
  with a preserved two-row selection;
- the line spans the header strip and the cell area (screenshots inspected);
- the deck stays under the pointer, including during edge auto-scroll
  (`scrollTop` advanced 70 → 224 px while the line stayed visible);
- the three-card stack was inspected at 4× zoom: the grabbed header on top, two
  tinted cards offset behind it, and the fly-in animation ran while the deck
  settled;
- dropping over an ordinary cell in the middle of the sheet reordered the row to
  the gap shown by the line, and Ctrl+Z restored the original order;
- release flight rendered and real headers settled in the new order;
- drop outside the grid and `Escape` both cancelled without changing the order;
- plain click and plain double-click on a header select without starting a move;
- no console warnings or errors.

Tests deferred (per user request in this fixes session):

- `SheetGrid.gather.test.tsx` and `App.axisGather.test.tsx` still press the
  removed `Drag row/column` buttons and assert `axis-gather-preview` blocks; they
  need rewriting around header presses, the `axis-gather-line` and deck cards.
- New coverage for double-press timing, multi-selection preservation, deck/flight
  rendering, and the insertion-line boundary will be added during hardening.

