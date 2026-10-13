# Phase 3: Fluent Spreadsheet Editing

## Goal

Make Sheetspace efficient for sustained, familiar spreadsheet work while making its spatial canvas fluid across radically different scales.

Phase 2 makes small models calculable and introduces reference navigation. Phase 3 improves the everyday editing loop: users can select and manipulate ranges, work primarily from the keyboard, repeat formulas, recover from mistakes, and compose sheets at miniature or large visual scales while preserving spatial context.

## Included Scope

### Selection and keyboard workflow

- Select rectangular ranges, complete rows, and complete columns.
- Extend and contract selections with conventional pointer and keyboard modifiers.
- Support familiar directional navigation, edit entry, commit, cancel, and selection movement across filled and empty cells.
- Keep selection and focus unambiguous when moving between sheets and the workspace.

### Range operations

- Copy and paste scalar values, raw formulas, and rectangular ranges.
- Add `$` row and column anchors for absolute and mixed A1 references.
- Adjust relative references when formulas are copied while preserving anchored coordinates.
- Apply the same coordinate transformation when copying between sheets. Unqualified references resolve in the destination sheet, including anchored references; explicit sheet qualifiers retain their sheet identity. Anchors fix row or column coordinates, not the source sheet.
- Clear and move selected ranges with predictable reference and comment hooks for later features.
- Make multi-cell operations atomic from the user's perspective.

### Undo and redo

- Add session-local, workbook-aware undo and redo for cell-content edits and Phase 3 range operations. Selection, focus, and viewport movement belong to the separate Phase 5 navigation history and are not recorded or restored by edit history.
- Recalculate formula results from restored contents and persist the resulting changes. A paste, clear, or move is undone as one atomic action, including moves between sheets.
- Reveal the affected region without changing the current selection. Use a temporary yellow, selection-like pulse to distinguish edit feedback from selection.
- Fade restored contents in when undoing deletion, fade removed contents out, and crossfade between previous and restored contents when replacing values. Redo uses the same feedback. Apply data changes immediately; animation must not delay calculation, saving, or further input.
- Under reduced-motion preferences, use a brief static highlight without pulsing or fading.

### Canvas navigation and multi-scale composition

- Make workspace movement infinite-feeling so users can continue panning and placing sheets at any practical finite coordinate.
- Support smooth multiplicative viewport zoom across a wide practical range, preserving the workspace point under the pointer or gesture center.
- Adopt Figma-style navigation: wheel or two-finger scrolling pans empty canvas, pinch or Ctrl/Cmd-wheel zooms at the pointer, and Space-drag or middle-drag pans from anywhere. Preserve ordinary scrolling inside sheet grids.
- Add persistent uniform visual scale as presentation state stored separately from cells, formulas, grid dimensions, and logical frame size.
- Create sheets at the inverse of the active viewport scale, clamped to the supported range, so a sheet created while deeply zoomed in appears at a usable screen size and becomes miniature after zooming out.
- Add a distinct scale handle and numeric percentage control. Keep these controls usable at miniature scales and keep frame resizing a separate operation.
- Support free composition through independently positioned sheets, visual scale, overlap, and z-order.

### Sizing, formatting, and zoom behavior

- Resize sheet frames from their edges or corners and persist frame size.
- Resize row heights and column widths and persist their metadata.
- Support General, Number, and Percent value formats plus bold, alignment, text colour, and fill colour at column, row, and cell level.
- Combine formatting one property at a time using the planning default precedence cell > row > column > application default. Store row and column formatting as inherited defaults for their cells, including blank cells, rather than copying it into every cell.
- Distinguish removing an override to inherit from explicitly resetting a property to its application default. An explicit normal font, General number format, or no-fill background must be able to suppress inherited formatting while leaving other properties intact.
- Preserve explicit override intent through persistence, including default-valued properties that suppress inheritance. Applying row or column formats retains cell overrides; changing or clearing cell contents retains formatting.
- Use a lightweight overview presentation when combined viewport-and-sheet scale makes cell editing illegible, while keeping navigation and sheet selection available.
- Restore detailed editing automatically when the sheet becomes legible again.
- Respect reduced-motion preferences in selection and focus transitions.

## Completion Signal

- A user can enter and revise a medium-sized table without relying on repeated pointer-driven single-cell edits.
- Range copy, paste, clear, and move preserve raw formulas and produce correct recalculation.
- Undo and redo reliably reverse and restore compound grid actions.
- Sheet, row, and column sizing plus supported row, column, and cell formatting survive reload, preserving inheritance and explicit overrides.
- A user can smoothly traverse a wide-range canvas, create a sheet at deep zoom, and later see it as a miniature part of a larger visual composition.
- Per-sheet visual scale survives reload as its own part of frame layout.
- Zoomed-out or individually miniaturized sheets present a clear overview suited to their current scale.

## Deferred To Later Phases

- Fill handles and automatic pattern or series extension are deferred without an assigned phase.
- Row and column insertion, deletion, reordering, custom names, and extraction are Phase 4.
- Rich formula editing and deeper reference visualization are Phase 5.
- Comments, layers, and frame hiding are Phase 6.
- Phase 6 adds flat groups for moving selected sheets as a unit.
- Active viewport and navigation-history persistence are Phase 5; Phase 3 persists per-sheet visual scale with frame layout.
- Import/export and report-oriented formatting are later phases.

## References

- [02-practical-and-explainable-calculations.md](02-practical-and-explainable-calculations.md)
- [features/grid-editing.md](../features/grid-editing.md)
- [features/sheet-frames.md](../features/sheet-frames.md)
- [features/interaction-polish.md](../features/interaction-polish.md)
- [features/persistence.md](../features/persistence.md)
