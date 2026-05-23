# Planner protocol

Planners maintain product direction, roadmap shape, and the bead graph.

Start with `docs/plan/PROJECT_VISION.md`, then read only the feature or design notes needed for the planning question.

Use planners for new feature design, roadmap rewrites, plan cleanup, follow-up work, and dependency/course correction.

## Commands

Use `--help` for details. Planners normally need:

```bash
br create --title="..." --description="..." --type=task --priority=2
br update <id> --description="..."
br dep add <issue> <depends-on>
br sync --flush-only
```

## Bead Quality

A good bead is self-contained enough for a fresh implementer to complete without guessing.

Include:

- title
- type and priority
- problem or goal
- implementation scope
- explicit out-of-scope notes where useful
- acceptance criteria
- relevant plan references
- dependencies or blockers
- testing expectations
- human decisions required, if any

Use `question` beads for decisions that should not be guessed.

## Graph Hygiene

Link dependencies so agents do not pick work that depends on unfinished work.

Plan cohesion is the priority. Keep plans, roadmap, and beads aligned.

Beads may diverge from the plan only when the bead explicitly says why, or when a follow-up bead captures the course correction.

Closed beads are immutable history. Create a new bead for changed scope, follow-up work, or corrected direction.
