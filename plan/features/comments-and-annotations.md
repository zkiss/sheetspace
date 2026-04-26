# Comments And Annotations

## Purpose

Comments let users explain assumptions, caveats, decisions, and review notes without changing cell values or formulas.

## Feature Scope

- Add comments to individual cells.
- Show a visible marker for cells with comments.
- Open comments without disrupting cell editing.
- Allow comments on ranges if that proves useful.
- Keep comments attached to cells through supported row and column operations.
- Consider formula comments separately from cell comments.

## Open Decisions

- Should comments be plain text, rich text, or markdown-like?
- Should comments support threads and resolution states?
- How should comments behave when a range is copied, moved, or extracted?
