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

### 3. Maximise and restore animation and sheet dragging stutter

Reported: minimising and maximising a sheet is slow, and dragging a sheet
(by its header) to a new position is slow.

Cause: transient frame geometry was committed through React state on every
animation frame and every drag pointer move. Workspace renders every mounted
sheet and grid inline, so each commit re-rendered all grids. The presented grid
also reported its animated body size back into workspace state each frame.

Fix:

- Maximise/restore sampling now paints the presented frame, header and body
  directly from `sheetFramePresentation.ts`. React commits once at each
  transition boundary instead of once per frame. `currentPresentation()` on the
  runtime exposes the live sample for callers that need mid-flight geometry
  (extraction requests).
- Reference-viewport reporting pauses while a sheet is presented, so the
  animated body resize no longer updates workspace state.
- Dragging a sheet moves the frame's `left`/`top` directly and updates
  `data-position-x`/`data-position-y`. The committed position still goes
  through `moveSheetFrame` on release, and a rejected move repaints the start
  position. Escape, pointer cancel, blur and a removed sheet also restore the
  start position. Ctrl-drag scaling keeps the preview-state path; resizing is
  covered in entry 4.

Measured with ad hoc Playwright rAF sampling over 700 ms on the running dev app:

- maximise: 10 frames, avg 79.5 ms, max 233 ms, 615 ms in long tasks before;
  23 frames, avg 30.8 ms, max 100 ms, 449 ms in long tasks after.
- restore: 14 frames, avg 54.1 ms, max 150 ms, 683 ms in long tasks before;
  26 frames, avg 27.3 ms, max 133 ms, 353 ms in long tasks after.
- sheet drag, 40 pointer moves: ~4.9 s before, ~1.0–1.3 s after including
  Playwright round-trips.
- The remaining animation cost is the presented grid re-rendering as its
  scroll container grows; it is no longer multiplied by every mounted sheet.

Ad hoc Playwright verification against the running app:

- sampled frame rects progress continuously through enter and restore, the
  maximised frame fills the surface with a detailed grid, and restore returns
  the sheet to its saved canvas position;
- drag follows the pointer, commits on release, restores on Escape, and updates
  `data-position-x`/`data-position-y`;
- no console warnings or errors.

Tests deferred (per user request in this fixes session):

- `useSheetFrameInteractions.test.ts` has six drag tests asserting
  `frameLayoutPreview`, which no longer changes during a drag; they need to
  assert the frame element's style and data attributes.
- `useMaximiseRuntime.test.tsx` has three tests sampling `presentation`
  mid-flight; the live sample now comes from `currentPresentation()` while
  `presentation` commits only at boundary/retarget points.

### 4. Sheet frame resizing stutters

Reported: resizing a sheet by dragging its edge is jerky, like the earlier
maximise and drag cases.

Cause: two per-pointer-move React commits. The resize preview went through
`frameLayoutPreview` state, and the resized grid reported its growing body size
back into workspace reference-viewport state on every frame. That second commit
re-rendered every mounted frame and grid, on top of the resized grid rendering
its newly visible cells.

Fix:

- Resizing now paints the frame's `left`/`top`/width/height and
  `data-position-x`/`data-position-y`/`data-frame-width`/`data-frame-height`
  directly on the frame element. React commits once when the gesture ends, and
  a rejected resize repaints the start geometry.
- Reference-viewport reports are buffered while a sheet is presented or a frame
  gesture is active, then applied once when it settles. The cancelled case is
  buffered too, so a gesture that ends where it started still records the
  correct geometry.
- Ctrl-drag scaling keeps the preview-state path because it changes rendering
  mode live.

Measured with ad hoc Playwright rAF sampling on the running dev app, dragging
the bottom-right handle 40 times (600×460 to 943×689):

- before: 6.2 s of pointer moves, 184 frames over that time, 82 long tasks
  totalling 6.0 s;
- after: 0.87 s, 51 frames (about 59 fps), 2 long tasks totalling 0.28 s.

The remaining cost is the resized grid rendering cells that become visible as
its container grows.

Ad hoc Playwright verification against the running app:

- growing and shrinking commit the painted size and position, including from
  the top-left handle where the position moves too;
- Escape mid-resize repaints the start geometry and does not commit;
- the sheet was restored to its saved 600×460 at (1, 561);
- maximise/restore and sheet dragging still behave as in entry 3;
- no console warnings or errors.

Tests deferred (per user request in this fixes session):

- `useSheetFrameInteractions.test.ts` resize tests assert `frameLayoutPreview`;
  they need to assert the frame element's style and data attributes instead.

### 5. Header moves need a double click

