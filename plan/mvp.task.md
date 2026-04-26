# MVP Task

## References

- [PROJECT_VISION.md](PROJECT_VISION.md)
- [features/README.md](features/README.md)
- [features/workspace.md](features/workspace.md)
- [features/sheet-frames.md](features/sheet-frames.md)
- [features/grid-editing.md](features/grid-editing.md)
- [features/formulas.md](features/formulas.md)
- [features/columns-rows-structure.md](features/columns-rows-structure.md)

## Scope

Build the first usable Sheetspace iteration after the project skeleton exists.

The MVP includes:

- Basic tabular worksheets.
- Multiple sheets in one workspace.
- Freely positioned sheets in 2D space.
- Workspace panning and zooming.
- Basic single-cell selection and editing.
- Text and numeric cell values.
- Formula cells beginning with `=`.
- `SUM` as the only required formula function.
- A1-style default column labels.

## Limitations

- Do not specify or change the tech stack in this task.
- No sheet resizing.
- No jump-to-definition.
- No jump-to-sheet.
- No hover inspection.
- No navigation history.
- No visual reference lines.
- No custom column names.
- No row or column reordering.
- No advanced formula set beyond `SUM`.
- No formula recalculation optimization requirement; full workspace recalculation on edit is acceptable.
- No structural refactoring.
- No report sheets.
- No groups, layers, or sectors.
- Cross-sheet formulas are not required for the MVP unless they fall out naturally from the implementation.
