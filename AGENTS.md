# Project guidance

## Product context

This repository implements the product described in `plan/*.md`.

The plan describes the intended complete product direction: goals, workflows, UX, architecture, constraints, trade-offs, and future capabilities. Use it to understand the project and make coherent engineering decisions.

Start with `plan/PROJECT_VISION.md`. Use that file as the entry point for understanding the rest of the plan.

## Scope model

Beads define executable work.

The plan is context. The active bead is scope.

When implementing, use the selected bead and its acceptance criteria as the implementation boundary. Do not treat the full plan as a mandate to implement adjacent features, future ideas, broad refactors, or speculative architecture.

If extra work appears necessary, capture it as a new or updated bead rather than silently expanding the current bead.

If the plan and the active bead appear to disagree, follow the bead for immediate implementation scope, but do not ignore the disagreement. Record the ambiguity, create or update a decision bead if needed, and ask the user when the correct direction is not clear.

## Decision handling

Do not invent product decisions, UX behaviour, technical constraints, or scope trade-offs that are not specified by the plan, the active bead, or explicit user instructions.

If a decision is needed to complete the active bead, stop and surface the question clearly unless the user has explicitly delegated that type of decision to the agent.

When a decision is needed:

1. State the decision required.
2. Explain why it blocks or affects the current work.
3. List the realistic options, with trade-offs if useful.
4. Recommend a default only if there is a clearly safe default.
5. Create an `ask-human` / `question` bead if the decision should be tracked.

It is acceptable to continue with work that is clearly unaffected by the unresolved decision. Do not continue with work that depends on a guessed answer.

If the decision affects other beads, update the dependency graph so blocked beads depend on the decision bead.

If the decision only affects part of the work, split the work: complete the independent part, create or update beads for the blocked part, and record the dependency.

## Plan and bead consistency

Keep the plan and beads consistent.

The plan describes the intended product direction. Beads describe the current executable breakdown. They should not silently contradict each other.

If a bead intentionally diverges from the plan, the bead must say so explicitly and explain why. Examples include reduced MVP scope, deferred functionality, temporary omissions, implementation shortcuts, or changed assumptions.

If the active bead and the plan conflict:

1. Do not guess.
2. Treat the active bead as the immediate implementation scope.
3. Record the conflict in the bead or create a follow-up/decision bead.
4. Update dependencies if the conflict blocks other work.
5. Ask the user if the correct direction is not clear.

When closing or materially changing beads, check whether the relevant plan files need a small update to avoid stale or contradictory guidance.

## Working expectations

Work on one bead at a time unless explicitly instructed otherwise.

Before editing, inspect the relevant existing files and the relevant plan sections. Preserve existing conventions unless the bead requires changing them.

Prefer small, focused, testable changes. Avoid unrelated cleanup or reorganisation.

If blocked by a product, UX, technical, or scope decision, stop and ask rather than making up the answer, unless the user has explicitly delegated that decision.

A bead is complete only when its acceptance criteria are satisfied, the relevant checks have been run, and review feedback has been addressed or explicitly recorded.

If checks cannot be run, state why and record the remaining risk.

## Agent Mail coordination

Agent Mail is optional. Use it when the MCP tools are available. If Agent Mail is unavailable, continue using Beads, git, the plan files, and the final session summary as the coordination record.

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

At the start of an Agent Mail-enabled session:

1. Read `.agents/am.yml` if present.
2. Rejoin using the persisted identity for the current role.
3. Check inbox/messages relevant to the selected bead.
4. Announce the bead and role being worked on.
5. Reserve files or globs before editing, if file reservation tools are available.

During work, send short progress or blocker messages when useful. Do not spend excessive time on coordination if no other agents are active.

At completion, report the bead id, summary of changes, files changed, tests run, and any risks or follow-up beads.

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

<!-- br-agent-instructions-v1 -->

---

## Beads Workflow Integration

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`/`bd`) for issue tracking. Issues are stored in `.beads/` and tracked in git.

### Essential Commands

```bash
# View ready issues (open, unblocked, not deferred)
br ready              # or: bd ready

# List and search
br list --status=open # All open issues
br show <id>          # Full issue details with dependencies
br search "keyword"   # Full-text search

# Create and update
br create --title="..." --description="..." --type=task --priority=2
br update <id> --status=in_progress
br close <id> --reason="Completed"
br close <id1> <id2>  # Close multiple issues at once

