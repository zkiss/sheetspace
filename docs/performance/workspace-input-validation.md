# Workspace navigation controls and validation

Ordinary wheel or two-finger scrolling pans empty canvas horizontally and vertically. Inside a
sheet, it scrolls the grid normally; reaching a grid edge does not pan the workspace. Editors,
menus, and input controls retain ordinary wheel behavior.

Pinch or Ctrl/Cmd-wheel zooms around the pointer across canvas and sheets. Toolbar zoom buttons
use the workspace center. Zoom is multiplicative, with centralized limits of 0.1–8 and finite
coordinate arithmetic. Reset restores the original viewport.

Hold Space and drag with the primary mouse button, or drag with the middle button, to pan from
canvas, cells, sheet headers, or resize handles. Space on a focused cell invokes canvas mode;
Space in an active editor remains text input. Empty-background primary dragging also pans.
Ending the pointer gesture, releasing Space, losing pointer capture, losing window focus, or
hiding the document ends the pan. User navigation interrupts reference-reveal motion.

## Native browser evidence

On 2026-09-12, the reproducible check below passed in headless Linux Chromium
150.0.7871.100, using Node 24.15.0 and a 1200 × 900 viewport. It mounts the real app with a
200-row, 30-column sheet in a disposable browser tab; no backend or saved workbook is needed.

The browser's input pipeline verified:

- Ordinary two-axis wheel pans the background by the supplied CSS-pixel deltas.
- Wheel scrolls the native grid container on both axes and leaves the workspace fixed at grid edges.
- Ctrl-wheel and Chromium's synthesized mouse-source pinch preserve the workspace point under
  the gesture center, without changing browser page zoom.
- Space-drag over a focused cell, header, and resize handle pans without editing, text selection,
  frame movement, or resizing. Middle-drag also pans without browser autoscroll.
- Space inserts a literal space in the active cell editor.
- Releasing Space while the mouse button remains down ends the pan; subsequent movement does
  not move the workspace.

This exercises native browser scrolling, default prevention, input routing, and pointer capture.
It does not establish physical trackpad behavior, touch-screen pinch, Firefox, or Safari coverage.
Chromium trackpad-style pinch uses modified wheel events. A separate native `gesturestart/change/end`
adapter handles cumulative gesture scales for engines that expose them; its behavior is covered
with deterministic events, not a Safari device run. Touch-screen pointer navigation is not implemented.

## Reproduction

Start Vite from the repository root:

```bash
npm --prefix frontend run dev -- --host 127.0.0.1
```

In another terminal, start a disposable Chromium profile (close it when done):

```bash
chromium --headless --remote-debugging-port=9222 --user-data-dir="$(mktemp -d /tmp/sheetspace-browser.XXXXXX)" about:blank
```

Run the check with Node 22 or newer:

```bash
node frontend/scripts/check-workspace-native.mjs
```

`SHEETSPACE_URL` and `CHROME_DEBUG_URL` override the default app URL
`http://127.0.0.1:5173` and debugging URL `http://127.0.0.1:9222`. Use a disposable browser:
the check replaces the first page tab with its fixture. Container environments may require
Chromium's `--no-sandbox` option.

## Deterministic regression checks

`useWorkspaceGestures.test.tsx` covers delta modes, rapid compounded wheel input, Ctrl/Cmd
modifiers, cumulative gesture scales, sheet propagation boundaries, editor input, pointer
ownership, unrelated pointer IDs, cancellation, and repeated StrictMode mount cleanup.
Geometry, frame virtualization, application frame composition, and reference navigation tests
cover finite extremes, signed coordinates, culling, interaction pins, and target reveal.

```bash
make test
make compile
```

The implementation pass passed both commands, including 588 frontend tests and the backend
coverage checks. The existing [virtualization baseline](workspace-grid-virtualization.md) describes
the bounded DOM fixtures retained by these input changes.
