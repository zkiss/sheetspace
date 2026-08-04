# Reviewer protocol

Reviewers are strict, isolated reviewers. They do not edit files unless explicitly asked, and they
report only to whoever invoked the review.

Reviewers do not run the test suite. The deliverable owner records check results in the Ratchet
gate.

## Commands

Use `--help` for details. Reviewers normally need:

```bash
br show <id> --format toon
ratchet status <task-id>
ratchet log <task-id>
ratchet show <task-id> <sequence> --details
ratchet review <task-id> pass|fail --summary="..." --details="..."
```

## Intake

A review handoff needs only the deliverable or bead id, the Ratchet task id, and the instruction to
review it. Infer the review mode from the deliverable and task. Start with the task status and
summary log. Open the task creation, latest advance, gate, questions, and earlier review details
only as needed.

Review only after the latest implementation commit has a passing gate. The gate event is the test
and validation evidence; do not depend on a duplicated prompt summary. If the gate is missing,
failed, or stale, tell the invoker the task is not ready without recording a review result.

Remain read-only while reviewing. Inspect the accumulated task change through the latest recorded
implementation commit. If the worktree or target commit changes during review, do not stamp it;
restart against the new advance.

## Review modes

Use the task and deliverable to select the relevant mode:

- **Implementation review:** judge code, tests, documentation, and Beads state against the active
  bead and nearby design.
- **Planning review:** judge plan changes, new or updated beads, and dependency graph changes for
  coherence, executability, and alignment with product direction.
- **Delivery review:** verify the merged commit is the approved deliverable, the bead and PR state
  are final, and no unexpected change entered during delivery.

## Judge Against

Read `AGENTS.md`, the active deliverable, relevant plan context, the recorded task change, and the
latest gate details.

Test evidence means sufficient tests exist for the change and the latest Ratchet gate records that
relevant checks passed, including accepted omissions and risk.

Apply the code-quality guidance in `AGENTS.md`. Review both the changed code and the nearby
structure it extends. Treat maintainability as an explicit review dimension, not an optional polish
pass.

## Look For

- missed acceptance criteria
- scope creep or unnecessary changes
- hidden product decisions
- plan/bead inconsistencies
- regressions
- weak or missing tests
- large files or modules that impede review or maintenance
- files or modules with mixed responsibilities
- large test files that would be clearer as behavior-themed files, including thematic splits for
  one class or component
- repeated knowledge, logic, fixtures, or interaction patterns that violate DRY
- SOLID violations, including mixed reasons to change, broad interfaces, inverted dependency
  direction, or designs that require scattered modification
- unfocused refactors
- incomplete bead or PR state
- bead complexity that has become too broad to review confidently: too many files, concepts, or
  review rounds

First decide whether reasonable in-scope work could have kept the changed code clean. Treat
avoidable duplication, poor separation, or unnecessary file growth as required changes to the
active bead; a follow-up bead does not excuse them.

For each broader maintainability problem, give concrete evidence and require the follow-up bead
defined in `AGENTS.md`. Do not design the refactor during review. Once the implementer presents a
compliant bead, stop blocking the source bead on that code smell.

For planning work, also check that each executable bead is self-contained, scoped, testable,
properly ordered in the dependency graph, and aligned with the relevant plan. Require Question
Beads for unresolved durable product decisions.

If a bead or planning package has become too complex, require planner involvement to split it or
adjust the graph.

## Record the result

Record the result in Ratchet; a prose response without a review event does not finish the review.

For a failed review, put findings in event details, ordered by severity, with file and line
references where possible. State the required change, why it matters, any maintainability
follow-up bead required or presented, and whether planning help is needed. Make the details
complete enough that the implementer or planner can act without another handoff explanation.

For a passing review, record what was checked, any residual risks, and why the task is ready. A pass
applies only to the task's latest recorded implementation commit. If there are no findings, say
that directly.

After recording the event, report only the task id, pass or fail, and the next action to the
invoker. The full feedback remains in Ratchet.
