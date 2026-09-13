# Grid Editing

## Purpose

Each sheet needs a familiar spreadsheet grid. Grid editing should feel recognizable to users who know Excel or Google Sheets while fitting the spatial workspace.

## Feature Scope

- Display a tabular grid.
- Resize rows and columns independently using logical dimensions tied to stable axis identities.
  Rows inherit a height of 26.4 and columns a width of 76 unless explicitly overridden.
  Row heights range from 16 to 1000; column widths range from 24 to 2000, inclusive.
  Removing an override restores the inherited dimension without changing other overrides, cells,
  or the sheet frame.
- Show row and column headers.
- Select cells, ranges, rows, and columns.
- Edit cell values.
- Commit and display text or numeric values.
- Commit an active cell edit when the user presses `Enter`.
- Commit an active cell edit when focus moves to another cell or another sheet.
- Cancel an active cell edit when the user presses `Escape`.
- Preserve raw formula text for formula cells while displaying evaluated results when not editing.
- Match spreadsheet keyboard conventions where practical.
- Copy, paste, clear, and move ranges.
- Provide undo and redo for user actions.
- Support fill-handle workflows.
- Support value and presentation formatting at column, row, and cell level, combining individual properties through inheritance and explicit cell overrides.

## Open Decisions

- Should empty cells be stored explicitly or implied?
- How much keyboard behavior is required before the grid feels usable?
