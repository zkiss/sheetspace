# Sheetspace agent guidance

## Repository purpose

This repository implements Sheetspace: a visual spreadsheet workspace where spreadsheet-like tables can be arranged in a 2D space, linked through formulas, navigated like code, and gradually refactored from conventional spreadsheet layouts into clearer calculation structures.

The product direction is described in `plan/*.md`.

Start with: `plan/PROJECT_VISION.md`

Use the plan to understand goals, workflows, UX, architecture, constraints, trade-offs, and future capabilities.

## Stack and repo map

This is a makefile-driven monorepo.

- `frontend/`: React + TypeScript + Vite client.
- `backend/`: Kotlin + Ktor API server.
- Root `Makefile`: orchestration commands for setup, compile, test, and build.
- `plan/`: product vision, design notes, feature planning, and implementation context.
- `.beads/`: Beads issue state exported by `br`; tracked in git.

Common commands:

```bash
make setup
make test
make compile
make frontend-dist
make build
```

Prefer these root commands over ad-hoc per-package commands unless the active bead or debugging context requires something narrower.

## Core operating rule

Beads define executable work.

The plan is context. The active bead is scope.

When implementing, use the selected bead and its acceptance criteria as the implementation boundary. Do not treat the full plan as a mandate to implement adjacent features, future ideas, broad refactors, or speculative architecture.

If extra work appears necessary, capture it as a new or updated bead rather than silently expanding the current bead.

Work on one bead at a time unless explicitly instructed otherwise.

## Product and scope decisions

Do not invent product decisions, UX behaviour, technical constraints, or scope trade-offs that are not specified by the plan, the active bead, or explicit user instructions.

If a decision is needed to complete the active bead, stop and surface the question clearly unless the user has explicitly delegated that type of decision to the agent.

When a decision is needed:

1. State the decision required.
2. Explain why it blocks or affects the current work.
3. List realistic options, with trade-offs if useful.
4. Recommend a default only if there is a clearly safe default.
5. Create an `ask-human` / `question` bead if the decision should be tracked.

It is acceptable to continue with work that is clearly unaffected by the unresolved decision. Do not continue with work that depends on a guessed answer.

If the decision affects other beads, update the dependency graph so blocked beads depend on the decision bead.

If the decision only affects part of the work, split the work: complete the independent part, create or update beads for the blocked part, and record the dependency.

## Plan and bead consistency

Keep the plan and beads consistent.

The plan describes the intended product direction. Beads describe the current executable breakdown. They should not silently contradict each other.

If a bead intentionally diverges from the plan, the bead must say so explicitly and explain why. Examples:

- reduced MVP scope
- deferred functionality
- temporary omissions
- implementation shortcuts
- changed assumptions

If the active bead and the plan conflict:

1. Do not guess.
2. Treat the active bead as the immediate implementation scope.
3. Record the conflict in the bead or create a follow-up/decision bead.
4. Update dependencies if the conflict blocks other work.
5. Ask the user if the correct direction is not clear.

When closing or materially changing beads, check whether the relevant plan files need a small update to avoid stale or contradictory guidance.

## Working expectations

Before editing:

1. Read this file.
2. Inspect the active bead.
3. Inspect relevant plan sections.
4. Inspect relevant existing code.
5. Check git status.
6. Check Agent Mail if available.

Preserve existing conventions unless the bead requires changing them.

Prefer small, focused, testable changes.

Avoid unrelated cleanup or reorganisation. If unrelated work is discovered, create a bead for it. Only fix it immediately if it blocks the active bead, is a tiny touched-code fix, or would otherwise leave the repo broken.

A bead is complete only when:

- its acceptance criteria are satisfied
- relevant checks have been run
- review feedback has been addressed or explicitly recorded
- bead state has been updated
- any new follow-up work is captured as beads
- plan/bead inconsistencies have been resolved or recorded

If checks cannot be run, state why and record the remaining risk.

## Bead quality

