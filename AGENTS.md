# Sheetspace agent guidance

## Repository purpose

Sheetspace is a visual spreadsheet workspace: spreadsheet-like tables live in a 2D space, can be linked through formulas, navigated like code, and gradually refactored from conventional spreadsheets into clearer calculation structures.

Product direction lives in `docs/plan/`. Start with `docs/plan/PROJECT_VISION.md`.
Delivery sequence lives in `docs/plan/roadmap/`, ordered by the two-digit filename prefixes.

## Repo

This is a Makefile-driven monorepo with `frontend/` and `backend/` applications.

Prefer root commands unless current context needs something narrower:

```bash
make setup
make test
make compile
make frontend-dist
make build
```

## Beads

Beads are durable backlog and history, not live workflow state. Closed Beads are immutable.

Use `br` to inspect, create, update, close, and link Beads. Use `bv` for dependency-aware backlog analysis and prioritization. Read the tools' current agent guidance before using them:

```bash
br robot-docs guide
bv --robot-help
```

Prefer `bv`'s machine-readable `--robot-*` commands; bare `bv` opens an interactive interface. After changing Beads, run `br sync --flush-only` and include the resulting `.beads/issues.jsonl` change in the Deliverable.

## Work and delivery

Choose the execution path before implementation. Use `devflow-runner` when the user explicitly requests it. If the user has not selected an execution path, ask whether to use Devflow.

The outer agent—the agent handling the user's request—owns the Git branch lifecycle for every Deliverable:

1. Before starting work, refresh local `main` from `origin/main` once.
2. Create a dedicated Deliverable branch from the refreshed `main`.
3. Use `<bead-id>-<summary-slug>` for a Bead-backed branch and `<summary-slug>` for any other branch.
4. Complete the work on that branch, either directly or through Devflow.
5. Push the completed Deliverable branch.
6. Only when the user asks, squash-merge the branch into `main` and push `main`.

When Devflow is selected, prepare the Deliverable branch before invoking `devflow-runner`. Devflow works entirely on that branch and stops when the work is complete. It does not create, switch, push, or merge branches.

Use a concise squash-merge commit message that summarizes what changed, not how or why it changed.
For a Bead-backed Deliverable, start the message with `<bead-id>:`.

Never implement or make ordinary commits on `main`; Deliverables reach `main` only through a user-authorized squash merge.

## Code quality

Build the requested behavior cleanly. Make every reasonable in-scope effort to follow SOLID and DRY during feature work:

- Keep production and test files small, cohesive, and focused on one responsibility.
- Split large test suites by behavior theme when that improves focus, including tests for the same class or component.
- Centralize repeated knowledge and behavior instead of copying patterns.
- Keep interfaces focused, dependencies pointed toward the appropriate abstraction, and responsibilities separated so one module has one primary reason to change.

Take initiative when implementation exposes maintainability opportunities in the code being changed. Complete straightforward cleanup that keeps the work coherent and stays within the Deliverable. Do not defer correctness, security, regression, acceptance-criteria, or avoidable code-quality problems in the changed work.

When that code could materially benefit from broader refactoring, create a follow-up refactor Bead to investigate and define a coherent approach. Record the source Deliverable, affected code, and concrete evidence, then surface the Bead ID to the user. Keep the broader refactoring outside the current Deliverable unless the user expands its scope.
