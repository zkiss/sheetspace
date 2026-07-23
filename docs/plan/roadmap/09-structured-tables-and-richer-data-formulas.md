# Phase 9: Structured Tables And Richer Data Formulas

## Goal

Make record-oriented sheets explicit enough to prevent formula drift while preserving the freedom to use an ordinary spreadsheet grid.

Earlier phases support strong free-form models. Phase 9 adds an optional semantic table model in which rows are records, columns are properties, and calculated columns have consistent behavior. It also adds the lookup and text tools needed to work effectively with those records.

## Included Scope

### Table object model

- Resolve whether a table is metadata on a normal sheet or a distinct sheet type, then expose one clear user model.
- Treat each data row as a record and each column as a property with stable identity.
- Reuse custom column names while keeping A1 references valid and understandable.
- Define table boundaries, headers, empty rows, row creation, and conversion between free-form ranges and tables.
- Keep table operations compatible with selection, structural edits, extraction, diff, comments, groups, reports, and navigation.

### Calculated columns and consistency

- Define column formulas that apply consistently to current and newly added rows.
- Detect accidental per-row formula drift and let users inspect, accept, or repair exceptions.
- Preserve formula meaning when table rows are inserted, deleted, reordered, imported, or extracted.
- Add inspectable structured references while retaining an unambiguous relationship to canonical A1-style identity.

### Formula growth for structured data

- Add a focused lookup capability, preferring `XLOOKUP` or a clearly documented simplified equivalent over multiple overlapping lookup models.
- Add text basics such as `CONCAT`, `LEFT`, `RIGHT`, and `LEN`.
- Integrate new functions with typed errors, dependency tracking, autocomplete, navigation, and conditional evaluation rules.

### Reports and interchange

- Let report elements use table columns as durable data sources.
- Import and export supported XLSX table structures where semantics can be preserved.
- Preserve complete table metadata in versioned persistence and Sheetspace JSON.

## Completion Signal

- A user can convert a record-shaped range into an explicit table without losing values, formulas, comments, or stable references.
- Calculated columns stay consistent as records change, and formula exceptions are visible rather than silently drifting.
- Lookup and text formulas support common joins, labels, and record transformations.
- Tables participate predictably in extraction, diff, reports, navigation, persistence, and exchange.

## Deferred To Later Phases

- Relational database constraints, arbitrary schema programming, and a full query language are out of scope.
- Reusable workbook-defined functions and any imperative logic are Phase 10.

## References

- [08-report-sheets-and-visualization.md](08-report-sheets-and-visualization.md)
- [features/table-object-model.md](../features/table-object-model.md)
- [features/columns-rows-structure.md](../features/columns-rows-structure.md)
- [features/formulas.md](../features/formulas.md)
- [features/report-sheets.md](../features/report-sheets.md)
