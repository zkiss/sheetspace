# Sheetspace agent guidance

## Repository purpose

Sheetspace is a visual spreadsheet workspace: spreadsheet-like tables live in a 2D space, can be linked through formulas, navigated like code, and gradually refactored from conventional spreadsheets into clearer calculation structures.

Product direction lives in `docs/plan/`. Start with `docs/plan/PROJECT_VISION.md`.
Delivery sequence lives in `docs/plan/roadmap/`, ordered by the two-digit filename prefixes.

## Repo

This is a Makefile-driven monorepo.

- `frontend/`: React + TypeScript + Vite client.
- `backend/`: Kotlin + Ktor API server.
- `docs/plan/`: product vision, design notes, feature planning, implementation context.
- `.beads/`: Beads issue state exported by `br`; tracked in git.

Prefer root commands unless current context needs something narrower:

```bash
make setup
make test
make compile
make frontend-dist
make build
```

## Working Preferences

Beads define executable work. The plan is context. The active bead is scope. When a bead is active, complete its stated scope and keep the work within that boundary. Scope changes require explicit direction.

Use Beads for product work: behavior changes, new features, and other work that contributes to realizing the project vision. Non-product work such as agent guidance, build tooling, scripts, and plan maintenance can be completed directly without a bead.

For an ad hoc task, decide whether it contributes to the project vision. Complete non-product tasks directly. If the task is product work without a bead, offer to create one before implementation and create it only with the user's agreement.

Agents may create a new bead when implementation or plan review reveals product work needed to realize the vision that no open bead captures and that falls outside the active bead. The new bead records the gap while the active work remains within its original scope.

Use Question Beads for unresolved decisions that block executable implementation.
Closed beads are history. Do not modify them.

## Deliverables and Ratchet

A deliverable is the active bead. When no bead is active, the deliverable is the outcome requested
by the user.

Use one transient Ratchet ledger for each deliverable. Ratchet records execution state; Beads and
plan documents remain the durable sources of product scope and direction. Git commits are the
proof of work.

Start Ratchet from a clean worktree with `ratchet init`. The deliverable owner splits the work into
as many tasks as make it understandable and reviewable. A small deliverable may need one task; a
large deliverable may use phases or several focused tasks. Ratchet tasks do not need to map
one-to-one to beads.

Drive each task through this loop:

1. Make the task change and commit it.
2. Record the commit with `ratchet advance`.
3. Run the relevant deterministic checks and record their combined result with `ratchet gate`.
4. Give a reviewer the task id. The reviewer inspects the recorded commit and records the result
   with `ratchet review`.
5. If a gate or review fails, read its Ratchet event, fix the work, commit, and advance again. A new
   advance makes earlier gate and review results stale, so run both again.
6. Use `ratchet complete` only when the current commit has passing gate and review results and no
   open questions.

Ratchet writes require a completely clean worktree. Put concise orientation in event summaries and
actionable evidence in details:

- advances describe the implementation or fix and refer to the failed event they address
- failed gates include the commands run and useful error output
- passed gates include the checks that passed and any explicitly accepted omissions or risks
- failed reviews contain actionable findings with file and line references where possible
- passed reviews state what was checked and any residual risk

Use `ratchet question` for a blocker local to the current deliverable and `ratchet answer` when it is
resolved. Use a Question Bead when the decision is durable product state or should block other
deliverables; the Ratchet question may point to that bead.

Ratchet is the handoff record. Pass another agent the task id and the next action rather than
repeating history in the prompt. The receiving agent starts with `ratchet status`, uses
`ratchet log <task-id>` for summaries, and opens only the needed event with
`ratchet show <task-id> <sequence> --details`.

Work is done when `ratchet status` reports `CLEAN`. For a bead, this includes a final delivery task
completed after the PR is merged, the bead is closed, and `main` is refreshed from `origin/main`.
Create that delivery task when the ledger is initialized so its starting commit is an ancestor of
the eventual merge commit. After reporting the clean result, discard the transient `.ratchet`
ledger before starting the next deliverable.

## Code Quality

Build the active bead's behavior cleanly. Make every reasonable in-scope effort to follow SOLID and DRY during feature work:

- Keep production and test files small, cohesive, and focused on one responsibility.
- Split large test suites by behavior theme when that improves focus, including tests for the same class or component.
- Centralize repeated knowledge and behavior instead of copying patterns.
- Keep interfaces focused, dependencies pointed toward the appropriate abstraction, and responsibilities separated so one module has one primary reason to change.

The follow-up mechanism is not permission to introduce or leave avoidable mess. Complete straightforward cleanup that keeps the changed code coherent and stays within the active bead. When a maintainability problem remains because solving it requires broader investigation or would sidetrack the active bead, capture it in an immediate follow-up refactor bead. The follow-up depends on the source bead and is the next implementation work after it, before unrelated product work.

The refactor bead must:

- identify the source bead and record the observed evidence, such as a large or mixed-responsibility file, repeated pattern, or specific SOLID violation
- require the implementer to investigate and document a coherent refactor or redesign
- deliver the documented solution without changing functionality
- preserve behavioral coverage and add focused tests where needed to make the refactor safe
- use the `refactor` and `follow-up` labels

Once a broader maintainability problem is captured in such a bead, that code smell is accepted for the source bead. Review and implementation should not detour into designing or performing that refactor. Avoidable poor quality in the changed code, plus correctness, security, regression, and acceptance-criteria findings, cannot be deferred under this rule.

Never commit on `main`.
Keep `main` refreshed to `origin/main`.

## Role Guides

Read only the guides relevant to the role you are performing:

- `docs/agents/implementer.md`: execute one bead through review and merge.
- `docs/agents/reviewer.md`: review implementation work without editing.
- `docs/agents/planner.md`: shape plans, roadmap, and bead graph.

After compaction or a fresh session, reload this file, the relevant role guide, the active bead if any, relevant plan context, and git status before continuing.
