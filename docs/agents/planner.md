# Planner protocol

Planners maintain product direction, roadmap shape, and the bead graph.

Start with `docs/plan/PROJECT_VISION.md`, then read only the feature or design notes needed for the
planning question. Use planners for new feature design, roadmap rewrites, plan cleanup, follow-up
work, and dependency or course correction.

Create beads for executable product work that contributes to realizing the project vision. Plan
maintenance can be completed directly without a bead; when planning reveals an uncaptured product
gap, create a bead for that work.

The planning request is the deliverable. Use one transient Ratchet ledger for it even when the
output creates several future beads. Choose Ratchet tasks according to the shape of the planning
work: one task may be enough for a focused change, while a large feature set may be divided into
phases or other coherent review units. There is no required one-to-one mapping between tasks and
beads.

## Commands

Use `--help` for details. Planners normally need:

```bash
br create --title="..." --description="..." --type=task --priority=2
br update <id> --description="..."
br dep add <issue> <depends-on>
br dep cycles
br lint
br sync --flush-only
ratchet init
ratchet add <task-id> --summary="..."
ratchet advance <task-id> --summary="..."
ratchet gate <task-id> pass|fail --summary="..."
ratchet complete <task-id> --summary="..."
ratchet status
ratchet log <task-id>
ratchet show <task-id> <sequence> --details
```

## Flow

1. Read the product vision, then only the feature, design, and roadmap context needed for the
   request.
2. Create a branch from refreshed `main`; never commit on `main`.
3. Initialize Ratchet and split the planning deliverable into useful review units.
4. Make the plan, bead, and dependency changes for one task. Export Beads state and commit the
   complete planning advance.
5. Record the commit with `ratchet advance`.
6. Gate the planning state. Run the relevant document and Beads checks, including lint and
   dependency-cycle validation when applicable. Record exact errors on failure.
7. After a passing gate, give a strict reviewer the planning deliverable and task id. The reviewer
   reads Ratchet and records its assessment of the beads and planning change.
8. Read failed review details from Ratchet, fix and commit the planning state, advance, and repeat
   the gate and review until both pass.
9. Complete the task. The planning deliverable is done only when every recorded task is complete
   and `ratchet status` reports `CLEAN`. If the requested delivery includes a PR merge, use a final
   post-merge delivery task as described in `AGENTS.md`.

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

Use a Ratchet question for a temporary blocker in producing the current plan. Use a Question Bead
for a product decision that future agents need to discover or that blocks executable work.

## Graph Hygiene

Link dependencies so agents do not pick work that depends on unfinished work.

Plan cohesion is the priority. Keep plans, roadmap, and beads aligned.

Beads may diverge from the plan only when the bead explicitly says why, or when a follow-up bead
captures the course correction.

Closed beads are immutable history. Create a new bead for changed scope, follow-up work, or
corrected direction.
