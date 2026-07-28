# Persistence

## Purpose

User data should be durable. Persistence should save and reload Sheetspace's internal workspace model without forcing that model to match an exchange format.

## Feature Scope

- Save and reload a workspace.
- Preserve sheet names, ids, cells, row metadata, column metadata, frame positions, frame sizes, per-sheet visual scales, and viewport state.
- Persist raw cell strings against stable internal row and column identities. A1 addresses remain a
  user-facing view over ordered rows and columns. Cross-sheet formula strings embed canonical sheet
  ids directly.
- Version saved data for migrations.
- Keep persistence focused on durable application state.

## Open Decisions

- Should persistence be automatic or explicit?
- What database shape best supports the internal workspace model?
- Which saved data should be considered stable enough to migrate across versions?