Reported: moving a row or column header needed pressing the header twice. A
single drag should work: first drag headers to select them, then drag any header
to move once a full row or column selection exists. No timer, no double click.
This replaces the double-press gesture from entry 2.

Fix:

- Removed the 650 ms double-press detection from `useAxisGather`.
- A header press now starts one of two gestures, chosen by the current
  selection:
  - no full row or column selection: the press and drag select headers;
  - a full row or column selection exists: the press immediately starts the
    move session, so one drag reorders. Pressing a header outside that selection
    selects it and moves it. Shift, Ctrl and Cmd presses still drag a selection.
- The deck is only drawn once the pointer passes the click slop, so clicking a
  selected header no longer flashes cards.

Ad hoc Playwright verification against the running app:

- drag-selecting rows from a cell selection shows no insertion line or deck and
  leaves the order unchanged;
- dragging a selected header shows the three-card deck and insertion line,
  reorders the rows, and Ctrl+Z restores the order;
- dragging an unselected header while rows are selected moves that row and
  selects it;
- column drag-select then selected-column drag on a non-model sheet shows the
  deck, moves the columns, and undo restores them; model-bound sheets still
  disallow column moves;
- Shift+drag from cells mode selects headers without moving;
- clicking a selected header keeps the selection and does not reorder;
- no console warnings or errors.

Tests deferred (per user request in this fixes session):

- `SheetGrid.gather.test.tsx` and `App.axisGather.test.tsx` still assume the
  removed gather buttons and the double-press gesture; they need rewriting
  around select-then-drag.

### 6. Cell selection moves slowly with arrow keys

Reported: moving the cell selection, especially with arrow keys, feels slow;
check the React redraw path.

Fix:

- Keep the grid cell-registration callback stable until its actual focus targets
  change, rather than replacing every cell ref on each workspace render.
- Memoize the cell's rendered presentation when its sheet content, visual
  state and geometry are unchanged. Interaction callbacks forward to the latest
  handlers, so memoized cells do not retain stale commands. Editing cells still
  update when editor interactions change.

Ad hoc verification against the running development app:

- CDP sampling during 20 alternating arrow presses showed substantially less
  React DOM-property reconciliation after the change; rendering and formatting
  of visible grid cells still contribute to navigation cost.
- Right/down navigation, Shift+down range extension, collapse with up, starting
  an editor and Escape all kept native focus and selection aligned; no browser
  warnings or errors were observed.
- TypeScript and ESLint passed for the changed files. Automated tests were not
  run, per the fixes-session request. Add focused regression coverage for
  memoized cell callbacks, focus registration and selection changes during
  hardening.

### 7. Restore frame and viewport motion

Reported: restore should resemble a reverse maximise, with the title bar and
sheet headers moving together, borders wrapping the sheet progressively, and
workspace movement and zoom using the shared flyover to center the sheet at its
native scale.

Fix:

- Paint the presentation chrome variable on every sampled frame, so the frame
  border appears progressively instead of jumping in at the end.
- Run restore over the shared workspace navigation duration and start its
  existing viewport flyover at the same time; cancel the owned flyover when
  the presentation is interrupted or retargeted. Maximise timing is unchanged.
- Sample the displayed plane viewport and repaint the live presentation after
  React commits, preventing a stale presentation from displacing the frame
  during the concurrent viewport animation.

Ad hoc Playwright verification against the running app:

- Sampled restore frames show the title-bar height and border chrome growing
  alongside the contracting sheet while the workspace plane moves and zooms;
  the restored frame lands centered at native scale without a final jump.
- Checked normal and reduced-motion restore, preserved the saved Team Time
  position after an exploratory drag, and saw no browser warnings or errors.
- TypeScript, targeted ESLint and `git diff --check` passed. Automated tests
  were not run per the fixes-session request. During hardening, update the
  maximise runtime/state tests for restore timing, shared flyover ownership,
  intermediate chrome painting, retargeting and cancellation.

### 8. Reveal the workspace during restore and match motion speeds

Reported: the workspace stays white until restore finishes. Show it while the
sheet contracts, and make maximise and restore animation speeds match.

Fix:

- Reveal the workspace grid and peer sheets as soon as restore starts, while
  retaining frames already mounted and pre-mounting those in the destination
  viewport for the flyover. The maximised view still conceals them.
- Keep the existing 300 ms maximise duration and use it for both the restore
  presentation and its shared viewport flyover. Other workspace navigation
  retains its existing duration. This supersedes entry 7's restore duration.

Ad hoc Playwright verification against the running app confirmed that peers and
workspace grid are hidden when maximised, visible during restore, and remain
visible afterward, without console warnings or errors. TypeScript, targeted
ESLint and `git diff --check` passed. Automated tests remain deferred; add
coverage for restore visibility, frame mounting, and custom flyover duration
when hardening.
