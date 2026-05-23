# Beads reference

Beads are the durable issue-tracking system for this repo.

- `bv` reads the bead graph and recommends useful work.
- `br` mutates bead state: create, update, close, dependencies, sync.
- `.beads/` is tracked in git; after bead mutations, export/sync it and include it in the same feature-branch commit as the code/docs changes. Never commit bead mutations directly on `main`.

Use `bv` for choosing work. Use `br` for managing work. Do not parse or edit `.beads/`.

Use the help menu to understand usage, if the documentation here is insufficient.

```bash
br --help
br <subcommand> --help
bv --help
bv <subcommand> --help
```

## Using bv

Use only `bv --robot-*` commands. Bare `bv` may launch an interactive UI and block the session.

```bash
bv --robot-next --format toon
```

## Using br

```bash
br create --title="..." --description="..." --type=task --priority=2
br ready
br show <id>
br search "keyword"
br update <id> --status=in_progress
br update <id> --description="..."
br dep add <issue> <depends-on>
br close <id> --reason="Completed"
```

Use `br sync --flush-only` before committing bead changes, then stage `.beads/` on the feature branch:

```bash
br sync --flush-only
git add .beads/
```

## What belongs in a bead

A good bead is self-contained enough for a fresh agent to work from it.

Include:

- title
- type and priority
- problem / goal
- implementation scope
- explicit out-of-scope notes where useful
- acceptance criteria
- relevant plan references
- dependencies / blockers
- testing expectations
- human decisions required, if any

Task types:

- `task`
- `bug`
- `feature`
- `epic`
- `chore`
- `docs`
- `question`

Priorities:

- `0`: P0 critical
- `1`: P1 high
- `2`: P2 medium
- `3`: P3 low
- `4`: P4 backlog

Use `question` or `ask-human` style beads for decisions that should not be guessed.

## Closed beads

Closed beads are immutable history.

Do not change the scope, acceptance criteria, description, or dependencies of a closed bead to account for newly discovered work or changed decisions. Create a new bead, or update an open dependent bead, and reference the closed bead for context.

Only correct closed bead metadata for clerical/export errors when explicitly instructed.
