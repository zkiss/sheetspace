# Phase 7: Durable Interchange

## Goal

Let users safely move data and workspaces into and out of Sheetspace without forcing the internal product model to resemble an exchange format.

Earlier phases make the internal workspace useful and durable in its database. Phase 7 adds explicit portability, schema evolution, and transparent compatibility reporting so real work can enter, leave, and survive product upgrades.

## Included Scope

### Versioned workspace durability

- Version the complete saved workspace shape and provide tested migrations for durable state introduced by earlier phases.
- Define automatic versus explicit save behavior and expose clear saving, saved, failed, and recovery states.
- Make interrupted or invalid writes recoverable without silently replacing the last valid workspace.
- Validate load and migration behavior against representative small and medium workbooks.

### Sheetspace JSON

- Export and import the full supported workspace state as a versioned Sheetspace JSON format.
- Preserve sheet ids, canonical formulas, grid structure, metadata, frame position, frame size, per-sheet visual scale, viewport, annotations, and organization state.
- Validate an import before replacing current state and report incompatible or malformed content.
- Define identity-remapping behavior when imported content is added to an existing workspace.

### CSV exchange

- Import CSV data into a new or chosen tabular sheet with an explicit delimiter, encoding, and header interpretation.
- Export a selected sheet or range to CSV.
- Clearly explain that formulas, formatting, layout, comments, and other Sheetspace-specific state are flattened or omitted.

### XLSX exchange

- Import a documented, practical XLSX subset covering ordinary worksheets, values, supported formulas, and compatible formatting.
- Export tabular sheets and supported formulas to XLSX where semantics are preserved.
- Produce a compatibility report for unsupported formulas, workbook features, formatting, charts, and spatial-only metadata.
- Prefer explicit loss reporting over silent approximation.

## Completion Signal

- A full JSON export can restore the supported workspace without losing Sheetspace-specific identity or spatial organization.
- CSV import/export works predictably for tabular data and discloses lossy behavior.
- Common XLSX workbooks import into usable sheets, and export identifies every known unsupported or lossy feature.
- Failed imports leave the existing workspace intact.
- Saved workspaces remain loadable across supported schema versions, with migration failures surfaced clearly.

## Deferred To Later Phases

- Perfect Excel compatibility, macros, external data connections, and unsupported proprietary features are not goals.
- Report, table, and custom-function exchange extensions arrive with Phases 8–10 and must follow the same compatibility-reporting contract.

## References

- [06-organized-and-explained-workspaces.md](06-organized-and-explained-workspaces.md)
- [features/persistence.md](../features/persistence.md)
- [features/import-export.md](../features/import-export.md)
- [features/formulas.md](../features/formulas.md)
