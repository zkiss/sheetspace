# Phase 8: Report Sheets And Visualization

## Goal

Let users turn live spreadsheet calculations into presentation-oriented reports that remain spatially close to their sources.

Phase 7 makes tabular work portable. Phase 8 adds a distinct output surface for explaining results without forcing dashboards and narrative layouts into ordinary grids.

## Included Scope

### Report sheet model

- Resolve and implement a report-sheet model distinct enough to support free placement while sharing workbook identity, navigation, persistence, and references with tabular sheets.
- Create, name, move, resize, order, group, hide, and persist report sheets using established workspace behaviors.
- Allow report sheets to live beside their source tables and participate in search and navigation history.

### Report elements

- Place and resize linked cell values, text boxes, and an initial set of charts or graphs on a report canvas.
- Link report elements to source cells or ranges using stable reference identity.
- Recalculate linked elements when their sources change and show source errors without breaking the rest of the report.
- Provide report-appropriate number, text, color, alignment, and layout formatting.
- Reuse reference inspection and navigation so users can trace a report element back to its data.

### Initial visualization set

- Support a focused initial set of charts chosen for common analytical work, such as line, bar, and scatter charts.
- Configure data ranges, labels, series, titles, legends, and basic axes without exposing an unrestricted design system.
- Handle empty, invalid, or differently sized source ranges explicitly.

### Persistence and interchange

- Preserve report sheets and elements in versioned persistence and Sheetspace JSON.
- Extend XLSX export only where a report element has a faithful representation; otherwise include it in the compatibility report.

## Completion Signal

- A user can build a spatially arranged report from live values and ranges without duplicating source data.
- Report elements update after source edits and remain traceable to their inputs.
- Reports persist and survive full Sheetspace JSON round trips.
- Unsupported exchange behavior is disclosed rather than silently dropping report content.

## Deferred To Later Phases

- A general-purpose vector design tool, slide editor, animation system, or exhaustive chart catalog is out of scope.
- Structured-table-aware chart sources arrive in Phase 9.
- Programmable report elements depend on the custom-function decisions in Phase 10.

## References

- [phase7.task.md](phase7.task.md)
- [features/report-sheets.md](features/report-sheets.md)
- [features/references-and-navigation.md](features/references-and-navigation.md)
- [features/persistence.md](features/persistence.md)
- [features/import-export.md](features/import-export.md)

