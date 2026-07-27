# Sheetspace agent guidance

## Repository purpose

Sheetspace is a visual spreadsheet workspace: spreadsheet-like tables live in a 2D space, can be linked through formulas, navigated like code, and gradually refactored from conventional spreadsheets into clearer calculation structures.

Product direction lives in `docs/plan/`. Start with `docs/plan/PROJECT_VISION.md`.
Delivery sequence lives in `docs/plan/roadmap/`, ordered by the two-digit filename prefixes.

## Repo

This is a Makefile-driven monorepo.

- `frontend/`: React + TypeScript + Vite client.
- `backend/`: Kotlin + Ktor API server.
- `docs/plan/`: product vision, design notes, feature planning, implementation context.
- `.beads/`: Beads issue state exported by `br`; tracked in git.

Prefer root commands unless current context needs something narrower:

```bash
make setup
make test
make compile
make frontend-dist
make build
```

## Working Preferences

Beads define executable work. The plan is context. The active bead is scope. When a bead is active, complete its stated scope and keep the work within that boundary. Scope changes require explicit direction.

Use Beads for product work: behavior changes, new features, and other work that contributes to realizing the project vision. Non-product work such as agent guidance, build tooling, scripts, and plan maintenance can be completed directly without a bead.

For an ad hoc task, decide whether it contributes to the project vision. Complete non-product tasks directly. If the task is product work without a bead, offer to create one before implementation and create it only with the user's agreement.

Agents may create a new bead when implementation or plan review reveals product work needed to realize the vision that no open bead captures and that falls outside the active bead. The new bead records the gap while the active work remains within its original scope.

Use Question Beads for unresolved decisions that block executable implementation.
Closed beads are history. Do not modify them.

Never commit on `main`.
Keep `main` refreshed to `origin/main`.

## Role Guides

Read only the guides relevant to the role you are performing:

- `docs/agents/implementer.md`: execute one bead through review and merge.
- `docs/agents/reviewer.md`: review implementation work without editing.
- `docs/agents/planner.md`: shape plans, roadmap, and bead graph.

After compaction or a fresh session, reload this file, the relevant role guide, the active bead if any, relevant plan context, and git status before continuing.
