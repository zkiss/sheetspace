# Grid Editing

## Purpose

Each sheet needs a familiar spreadsheet grid. Grid editing should feel recognizable to users who know Excel or Google Sheets while fitting the spatial workspace.

## Feature Scope

- Display a tabular grid.
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
- Support formatting for values and presentation.

## Open Decisions

- Should empty cells be stored explicitly or implied?
- How much keyboard behavior is required before the grid feels usable?