When creating or materially updating a bead, make it self-contained enough for a fresh agent to work from it.

A good bead should include:

- clear title
- task type: `task`, `bug`, `feature`, `epic`, `chore`, `docs`, or `question`
- priority: P0 critical, P1 high, P2 medium, P3 low, P4 backlog
- problem / goal
- implementation scope
- explicit out-of-scope notes where useful
- acceptance criteria
- relevant plan references
- dependencies / blockers
- testing expectations
- human decisions required, if any

Use `question` or `ask-human` style beads for decisions that should not be guessed.

## Beads and bv workflow

This project uses Beads for durable issue tracking.

- `br` manages bead state: create, update, close, dependencies, sync.
- `bv` analyses the bead graph and recommends what to work on next.
- `.beads/` is tracked in git and must be kept in sync.

Use `bv` for triage and routing. Use `br` for mutation.

Do not parse `.beads/beads.jsonl` manually unless there is no tool alternative.

### Start-of-session triage

Preferred:

```bash
bv --robot-triage
```

For a minimal recommendation:

```bash
bv --robot-next
```

For lower-token output:

```bash
bv --robot-triage --format toon
```

Important: use only `bv --robot-*` commands. Bare `bv` may launch an interactive UI and block the session.

Useful `bv` commands:

```bash
bv --robot-triage
bv --robot-next
bv --robot-plan
bv --robot-priority
bv --robot-insights
bv --robot-alerts
bv --robot-suggest
bv --robot-diff --diff-since <ref>
bv --robot-graph --graph-format=json
bv --robot-graph --graph-format=mermaid
```

Useful scoped examples:

```bash
bv --robot-plan --label backend
bv --robot-plan --label frontend
bv --recipe actionable --robot-plan
bv --recipe high-impact --robot-triage
```

### br commands

```bash
br ready
br list --status=open
br show <id>
br search "keyword"

br create --title="..." --description="..." --type=task --priority=2
br update <id> --status=in_progress
br close <id> --reason="Completed"

br dep add <issue> <depends-on>
br sync --status
br sync --flush-only
```

Use numeric priorities:

- `0`: P0 critical
- `1`: P1 high
- `2`: P2 medium
- `3`: P3 low
- `4`: P4 backlog

### Bead lifecycle

1. Use `bv --robot-triage` or `bv --robot-next` to identify the best actionable bead.
2. Inspect the bead with `br show <id>`.
3. Inspect relevant plan files and code.
4. Mark the bead in progress:

```bash
br update <id> --status=in_progress
```

5. Do the work.
6. Run relevant checks.
7. Create or update follow-up beads for discovered work.
8. Close the bead only when acceptance criteria are met:

```bash
br close <id> --reason="Completed"
```

9. Sync bead state:

```bash
br sync --flush-only
```

## Agent Mail coordination

Agent Mail is optional. Use it when the MCP tools are available.

If Agent Mail is unavailable, continue using Beads, git, plan files, and the final session summary as the coordination record.

Use the repository absolute path as the Agent Mail `project_key`.

For this repository, persist local Agent Mail identity state in:

```text
.agents/am.yml
```

This file is local working-tree state. It may contain Agent Mail registration tokens. Do not commit it.

If `.agents/am.yml` exists, read it before registering with Agent Mail. Reuse the recorded identity for the current role whenever possible.

If `.agents/am.yml` does not exist, or does not contain an identity for the current role, register a new Agent Mail identity and write the resulting name/token/project information to `.agents/am.yml` so future sessions can rejoin with the same identity.

Do not create a new Agent Mail identity if a usable identity for the current role already exists in `.agents/am.yml`.

Use separate identities for implementation and review work. A reviewer should not review its own implementation under the same identity.

Suggested structure:

```yaml
project_key: "/mnt/Data/projects/sheetspace"
identities:
  implementer:
    agent_name: "<agent-mail-name>"
    registration_token: "<agent-mail-registration-token>"
  reviewer:
    agent_name: "<agent-mail-name>"
    registration_token: "<agent-mail-registration-token>"
```

