# Reviewer protocol

Implementation work should be reviewed by a dedicated reviewer subagent before the bead is considered complete.

The implementer must not self-review. Review must use a separate reviewer subagent, even when Agent Mail is unavailable. Use Agent Mail for review coordination when available, but do not treat Agent Mail as the review mechanism itself.

If subagents are unavailable, state that review could not be performed and do not close the bead unless the user explicitly waives the review requirement.

## Reviewer subagent invocation

Invoke a named reviewer or code-review subagent with the active bead id and current diff.

Minimal prompt shape:

```text
Code review for bead <bead-id>.
Read AGENTS.md, the bead, relevant plan files, the current git diff, and test results.
Suggest improvements.
Do not edit files unless explicitly instructed.
Return findings, required changes, residual risks, and whether the bead appears ready to close.
```

The reviewer subagent should start from fresh context and should not rely on the implementer's reasoning alone.

## Reviewer behaviour

Review only; do not make code changes unless explicitly instructed.

Look for:

- scope creep
- missed acceptance criteria
- incorrect assumptions
- weak or missing tests
- regressions
- unnecessary refactors
- plan/bead inconsistencies
- unresolved human decisions hidden as implementation choices

Prefer actionable findings tied to files, behaviours, or acceptance criteria. If no issues are found, say so directly and state what was checked.

## Preferred flow with Agent Mail

1. Implementer selects one bead, implements it, runs checks, and leaves the bead ready for review.
2. Implementer sends a review request through Agent Mail to the reviewer identity, including bead id, changed files, tests run, and known risks.
3. Implementer invokes the reviewer subagent, using the reviewer Agent Mail identity when available.
4. Reviewer subagent inspects the bead, plan context, git diff, and test results.
5. Reviewer sends findings through Agent Mail and returns them to the implementer session.
6. Implementer addresses feedback or explains why no change is needed.
7. Reviewer subagent re-checks if necessary.
8. The bead is closed only once both implementer and reviewer are satisfied, or remaining disagreement/risk is explicitly recorded.

## Offline flow when Agent Mail is unavailable

1. Implementer completes the change and stops without relying on Agent Mail.
2. Implementer invokes the reviewer subagent with the active bead id, current git diff, changed files, tests run, and known risks.
3. Reviewer subagent reads `AGENTS.md`, the active bead, relevant plan files, and current git diff.
4. Reviewer subagent provides findings in its final response or asks the implementer to create/update follow-up beads.
5. Implementer addresses the feedback.
6. Close the bead only after reviewer subagent feedback is addressed or explicitly recorded.
