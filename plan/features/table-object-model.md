# Table Object Model

MVP importance: Research.

## Purpose

Some sheets represent structured records where each row is an object and each column is a property. Sheetspace could eventually provide a table model that makes this pattern explicit.

## MVP Slice

- Not part of the MVP.

## MVP Limitations

- No typed tables.
- No object-style rows.
- No property-based formulas.
- No enforcement that formulas are consistent down a column.

## Long-Term Scope

- Treat one row as one object.
- Treat columns as object properties.
- Define column formulas that apply consistently across rows.
- Make table structure explicit without losing spreadsheet flexibility.
- Help users avoid accidental formula drift in structured tables.

## Open Decisions

- Is this a special sheet type or metadata on normal sheets?
- How strict should formula consistency be?
- How should object-style references coexist with A1 references?
