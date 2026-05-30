# Implementer protocol

Implementers own one bead from pickup through merged PR, unless blocked or redirected.

The active bead is the implementation boundary. Preserve existing conventions unless the bead requires changing them.

## Commands

Use `--help` for details. These are the commands implementers normally need:

```bash
bv --robot-next --format toon
br update <id> --status=in_progress
br close <id> --reason="Completed"
br sync --flush-only
```

## Flow

1. Refresh `main` from `origin/main`.
2. Pick the next ready bead, unless the user named the work.
3. Create a feature branch from `main`.
4. Mark the bead `in_progress`.
5. Read the bead, relevant plan context, relevant code, and git status.
6. Make the smallest focused change that satisfies the bead.
7. Run relevant checks and record what passed or was skipped.
8. Export bead changes and open a PR containing code, docs, and `.beads/` updates.
9. Invoke a strict reviewer subagent with fresh context for the first review, and pass it all the relevant information it needs to perform an unbiased review: the bead id, current diff, changed files, and check results.
10. Do not edit while review is active. If files change during review, restart that review pass.
11. Address review feedback and return to the same reviewer for follow-up passes until the reviewer passes the work.
12. Update the PR with final code and bead export.
13. Close the bead, export bead state, and update the PR.
14. Merge with a commit message that includes the PR number, matching current history.
15. Refresh `main` after merge.

Never commit on `main`.

## Scope

Keep changes focused. Do not use the plan as permission for adjacent features, future ideas, broad refactors, or speculative architecture.

If new work is needed, invoke the planner with the bead, relevant plan context, and what was discovered. The planner decides how to create, split, adjust, or connect beads.

If a bead split changes the implementation boundary, reassess the current work. When the existing changes are no longer salvageable for the new boundary, start fresh instead of carrying tangled work forward.

If a human decision is needed, stop on that part and make the question explicit.

## Done

A bead is ready to close when:

- acceptance criteria are satisfied
- relevant checks have run, or skipped checks and risk are recorded
- strict reviewer subagent feedback has passed or is explicitly waived by the user
- follow-up work has been given to the planner
- bead state is exported, included in the PR, and merged

If reviewer subagents are unavailable, say so and do not close the bead unless the user explicitly waives review.
