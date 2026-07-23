# Phase 4: Safe Structural Editing And Refactoring

## Goal

Let users reshape a workbook while preserving calculation meaning and clearly reporting changes that cannot be made safely.

Phase 3 makes existing grids fluid to edit. Phase 4 makes their structure evolvable: rows and columns can change, meaningful regions can become separate sheets, and users can compare structures before or after a refactor.

## Included Scope

### Rows and columns

- Insert and delete rows or columns at arbitrary positions.
- Reorder rows and columns.
- Provide visible insertion affordances and previews near structural boundaries.
- Maintain stable row or column identity where necessary to preserve meaning across structural edits.
- Define and implement formula behavior for insertion, deletion, reordering, copy, and move operations.
- Rewrite references when the intended target remains valid and produce explicit broken references when it does not.

### Custom column names

- Let users give columns readable names while retaining stable internal identity and A1-style addresses.
- Prevent or clearly resolve naming conflicts within a sheet.
- Display custom names without making formulas dependent on mutable labels.
- Persist names and stable structural metadata.

### Range extraction

- Extract a selected rectangular range into a new sheet placed near the source sheet.
- Support both copy-based and move-based extraction with a clear preview of the result.
- Rewrite formulas inside and outside the extracted region when safe.
- Report references that cannot be rewritten safely before committing the operation.
- Make extraction one undoable operation.

### Structural comparison

- Let users choose two sheets, ranges, or supported table-like regions as left and right comparison targets.
- Show added, removed, and changed values, formulas, and relevant structure in a diff view.
- Support the multi-selection workflow needed to choose comparison targets in the spatial workspace.

## Completion Signal

- Users can insert, delete, and reorder rows or columns without silently redirecting formulas to the wrong data.
- Custom column names improve readability while rename does not break reference identity.
- A dense sheet can be split into nearby source and calculation sheets with a preview, safe rewrites, and an actionable exception report.
- Users can compare two ranges or sheets and understand their material differences.
- Structural state and rewritten formulas remain correct after reload, undo, and redo.

## Deferred To Later Phases

- Rich reference hover, dependency lines, and navigation history are Phase 5.
- Comment behavior is finalized in Phase 6, building on the structural hooks established here.
- Structured table objects and column-wide formulas are Phase 9.

## References

- [03-fluent-spreadsheet-editing.md](03-fluent-spreadsheet-editing.md)
- [features/columns-rows-structure.md](../features/columns-rows-structure.md)
- [features/structure-refactoring.md](../features/structure-refactoring.md)
- [features/references-and-navigation.md](../features/references-and-navigation.md)
- [features/interaction-polish.md](../features/interaction-polish.md)
