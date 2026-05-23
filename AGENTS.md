# Sheetspace agent guidance

## Repository purpose

Sheetspace is a visual spreadsheet workspace: spreadsheet-like tables live in a 2D space, can be linked through formulas, navigated like code, and gradually refactored from conventional spreadsheets into clearer calculation structures.

Product direction lives in `docs/plan/*.md`. Start with `docs/plan/PROJECT_VISION.md`.

## Repo map and commands

This is a Makefile-driven monorepo.

- `frontend/`: React + TypeScript + Vite client.
- `backend/`: Kotlin + Ktor API server.
- `plan/`: product vision, design notes, feature planning, implementation context.
- `.beads/`: Beads issue state exported by `br`; tracked in git.
- Root `Makefile`: setup, compile, test, and build orchestration.

Prefer root commands unless the active bead/debugging context needs something narrower:

```bash
make setup
make test
make compile
make frontend-dist
make build
```

## Core rule

Beads define executable work. The plan is context. The active bead is scope.

Work on one bead at a time unless explicitly instructed otherwise. Use the active bead and its acceptance criteria as the implementation boundary. Do not treat the full plan as permission to implement adjacent features, future ideas, broad refactors, or speculative architecture.

If extra work appears necessary, create or update a bead rather than silently expanding scope.

## Git branch rule

`main` must match `origin/main`. Agents must not commit on `main`, `master`, or the repository default branch.

Before making implementation changes that may be committed, create or switch to a feature branch. When starting from `main` with a clean worktree, use a branch name like:

```bash
git switch -c codex/<bead-id>-<short-description>
```

If work is already in progress on `main`, do not commit there. Either create/switch to a feature branch before committing while preserving the worktree, or leave the changes uncommitted and report that they are ready but not committed.

If a commit is accidentally made on `main`, immediately preserve it on a feature branch, then reset local `main` to `origin/main` before continuing.

## Required protocols

Read the relevant protocol files before acting:

- `docs/agents/beads.md`: Beads, `br`, `bv`, command reference, bead quality, dependencies, state/history rules.
- `docs/agents/implementer.md`: implementation workflow, product decisions, plan/bead consistency, git/session close.
- `docs/agents/reviewer.md`: reviewer role and review protocol.
- `docs/agents/agent-mail.md`: optional Agent Mail coordination and file reservations.

Implementation work must receive a dedicated reviewer subagent review before the bead is considered complete or closed. The implementer must not self-review. If subagents are unavailable, say review could not be performed and do not close the bead unless the user explicitly waives review.

Agent Mail is optional. Use it when MCP tools are available. If it is unavailable, continue using Beads, git, plan files, reviewer subagent output, and the final session summary as the coordination record.

## Start of session

1. Read this file.
2. Read `docs/agents/beads.md`.
3. Read the active role protocol: `implementer.md` or `reviewer.md`.
4. Read `docs/agents/agent-mail.md` if Agent Mail tools are available.
5. Inspect the active bead.
6. Inspect relevant plan sections and existing code.
7. Check git status.
8. Check Agent Mail if available.

After compaction, context reset, or a fresh session, repeat the same recovery sequence. Continue only once the current scope and repo state are clear. If the session appears confused or stale, stop and ask for a fresh instruction rather than guessing.

## Completion rule

A bead is complete only when:

- acceptance criteria are satisfied
- relevant checks have been run, or skipped checks and risks are stated
- dedicated review feedback has been addressed or explicitly recorded
- bead state has been updated
- new follow-up work is captured as beads
- plan/bead inconsistencies have been resolved or recorded

Final response must include: active bead id, what changed, files changed, checks run, checks not run with reason, follow-up beads created or needed, unresolved decisions/risks, and whether review happened.
