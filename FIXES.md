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
