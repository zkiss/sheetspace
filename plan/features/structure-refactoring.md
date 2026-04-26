# Structure Refactoring

## Purpose

One long-term differentiator is making spreadsheet restructuring safer. Users should be able to split dense sheets, extract related regions, and understand what references will change.

## Feature Scope

- Select a rectangular range and extract it into a new sheet.
- Create the new sheet near the original sheet.
- Support copy-based extraction and move-based extraction.
- Rewrite formulas where safe.
- Report formulas that cannot be rewritten safely.
- Support sheet or range diff views for selected tables.

## Open Decisions

- Should extraction default to copy or move?
- Should formulas outside the extracted range update automatically?
- What should happen to formulas inside the extracted range that reference cells outside it?