# Sync with git
br sync --flush-only  # Export DB to JSONL
br sync --status      # Check sync status
```

### Workflow Pattern

1. **Start**: Run `br ready` to find actionable work
2. **Claim**: Use `br update <id> --status=in_progress`
3. **Work**: Implement the task
4. **Complete**: Use `br close <id>`
5. **Sync**: Always run `br sync --flush-only` at session end

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready` shows only open, unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers 0-4, not words)
- **Types**: task, bug, feature, epic, chore, docs, question
- **Blocking**: `br dep add <issue> <depends-on>` to add dependencies

### Session Protocol

**Before ending any session, run this checklist:**

```bash
git status              # Check what changed
git add <files>         # Stage code changes
br sync --flush-only    # Export beads changes to JSONL
git commit -m "..."     # Commit everything
git push                # Push to remote
```

### Best Practices

- Check `br ready` at session start to find available work
- Update status as you work (in_progress → closed)
- Create new issues with `br create` when you discover tasks
- Use descriptive titles and set appropriate priority/type
- Always sync before ending session

<!-- end-br-agent-instructions -->

<!-- bv-agent-instructions-v2 -->

---

## Beads Workflow Integration

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`) for issue tracking and [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) (`bv`) for graph-aware triage. Issues are stored in `.beads/` and tracked in git.

### Using bv as an AI sidecar

bv is a graph-aware triage engine for Beads projects (.beads/beads.jsonl). Instead of parsing JSONL or hallucinating graph traversal, use robot flags for deterministic, dependency-aware outputs with precomputed metrics (PageRank, betweenness, critical path, cycles, HITS, eigenvector, k-core).

**Scope boundary:** bv handles *what to work on* (triage, priority, planning). `br` handles creating, modifying, and closing beads.

**CRITICAL: Use ONLY --robot-* flags. Bare bv launches an interactive TUI that blocks your session.**

#### The Workflow: Start With Triage

**`bv --robot-triage` is your single entry point.** It returns everything you need in one call:
- `quick_ref`: at-a-glance counts + top 3 picks
- `recommendations`: ranked actionable items with scores, reasons, unblock info
- `quick_wins`: low-effort high-impact items
- `blockers_to_clear`: items that unblock the most downstream work
- `project_health`: status/type/priority distributions, graph metrics
- `commands`: copy-paste shell commands for next steps

```bash
bv --robot-triage        # THE MEGA-COMMAND: start here
bv --robot-next          # Minimal: just the single top pick + claim command

# Token-optimized output (TOON) for lower LLM context usage:
bv --robot-triage --format toon
```

#### Other bv Commands

| Command | Returns |
|---------|---------|
| `--robot-plan` | Parallel execution tracks with unblocks lists |
| `--robot-priority` | Priority misalignment detection with confidence |
| `--robot-insights` | Full metrics: PageRank, betweenness, HITS, eigenvector, critical path, cycles, k-core |
| `--robot-alerts` | Stale issues, blocking cascades, priority mismatches |
| `--robot-suggest` | Hygiene: duplicates, missing deps, label suggestions, cycle breaks |
| `--robot-diff --diff-since <ref>` | Changes since ref: new/closed/modified issues |
| `--robot-graph [--graph-format=json\|dot\|mermaid]` | Dependency graph export |

#### Scoping & Filtering

```bash
bv --robot-plan --label backend              # Scope to label's subgraph
bv --robot-insights --as-of HEAD~30          # Historical point-in-time
bv --recipe actionable --robot-plan          # Pre-filter: ready to work (no blockers)
bv --recipe high-impact --robot-triage       # Pre-filter: top PageRank scores
```

### br Commands for Issue Management

```bash
br ready              # Show issues ready to work (no blockers)
br list --status=open # All open issues
br show <id>          # Full issue details with dependencies
br create --title="..." --type=task --priority=2
br update <id> --status=in_progress
br close <id> --reason="Completed"
br close <id1> <id2>  # Close multiple issues at once
br sync --flush-only  # Export DB to JSONL
```

### Workflow Pattern

1. **Triage**: Run `bv --robot-triage` to find the highest-impact actionable work
2. **Claim**: Use `br update <id> --status=in_progress`
3. **Work**: Implement the task
4. **Complete**: Use `br close <id>`
5. **Sync**: Always run `br sync --flush-only` at session end

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready` shows only unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers 0-4, not words)
- **Types**: task, bug, feature, epic, chore, docs, question
- **Blocking**: `br dep add <issue> <depends-on>` to add dependencies

### Session Protocol

```bash
git status              # Check what changed
git add <files>         # Stage code changes
br sync --flush-only    # Export beads changes to JSONL
git commit -m "..."     # Commit everything
git push                # Push to remote
```

<!-- end-bv-agent-instructions -->
