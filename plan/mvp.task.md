# MVP Task

## Goal

Build the first usable Sheetspace iteration after the project skeleton exists.

The MVP should prove the core spatial spreadsheet loop: multiple simple worksheets can be arranged on a 2D workspace, edited as grids, and evaluated with a small formula slice.

Tech stack and project-shell decisions are handled by [tech-skeleton.task.md](tech-skeleton.task.md). This task defines application behavior.

## Included Scope

- Add a scoped implementation of [Spatial Workspace](features/workspace.md): provide a 2D workspace that supports multiple sheets, supports independent sheet positions, allows panning, and allows zooming.
- Add a scoped implementation of [Sheet Frames](features/sheet-frames.md): render each sheet inside an identifiable frame, allow users to create sheets, and allow frames to be moved by dragging their header bars.
- Add a scoped implementation of [Grid Editing](features/grid-editing.md): display a tabular grid with row and column headers, support single-cell selection, edit cell values, commit and display text or numeric values, preserve raw formula text while editing, and display evaluated formula results when not editing.
- Add a scoped implementation of [Formulas](features/formulas.md): treat cell content beginning with `=` as a formula, support `SUM`, support A1-style individual cell references and 2D ranges, recompute formulas after edits, compute formulas independently where possible, and display errors in cells that cannot be computed.
- Add a scoped implementation of [Columns, Rows, And Structure](features/columns-rows-structure.md): start new sheets as empty 10-column by 20-row grids, use default row numbers, use Excel-style column labels such as `A`, `B`, `C`, `Z`, `AA`, and `AB`, and allow users to append rows and columns at the ends of a sheet.
- Add a scoped implementation of [Persistence](features/persistence.md): persist workbook state through a real backend database using a straightforward single-instance read/write path.

The feature briefs provide the full product context. For this task, implement only the behavior explicitly listed above.

## Interaction Details

- New workspaces start empty.
- New sheets start as 10-column by 20-row grids with no cell values.
- Moving a sheet happens through its frame header bar.
- Pressing `Enter` commits an active cell edit.
- Moving focus to another cell or another sheet commits an active cell edit.
- Pressing `Escape` cancels an active cell edit.
- `SUM` should accept a variable number of arguments, where each argument can be an individual cell reference or a 2D range, such as `=SUM(A1)`, `=SUM(A1,B2)`, and `=SUM(A1:C3,D4)`.
- Formula errors should be cell-level results: cells that cannot be computed should display an error while the app continues computing other cells where possible.
- Cells displaying formula errors should remain selectable and editable.
- Cross-sheet formula references may be supported when they fit naturally into the formula implementation.

## Acceptance Criteria

- The app opens to an empty 2D workspace where sheets can be created and arranged.
- A user can create multiple sheets.
- A user can pan and zoom the workspace.
- A user can move sheet frames to different workspace positions by dragging frame headers.
- New sheets start with 10 columns, 20 rows, and no cell values.
- A user can append rows and columns at the ends of a sheet.
- A user can select a single cell and edit text or numeric values.
- A user can enter a `SUM` formula with a variable number of A1-style cell reference and 2D range arguments.
- Formula cells show evaluated results outside edit mode and preserve the original formula text for editing.
- Formula evaluation updates after cell edits.
- A formula error in one cell does not crash the app, block UI interaction, or prevent unrelated formulas from computing.
- A user can select and edit cells that are displaying formula errors.
- Created sheets, grid dimensions, cell content, formulas, and sheet positions persist through the backend database.

## References

- [PROJECT_VISION.md](PROJECT_VISION.md)
- [features/README.md](features/README.md)
- [tech-skeleton.task.md](tech-skeleton.task.md)
- [features/workspace.md](features/workspace.md)
- [features/sheet-frames.md](features/sheet-frames.md)
- [features/grid-editing.md](features/grid-editing.md)
- [features/formulas.md](features/formulas.md)
- [features/columns-rows-structure.md](features/columns-rows-structure.md)
- [features/persistence.md](features/persistence.md)
