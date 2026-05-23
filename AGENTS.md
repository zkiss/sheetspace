# Sheetspace agent guidance

## Repository purpose

Sheetspace is a visual spreadsheet workspace: spreadsheet-like tables live in a 2D space, can be linked through formulas, navigated like code, and gradually refactored from conventional spreadsheets into clearer calculation structures.

Product direction lives in `docs/plan/*.md`. Start with `docs/plan/PROJECT_VISION.md`.

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

Beads define executable work. The plan is context. The active bead is scope.

Never commit on `main`.
Keep `main` refreshed to `origin/main`.
Closed beads are history. Do not modify them.

## Role Guides

Read only the guides relevant to the role you are performing:

- `docs/agents/implementer.md`: execute one bead through review and merge.
- `docs/agents/reviewer.md`: review implementation work without editing.
- `docs/agents/planner.md`: shape plans, roadmap, and bead graph.

After compaction or a fresh session, reload this file, the relevant role guide, the active bead if any, relevant plan context, and git status before continuing.
