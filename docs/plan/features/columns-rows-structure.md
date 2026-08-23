# Columns, Rows, And Structure

## Purpose

Rows and columns give worksheets their spreadsheet shape. Structural editing should let users reshape sheets while keeping formulas and references understandable.

## Feature Scope

- Use default row numbers.
- Use Excel-style column labels such as `A`, `B`, `C`, `Z`, `AA`, and `AB`.
- Insert and delete rows.
- Insert and delete columns.
- Reorder rows and columns.
- Resize row heights and column widths.
- Allow custom column names.
- Keep stable internal row and column ids.
- Use stable row and column identities as resolved formula targets so structural reordering preserves
  reference meaning while displayed A1 coordinates may change.

## Custom Column Names

Users should be able to rename columns for readability. A renamed column should still have a stable internal column id and a default A1-style address so display names do not unexpectedly break formulas.

Requirements to resolve:

- Custom names should be unique within a sheet or conflicts must be handled clearly.
- Formula references retain stable canonical identities independently of display names.
- The UI can show custom names while preserving standard A1 addressing.

## Open Decisions

- Should custom column names appear in formulas?
