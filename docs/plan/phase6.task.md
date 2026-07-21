# Phase 6: Organized And Explained Workspaces

## Goal

Help users keep large spatial models understandable by adding durable explanations and workspace-level organization.

Phase 5 makes calculation paths inspectable. Phase 6 adds the human context around those paths and lets users control which parts of a large workspace are visible or prominent.

## Included Scope

### Comments and annotations

- Add durable comments to individual cells with a visible but unobtrusive marker.
- Open, edit, and close comments without disrupting cell editing or reference inspection.
- Support range comments if interaction testing shows a clear, understandable model.
- Define and implement comment behavior for copy, move, clear, row or column edits, extraction, undo, and redo.
- Add formula comments using a documented representation that remains inspectable and portable.

### Frame visibility and workspace selection

- Collapse or minimize sheet frames while preserving their identity and position.
- Hide and restore sheets without breaking formulas, search, or reference navigation.
- Support workspace-level multi-selection for organizing several frames together.
- Keep frame visibility, size, position, and z-order deterministic and durable.

### Groups, layers, and sectors

- Group related sheets independently of their formula relationships and move all sheets in an explicitly selected group by a shared workspace delta.
- Represent groups as flat membership over independently positioned sheets.
- Show, hide, filter, and navigate groups.
- Let users define meaningful named sectors of workspace space and navigate to them.
- Add layers only as an explicit visibility or presentation mechanism with clear ordering semantics; do not create a second ambiguous grouping system.
- Define how groups, layers, and sectors interact with hidden sheets, navigation history, search, minimaps, and reference lines.
- Persist all organization metadata as part of the workspace model.

## Completion Signal

- Users can explain assumptions and review notes without altering formulas or values.
- Comments stay attached to the intended content through supported editing and structural operations.
- A large workspace can be divided into named, navigable areas and filtered sets of sheets.
- Related sheets can be moved together through an explicit flat group while retaining absolute per-sheet coordinates, independent scales, and flat overlap semantics.
- Hidden or collapsed sources remain safe: formulas keep their identity, and navigation clearly offers to reveal a target when needed.
- Workspace organization and annotations survive reload and portable JSON round trips once Phase 7 is complete.

## Deferred To Later Phases

- Threaded collaboration, mentions, permissions, and real-time multi-user editing are not part of the current vision.
- Presentation canvases and charts are Phase 8.
- Table-specific annotations and custom-function documentation build on this model in Phases 9 and 10.

## References

- [phase5.task.md](phase5.task.md)
- [features/comments-and-annotations.md](features/comments-and-annotations.md)
- [features/grouping-and-organization.md](features/grouping-and-organization.md)
- [features/sheet-frames.md](features/sheet-frames.md)
- [features/workspace.md](features/workspace.md)
