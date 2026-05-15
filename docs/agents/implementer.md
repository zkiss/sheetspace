# Implementer protocol

## Scope discipline

The active bead is the implementation boundary. Preserve existing conventions unless the bead requires changing them.

Prefer small, focused, testable changes. Avoid unrelated cleanup or reorganisation. If unrelated work is discovered, create a bead for it. Only fix it immediately if it blocks the active bead, is a tiny touched-code fix, or would otherwise leave the repo broken.

## Product and scope decisions

Do not invent product decisions, UX behaviour, technical constraints, or scope trade-offs that are not specified by the plan, the active bead, or explicit user instructions.

If a decision is needed to complete the active bead, stop and surface the question clearly unless the user explicitly delegated that type of decision.

When a decision is needed:

1. State the decision required.
2. Explain why it blocks or affects the current work.
3. List realistic options, with trade-offs if useful.
4. Recommend a default only if there is a clearly safe default.
5. Create an `ask-human` / `question` bead if the decision should be tracked.

It is acceptable to continue with work clearly unaffected by the unresolved decision. Do not continue with work that depends on a guessed answer.

If the decision affects other beads, update the dependency graph so blocked beads depend on the decision bead. If it only affects part of the work, split the work: complete the independent part, create or update beads for the blocked part, and record the dependency.

## Plan and bead consistency

Keep the plan and beads consistent.

The plan describes intended product direction. Beads describe the current executable breakdown. They should not silently contradict each other.

If a bead intentionally diverges from the plan, the bead must say so explicitly and explain why. Examples:

- reduced MVP scope
- deferred functionality
- temporary omissions
- implementation shortcuts
- changed assumptions

If the active bead and plan conflict:

1. Do not guess.
2. Treat the active bead as immediate implementation scope.
3. Record the conflict in the bead or create a follow-up/decision bead.
4. Update dependencies if the conflict blocks other work.
5. Ask the user if the correct direction is not clear.

When closing or materially changing beads, check whether relevant plan files need a small update to avoid stale or contradictory guidance.

## Implementation flow

Before editing:

1. Inspect the active bead.
2. Inspect relevant plan sections.
3. Inspect relevant existing code.
4. Check git status.
5. Check Agent Mail if available.
6. Reserve intended edit surfaces if Agent Mail file reservations are available.

During implementation:

- keep changes focused on the bead
- run relevant checks when practical
- record skipped checks and remaining risk
- create/update beads for follow-up work
- request dedicated reviewer subagent review before closing
- do not close if reviewer subagents are unavailable unless the user explicitly waives review

## Git and session close

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

Check final staged state:

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
