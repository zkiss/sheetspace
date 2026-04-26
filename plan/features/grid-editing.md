# Grid Editing

MVP importance: Required.

## Purpose

Each sheet needs a familiar spreadsheet grid. The first implementation should support only enough behavior to make a sheet useful as a simple worksheet.

## MVP Slice

- Display a tabular grid.
- Show row and column headers.
- Select a single cell.
- Edit a cell value.
- Commit and display text or numeric values.
- Preserve raw formula text for formula cells while displaying evaluated results when not editing.

## MVP Limitations

- No multi-cell selection.
- No row insertion or deletion.
- No column insertion or deletion.
- No row or column reordering.
- No row height or column width resizing.
- No copy/paste beyond any browser-native text editing behavior.
- No fill handle.
- No formatting.
- No undo/redo unless already provided by the surrounding state layer.

## Long-Term Scope

- Select cells, ranges, rows, and columns.
- Insert and delete rows and columns.
- Reorder rows and columns.
- Resize row heights and column widths.
- Copy, paste, clear, and move ranges.
- Undo and redo user actions.
- Preserve formula text while showing evaluated values.
- Match spreadsheet keyboard conventions where practical.

## Open Decisions

- What fixed row and column count should the first version start with?
- Should empty cells be stored explicitly or implied?
- How much keyboard behavior is required before the grid feels usable?
