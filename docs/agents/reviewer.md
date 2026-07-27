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

Apply the code-quality guidance in `AGENTS.md`. Review both the changed code and the nearby structure it extends. Treat maintainability as an explicit review dimension, not an optional polish pass.

## Look For

- missed acceptance criteria
- scope creep or unnecessary changes
- hidden product decisions
- plan/bead inconsistencies
- regressions
- weak or missing tests
- large files or modules that impede review or maintenance
- files or modules with mixed responsibilities
- large test files that would be clearer as behavior-themed files, including thematic splits for one class or component
- repeated knowledge, logic, fixtures, or interaction patterns that violate DRY
- SOLID violations, including mixed reasons to change, broad interfaces, inverted dependency direction, or designs that require scattered modification
- unfocused refactors
- incomplete bead or PR state
- bead complexity that has become too broad to review confidently: too many files, too many concepts, or too many review rounds

First decide whether reasonable in-scope work could have kept the changed code clean. Treat avoidable duplication, poor separation, or unnecessary file growth as required changes to the active bead; a follow-up bead does not excuse them.

For each broader maintainability problem, give concrete evidence and require the follow-up bead defined in `AGENTS.md`. Do not design the refactor during review. Once the implementer presents a compliant bead, stop blocking the source bead on that code smell.

## Output

Lead with findings, ordered by severity, with file and line references where possible.

Then state:

- what was checked
- required changes
- maintainability follow-up beads required or presented, with the problem each captures
- residual risks
- whether the bead appears ready to close

If the bead has become too complex, say so and recommend invoking the planner to split or adjust the bead graph.

If there are no findings, say that directly.
