# Sheetspace agent guidance

## Repository purpose

Sheetspace is a visual spreadsheet workspace: spreadsheet-like tables live in a 2D space, can be linked through formulas, navigated like code, and gradually refactored from conventional spreadsheets into clearer calculation structures.

Product direction lives in `docs/plan/`. Start with `docs/plan/PROJECT_VISION.md`.
Delivery plans live in `docs/plan/roadmap/`, ordered by the two-digit filename prefixes. Keep completed phases as historical context and plan only the next phase. Define each subsequent phase after completing the current one, using what was learned; keep longer-term direction in the vision and feature briefs rather than speculative phase plans.

## Documentation scope

Use product vision, plans, and other documentation to guide implementation. Create, edit, move, or delete documentation only when the requested work explicitly includes documentation or clearly aims to rework it. This includes new files under `docs/`; feature implementation alone does not authorize documentation changes.

If implementation reveals a conflict with documented direction, raise it with the user rather than rewriting the documentation to match the code.

## Coding rules

Read and follow [constitution.md](constitution.md) before coding or testing. It defines the rules for design, dependencies, tests, quality gates, and refactoring.

## Agent verification

Rely primarily on automated tests that follow the constitution and existing test conventions. After implementation, use ad hoc Playwright checks against the running application when they would add value, especially for UI interactions, focus, rendering, and behavior not adequately exercised by the automated suite. Use the same approach for bug reproduction. Keep these exploratory scripts uncommitted; adding or revamping automated browser-test infrastructure requires separate scope.

Human manual acceptance testing in the real user environment, such as interactive Chrome and desktop integration, remains the user's responsibility. Ad hoc agent-driven Playwright verification supplements automated tests; it does not replace human acceptance testing.

When creating or updating Beads, distinguish committed automated regression tests, ad hoc agent-driven Playwright verification where useful, and human acceptance checks. Agent completion criteria must be executable by the agent; keep human-only checks separate rather than making them an agent completion gate. Do not require a committed Playwright regression test merely because Playwright was useful for reproducing or verifying the issue.

## Repository commands

This is a Makefile-driven monorepo with `frontend/` and `backend/` applications.

Prefer root commands unless current context needs something narrower:

```bash
make setup
make test
make compile
make frontend-dist
make build
```

## Compatibility and test environments

Sheetspace has no deployed environment to support. Each test run uses a fresh, ephemeral environment.

Breaking changes are acceptable. Target a freshly created environment rather than preserving previous versions: do not add migrations, backward-compatible APIs, legacy data support, or compatibility layers.

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

A Deliverable is the coherent set of changes that completes the requested work. The outer agent—the agent handling the user's request—owns its Git branch lifecycle:

1. Before starting work, refresh local `main` from `origin/main` once.
2. Create a dedicated Deliverable branch from the refreshed `main`.
3. Use `<bead-id>-<summary-slug>` for a Bead-backed branch and `<summary-slug>` for any other branch.
4. Complete the work on that branch, either directly or through Devflow.
5. Push the completed Deliverable branch.
6. Only when the user asks, close the associated Bead, if any, squash-merge the branch into `main`, and push `main`.

When Devflow is selected, prepare the Deliverable branch before invoking `devflow-runner`. Devflow works entirely on that branch and stops when the work is complete. It does not create, switch, push, or merge branches.

Use a concise squash-merge commit message that summarizes what changed, not how or why it changed.
For a Bead-backed Deliverable, start the message with `<bead-id>:`.

Never implement or make ordinary commits on `main`; Deliverables reach `main` only through a user-authorized squash merge.
