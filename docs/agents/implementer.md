# Implementer protocol

Implementers own one bead from pickup through merged PR, unless blocked or redirected. The bead is
the deliverable and implementation boundary. The plan supplies context without expanding that
boundary.

## Commands

Use `--help` for details. Implementers normally need:

```bash
bv --robot-next --format toon
br update <id> --status=in_progress
br close <id> --reason="Completed"
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

## Start

1. Refresh `main` from `origin/main`.
2. Pick the next ready bead, unless the user named the work.
3. Create a feature branch from `main`. Never commit on `main`.
4. Mark the bead `in_progress`, export the Beads state, and commit this kickoff state.
5. Read the bead, relevant plan context, relevant code, and git status.
6. Initialize Ratchet. Add the known implementation tasks and a final delivery task. Choose task
   boundaries that make the work understandable and reviewable; add further tasks when the work
   reveals them.

If a ledger already exists, recover from `ratchet status` and its task history instead of
initializing another one.

## Task loop

Work one task through the shared Ratchet loop in `AGENTS.md`:

1. Make the smallest focused change that satisfies the task and remains coherent within the bead.
2. Run useful checks while developing, then commit the finished change.
3. Record the commit with `ratchet advance`.
4. Run all checks relevant to that commit. Record one combined gate result, including commands and
   useful error details on failure.
5. After a passing gate, invoke a strict reviewer with fresh context and give it the bead id, task
   id, and instruction to review. Ratchet supplies the diff target, gate evidence, and prior
   history.
6. Do not edit while review is active. If files change, discard that review attempt and restart it
   against the new committed advance.
7. On failure, read the gate or review details from Ratchet, fix the findings, commit, advance, and
   repeat the gate and review.
8. Complete the task only after both results pass for its latest commit.

Fix avoidable in-scope quality problems in the task that introduced them. A distinct in-scope
finding may become another Ratchet task when that is the clearer execution unit. Completed tasks
remain immutable; corrections discovered later go into a new task.

For each broader maintainability finding, immediately create the follow-up refactor bead required
by `AGENTS.md`, link it to the active bead, commit the exported Beads change as part of the current
fix or a focused Ratchet task, and return it to review. Implement the follow-up next after the
source bead merges.

## Scope

Keep changes focused. The active bead authorizes its stated work; the plan provides context without
expanding that boundary.

When implementation reveals additional product work needed to realize the vision, continue the
current implementation within the active bead. An implementer may create a follow-up bead for a
clear gap the active bead does not capture. Invoke the planner when the discovery needs planning
judgment, a scope split, or graph changes.

If a bead split changes the implementation boundary, reassess the current work. When the existing
changes are no longer salvageable for the new boundary, start fresh instead of carrying tangled
work forward.

Use a Ratchet question for an execution-local decision. Create a Question Bead when the answer is
durable product state or affects work beyond this deliverable.

## Delivery

After the implementation tasks pass:

1. Prepare the PR with code, docs, and exported `.beads/` state.
2. Close the bead, export its state, commit the delivery preparation, and advance the delivery
   task. Gate and review that state before merge, but do not complete the delivery task yet.
3. Update and merge the PR with the formats below.
4. Refresh `main` from `origin/main` and advance the same delivery task to the merge commit. This
   makes its pre-merge stamps stale.
5. Gate the merged state: confirm the approved PR is merged, the bead is closed, `main` matches
   `origin/main`, required checks passed, and the worktree is clean.
6. Ask the reviewer to verify the merged commit matches the approved deliverable and record the
   delivery review.
7. Complete the delivery task and confirm `ratchet status` reports `CLEAN`.
8. Discard the transient Ratchet ledger. If review created a refactor follow-up, implement it next
   before unrelated product work.

## PRs

Use this PR title format:

```text
{bead-id}: {bead summary}
```

Use the PR description to briefly describe the purpose of the change and any non-obvious detail
that helps reviewers understand the PR. Do not list changed files, validation performed, or other
boilerplate unless the user explicitly asks for it.

Use this merge commit message format:

```text
{PR title} (#{pr number})

{PR description}
```

## Done

A bead is done when:

- acceptance criteria are satisfied
- relevant gates pass for every task's latest implementation commit
- strict reviewer feedback passes for every task's latest implementation commit
- follow-up product work outside the active scope is captured in a new bead or given to the planner
- every deferred broader maintainability finding is captured in a linked immediate follow-up
  refactor bead and presented to the reviewer
- bead state is exported, included in the PR, and merged
- the delivery task is complete and `ratchet status` reports `CLEAN`

If a reviewer is unavailable, say so and leave the affected task incomplete.
