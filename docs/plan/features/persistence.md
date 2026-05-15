# Persistence

## Purpose

User data should be durable. Persistence should save and reload Sheetspace's internal workspace model without forcing that model to match an exchange format.

## Feature Scope

- Save and reload a workspace.
- Preserve sheet names, ids, cells, row metadata, column metadata, frame positions, frame sizes, and viewport state.
- Version saved data for migrations.
- Keep persistence focused on durable application state.

## Open Decisions

- Should persistence be automatic or explicit?
- What database shape best supports the internal workspace model?
- Which saved data should be considered stable enough to migrate across versions?
