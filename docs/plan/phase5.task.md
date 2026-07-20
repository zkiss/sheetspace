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
- Keep lines correct while sheets move, resize, overlap, hide, or change zoom.

### Navigation tools and history

- Add back and forward navigation for reference jumps and meaningful workspace movement.
- Define which settled workspace locations enter history and how branching forward history behaves.
- Animate long-distance navigation while respecting reduced-motion preferences.
- Add search or command-palette navigation to sheets and relevant workbook targets.
- Add a minimap or overview control if testing shows that history and search do not sufficiently orient users in large workspaces.
- Persist the active viewport and the durable portion of navigation state.

## Completion Signal

- A user can read and edit a complex supported formula without losing its structure or raw content.
- Hover, token navigation, and reference lines make a formula's inputs discoverable without manually searching sheets.
- Reference lines stay spatially attached to their real source and destination when frames move.
- Back and forward navigation makes long-distance jumps reversible and predictable.
- Search and overview tools allow a user to find sheets in a workspace too large to scan directly.

## Deferred To Later Phases

- Cell and formula comments are Phase 6.
- Report-element references are Phase 8.
- Structured references and custom-function definitions extend this editor in Phases 9 and 10.

## References

- [phase4.task.md](phase4.task.md)
- [features/formula-editor.md](features/formula-editor.md)
- [features/references-and-navigation.md](features/references-and-navigation.md)
- [features/workspace.md](features/workspace.md)
- [features/interaction-polish.md](features/interaction-polish.md)

