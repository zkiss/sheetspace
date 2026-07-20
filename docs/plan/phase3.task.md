# Phase 3: Fluent Spreadsheet Editing

## Goal

Make Sheetspace efficient for sustained, familiar spreadsheet work instead of requiring cell-at-a-time interaction.

Phase 2 makes small models calculable and introduces reference navigation. Phase 3 improves the everyday editing loop: users can select and manipulate ranges, work primarily from the keyboard, repeat formulas, recover from mistakes, and control the visible grid without losing the spatial context.

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
- Clear and move selected ranges with predictable reference and comment hooks for later features.
- Provide a fill handle for repeating values, patterns, and formulas across rows or columns.
- Make multi-cell operations atomic from the user's perspective.

### Undo and redo

- Add workbook-aware undo and redo for cell edits and Phase 3 range operations.
- Preserve correct formula results, selection, and persistence after undo or redo.
- Define transaction boundaries so a paste or fill action is undone as one action.

### Sizing, formatting, and zoom behavior

- Resize sheet frames from their edges or corners and persist frame size.
- Resize row heights and column widths and persist their metadata.
- Add a focused initial set of value and presentation formatting.
- Disable detailed cell editing when a sheet is too small to read at the current zoom, while keeping navigation and sheet selection available.
- Respect reduced-motion preferences in selection and focus transitions.

## Completion Signal

- A user can enter and revise a medium-sized table without relying on repeated pointer-driven single-cell edits.
- Range copy, paste, clear, move, and fill preserve raw formulas and produce correct recalculation.
- Undo and redo reliably reverse and restore compound grid actions.
- Sheet, row, and column sizing plus supported formatting survive reload.
- Zoomed-out sheets remain understandable without exposing unusable editing controls.

## Deferred To Later Phases

- Row and column insertion, deletion, reordering, custom names, and extraction are Phase 4.
- Rich formula editing and deeper reference visualization are Phase 5.
- Comments, groups, layers, and frame hiding are Phase 6.
- Import/export and report-oriented formatting are later phases.

## References

- [phase2.task.md](phase2.task.md)
- [features/grid-editing.md](features/grid-editing.md)
- [features/sheet-frames.md](features/sheet-frames.md)
- [features/interaction-polish.md](features/interaction-polish.md)
- [features/persistence.md](features/persistence.md)