The exact token field name may differ depending on the Agent Mail tool response. Preserve whatever value is needed to authenticate as the same named agent in later sessions.

### Agent Mail conventions

Use the active bead id as the shared coordination key.

For bead `br-123`:

- Agent Mail thread id: `br-123`
- Mail subject prefix: `[br-123]`
- File reservation reason: `br-123`
- Commit message should include `br-123`

At the start of an Agent Mail-enabled session:

1. Read `.agents/am.yml` if present.
2. Rejoin using the persisted identity for the current role.
3. Check inbox/messages relevant to the selected bead.
4. Announce the bead and role being worked on.
5. Reserve files or globs before editing, if file reservation tools are available.

During work, send short progress or blocker messages when useful. Do not spend excessive time on coordination if no other agents are active.

At completion, report:

- bead id
- summary of changes
- files changed
- tests run
- risks
- follow-up beads
- review status

## File reservations

When Agent Mail file reservations are available, reserve intended edit surfaces before modifying them.

Reserve narrowly:

- specific files when known
- small globs when necessary
- avoid broad repo-wide reservations

If another agent has reserved a file, coordinate through Agent Mail rather than editing over it.

If reservations are unavailable, use git status, bead status, and Agent Mail messages as the fallback coordination mechanism.

## Review protocol

Implementation work should be reviewed by a separate agent identity or a fresh agent session before the bead is considered complete.

Preferred flow with Agent Mail:

1. Implementer selects one bead, implements it, runs checks, and leaves the bead ready for review.
2. Implementer sends a review request through Agent Mail to the reviewer identity, including bead id, changed files, tests run, and known risks.
3. Reviewer starts from a fresh context, inspects the bead, plan context, git diff, and test results.
4. Reviewer sends findings through Agent Mail.
5. Implementer addresses feedback or explains why no change is needed.
6. Reviewer re-checks if necessary.
7. The bead is closed only once both implementer and reviewer are satisfied, or remaining disagreement/risk is explicitly recorded.

Offline flow when Agent Mail is unavailable:

1. Implementer completes the change and stops without relying on Agent Mail.
2. A fresh reviewer session is started.
3. Reviewer reads `AGENTS.md`, the active bead, relevant plan files, and the current git diff.
4. Reviewer provides findings in its final response or in a follow-up bead.
5. Implementer addresses the feedback.
6. Close the bead only after review feedback is addressed or explicitly recorded.

Reviewer default behaviour:

- Review only; do not make code changes unless explicitly instructed.
- Look for scope creep, missed acceptance criteria, incorrect assumptions, weak tests, regressions, and unnecessary refactors.
- Prefer actionable findings tied to files, behaviours, or acceptance criteria.
- If no issues are found, say so directly and state what was checked.

## Git and session close protocol

Before committing:

```bash
git status
```

Stage code/docs changes intentionally:

```bash
git add <files>
```

Sync Beads after bead changes:

```bash
br sync --flush-only
```

Then stage exported bead state:

```bash
git add .beads/
```

Check the final staged state:

```bash
git status
```

Commit with the bead id in the message:

```bash
git commit -m "br-123: concise description"
```

Push when appropriate:

```bash
git push
```

Do not forget the second `git add .beads/` after `br sync --flush-only`.

## Context recovery

After compaction, context reset, or a fresh session:

1. Re-read `AGENTS.md`.
2. Inspect the active bead with `br show <id>`.
3. Inspect relevant plan files.
4. Check Agent Mail if available.
5. Check git status.
6. Continue only once the current scope and repo state are clear.

If the session appears confused or stale after recovery, stop and ask for a fresh instruction rather than guessing.

## Final response expectations

When finishing work, report:

- active bead id
- what changed
- files changed
- checks run
- checks not run, with reason
- follow-up beads created or needed
- unresolved decisions or risks
- whether review has happened

Be explicit about blockers, uncertainty, and decisions that require the user.
