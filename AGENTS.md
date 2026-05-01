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

If the plan and the active bead appear to disagree, follow the bead for implementation scope and record the ambiguity as a bead, comment, or follow-up task.

## Working expectations

Work on one bead at a time unless explicitly instructed otherwise.

Before editing, inspect the relevant existing files and the relevant plan sections. Preserve existing conventions unless the bead requires changing them.

Prefer small, focused, testable changes. Avoid unrelated cleanup or reorganisation.

A bead is complete only when its acceptance criteria are satisfied and the relevant checks have been run. If checks cannot be run, state why and record the remaining risk.

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
