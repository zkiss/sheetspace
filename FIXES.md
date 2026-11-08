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

Cause: the zoom preview repainted the full-screen `.workspace-grid` on every
preview frame. Scaling the workspace plane makes the browser re-rasterize the
scaled sheet content, and moving the grid in the same frame repaints that content
again. The zoom preview also published a React viewport state at most every
150 ms, re-rendering every mounted grid while the gesture was still moving.

Fix (`frontend/src/workspace/useWorkspaceController.ts`):

- Zoom preview frames paint only the workspace plane. The grid follows once in
  `finishZoomPreview` when the gesture settles.
- The preview no longer publishes intermediate React state; the viewport commits
  once when the gesture settles. Pan keeps its existing bounded publication.

Measured with an ad hoc Playwright burst of 40 Ctrl+wheel events:

- Before: ~2.5 s wall time, ~1.3 s browser work outside script.
- After: ~1.4 s wall time, ~0.1 s browser work outside script, matching a
  same-length pan burst.

Tests updated for the intended behaviour:

- `useWorkspaceGestures` now asserts the grid stays frozen during a wheel or
  pinch preview and catches up on settle.
