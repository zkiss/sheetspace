# Phase 5: Formula Understanding And Spatial Navigation

## Goal

Make calculation flow readable and navigable like code while preserving the spatial character of the workbook.

Phase 2 establishes the first reference jump. Phase 5 completes the understanding workflow: formulas become easier to read and edit, references reveal useful context, data-flow lines connect spatial sources, and navigation remains reversible.

## Included Scope

### Rich formula editing

- Provide a formula-editing surface that complements direct in-cell editing.
- Highlight functions, literals, operators, and references using parser token spans.
- Support multiline editing, indentation, and readable formatting without changing formula meaning.
- Autocomplete supported functions, sheets, cells, ranges, and available custom column names.
- Show inline parse and reference errors while preserving the user's raw formula.

### Reference inspection

- Show hover information for referenced cells and ranges, including current values and error state.
- Distinguish same-sheet, cross-sheet, range, and broken references.
- Extend Phase 2 navigation to every supported reference token in the formula-editing surface.
- Keep navigation and inspection available for formula errors wherever a valid reference token still exists.

### Spatial data-flow visualization

- Draw colored reference lines between a selected formula and its source cells or ranges in workspace coordinates.
- Let users show lines on selection or on demand without forcing an always-on visual mode.
- Allow a user to select a reference line and navigate to its source.
- Keep lines correct while sheets move, resize, overlap, hide, change individual visual scale, or change viewport zoom.

### Navigation tools and history

- Provide Back and Forward navigation for viewport panning and zooming, symbol and formula-reference jumps, and ordinary cell or range selection and movement.
- Keep navigation history independent of edit history. Back and Forward restore viewing context and selection without changing workbook contents or the Undo/Redo stack. Undo and Redo reverse edits without restoring historical selection; their automatic reveal and temporary highlight are feedback, not navigation-history entries.
- Record each location as the selected sheet, cell, or range together with canvas viewport position, zoom, and relevant scrolling within the sheet.
- Group rapid navigation into one transition: retain the location before movement begins, then record the final location after selection and viewport state have both settled for 1–2 seconds. Further selection, pan, zoom, or in-sheet scroll movement restarts the settling interval. Omit intermediate key repeats, drag positions, wheel steps, and animation frames, and avoid duplicate locations.
- Allow Back before the settling interval expires: return to the starting location and retain the current destination for Forward. Replaying history must not generate fresh entries or restart recording through its selection changes or animation.
- Preserve existing forward locations when navigation branches after going Back; define how users traverse those branches.
- Animate long-distance navigation while respecting reduced-motion preferences.
- Add search or command-palette navigation to sheets and relevant workbook targets.
- Add a minimap or overview control if testing shows that history and search do not sufficiently orient users in large workspaces.
- Persist the active viewport and the durable portion of navigation state.

For example, holding an arrow key to move from A1 to A30 and then pausing records A1 and A30, rather than every intervening cell. A continuous pan-and-zoom gesture similarly records its starting view and settled final view. A symbol or reference jump includes the selection and viewport movement needed to reveal its destination in the same transition.

## Completion Signal

- A user can read and edit a complex supported formula without losing its structure or raw content.
- Hover, token navigation, and reference lines make a formula's inputs discoverable without manually searching sheets.
- Reference lines stay spatially attached to their real source and destination when frames move.
- Back and Forward restore selection, viewport position and zoom, and relevant in-sheet scrolling for cell movement, symbol/reference jumps, and spatial navigation, independently of edit Undo/Redo.
- Rapid cell movement or pan-and-zoom activity produces a starting location and one settled destination; Back and Forward skip intermediate motion and remain usable before the settling interval expires.
- Search and overview tools allow a user to find sheets in a workspace too large to scan directly.

## Deferred To Later Phases

- Cell and formula comments are Phase 6.
- Report-element references are Phase 8.
- Structured references and custom-function definitions extend this editor in Phases 9 and 10.

## References

- [04-safe-structural-editing-and-refactoring.md](04-safe-structural-editing-and-refactoring.md)
- [features/formula-editor.md](../features/formula-editor.md)
- [features/references-and-navigation.md](../features/references-and-navigation.md)
- [features/workspace.md](../features/workspace.md)
- [features/interaction-polish.md](../features/interaction-polish.md)
