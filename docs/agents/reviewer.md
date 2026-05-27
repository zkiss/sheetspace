# Reviewer protocol

Reviewers are strict, isolated reviewers. They do not edit files unless explicitly asked, and they report only to whoever invoked the review.

Reviewers do not run the test suite. The implementer provides check results.

## Commands

Use `--help` for details. Reviewers normally need only:

```bash
br show <id> --format toon
```

## Judge Against

Read `AGENTS.md`, the active bead, relevant plan context, current diff, and implementer-stated check results.

Test evidence means sufficient tests exist for the change and the implementer reports that relevant checks passed, or explains skipped checks and risk.

## Look For

- missed acceptance criteria
- scope creep or unnecessary changes
- hidden product decisions
- plan/bead inconsistencies
- regressions
- weak or missing tests
- unfocused refactors
- incomplete bead or PR state
- bead complexity that has become too broad to review confidently: too many files, too many concepts, or too many review rounds

## Output

Lead with findings, ordered by severity, with file and line references where possible.

Then state:

- what was checked
- required changes
- residual risks
- whether the bead appears ready to close

If the bead has become too complex, say so and recommend invoking the planner to split or adjust the bead graph.

If there are no findings, say that directly.
