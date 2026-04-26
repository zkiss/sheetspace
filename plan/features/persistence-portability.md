# Persistence And Portability

MVP importance: Deferred.

## Purpose

User data should eventually be durable and portable. The first product can be simple, but the model should not block save/load or import/export later.

## MVP Slice

- Persistence is not required by the MVP task unless the project skeleton already includes a simple state persistence path.
- The MVP should still keep workbook state in a shape that can be serialized later.

## MVP Limitations

- No cloud sync.
- No collaboration.
- No XLSX import/export.
- No CSV import/export.
- No file format migration system.
- No user accounts or permissions.

## Long-Term Scope

- Save and reload a workspace.
- JSON export/import for full workspace state.
- CSV import/export per sheet.
- XLSX import/export.
- Version saved data for migrations.
- Preserve sheet names, ids, cells, row metadata, column metadata, frame positions, frame sizes, and viewport state.

## Suggested Progression

1. In-memory workbook state.
2. Local browser persistence.
3. JSON export/import.
4. CSV import/export per sheet.
5. XLSX import/export.
6. Cloud sync or collaboration if the product direction requires it.

## Open Decisions

- Should local persistence be automatic or explicit?
- What is the first durable file format?
- Which data should be considered stable public schema?
