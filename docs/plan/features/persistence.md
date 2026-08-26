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

## Saved-sheet operation boundary

Saved-sheet edits follow one directional path:

1. The controller constructs a typed, data-only workbook operation with a stable operation ID.
2. The operation application layer applies it optimistically exactly once and returns the next workbook, its calculation impact, and an optional persistence intent.
3. Calculation consumes only the returned impact. It does not know about transport attempts or retry policy.
4. The in-memory outbox retains the data-only intent and operation ID, orders work by affected sheets, and coalesces only transient frame moves.
5. A controller-owned persistence coordinator shares one monotonic revision ledger and confirmed-missing sheet lifecycle across the replayable outbox and non-replayable axis queue.
6. The persistence transport converts an intent into revision-aware API calls, reloads revision tokens on conflicts, and reports backend revisions or missing sheets for reconciliation. When a compound z-order conflict confirms one member missing, it persists the surviving updates before reporting success.

Retries move a retained failed outbox entry back to queued state. They preserve its operation ID and payload and never invoke optimistic application again. The outbox deliberately stores neither executable request closures nor React state; React subscribes to immutable snapshots to derive saved, saving, and failed status.

Sheet, row, and column creation remain backend-authoritative and non-replayable. Their temporary frames or axis slots are projections of data-only creation records and disappear when the request succeeds or fails. A creation-only failure therefore contributes to the combined failed status but does not enable the saved-operation retry command.

## Open Decisions

- Should persistence be automatic or explicit?
- What database shape best supports the internal workspace model?
- Which saved data should be considered stable enough to migrate across versions?
