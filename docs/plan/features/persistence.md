# Persistence

## Purpose

User data should be durable. Persistence should save and reload Sheetspace's internal workspace model without forcing that model to match an exchange format.

## Feature Scope

- Save and reload a workspace.
- Preserve sheet names, ids, cells, row metadata, column metadata, frame positions, frame sizes, per-sheet visual scales, and viewport state.
- Persist canonical cell strings against stable internal row and column identities. Resolved formula
  references also use stable row and column identities, while explicit cross-sheet qualifiers use
  stable sheet identities. A1 addresses and sheet names remain user-facing projections.
- Version saved data for migrations.
- Keep persistence focused on durable application state.
- Store sparse row-height and column-width overrides separately from tabular contents and frame
  state, keyed by stable row and column identities. Current sheet reads and creates expose both
  override maps, including empty maps for inherited dimensions. Targeted presentation writes use
  the sheet revision and apply atomically; a null size removes the target override. Invalid sizes,
  duplicate targets, and identities outside the requested sheet or axis reject the entire write.
  Dimensions follow the limits in [Grid Editing](grid-editing.md).

## Open Decisions

- Should persistence be automatic or explicit?
- What database shape best supports the internal workspace model?
- Which saved data should be considered stable enough to migrate across versions?
