# Phase 10: Reusable And Inspectable Logic

## Goal

Let users extract repeated calculation logic into reusable functions without turning the workbook into an opaque or unsafe program.

Phase 9 makes repeated row structure explicit. Phase 10 completes the current long-term product shape by making repeated logic explicit too: custom functions are named, navigable, testable, portable, and integrated with the calculation graph.

## Included Scope

### Formula-defined custom functions

- Define workbook-scoped functions with a name, named inputs, a formula-based body, and documented output behavior.
- Call custom functions from ordinary cells, calculated table columns, and compatible report elements.
- Validate names, arity, input types, range inputs, return values, and conflicts with built-in functions.
- Define recursion policy and report custom-function cycles with typed cell-level errors.
- Keep evaluation deterministic and integrated with dependency tracking and affected recalculation.

### Definition and inspection workflow

- Provide a dedicated, understandable place to create, edit, document, test, rename, and remove custom functions.
- Reuse formula highlighting, autocomplete, inline errors, hover, and reference navigation in function definitions.
- Show where a custom function is used before rename or deletion and rewrite callers when safe.
- Let users inspect a function call's definition and relevant inputs without leaving the workbook context.

### Durability and portability

- Persist custom functions as versioned workbook state.
- Include formula-defined functions in Sheetspace JSON exports and validate them before import.
- Report custom functions as incompatible when an exchange target cannot represent them faithfully.
- Keep definitions self-contained and portable; do not allow hidden machine-local dependencies.

### Imperative programming decision gate

- Research imperative functions only after formula-defined functions are validated in real use.
- Require an explicit security, resource-limit, determinism, portability, and debugging design before executable code enters workbook state.
- If the gate is approved, use a sandboxed capability model with no ambient filesystem, process, credential, or network access.
- If the gate is not approved, record the decision and keep imperative execution outside the supported product rather than weakening inspectability or safety.

## Completion Signal

- A user can replace repeated formulas with a named reusable function and follow a call to its definition.
- Custom functions calculate consistently, participate in dependency updates, and produce clear errors.
- Rename and deletion workflows reveal callers and avoid silent breakage.
- Definitions survive persistence and Sheetspace JSON round trips with explicit compatibility reporting for other formats.
- The imperative-programming decision is resolved through an explicit safety and product gate, not accidental implementation.

## Full-Vision Position

At this phase, every feature area in the current project vision has a delivered product path: spatial workspaces, fluent grids, formulas, reference intelligence, structural refactoring, durable exchange, reports, organization, structured tables, and reusable logic.

This milestone is a complete expression of the current vision, not a promise of exhaustive Excel compatibility or an endpoint for product discovery.

## References

- [phase9.task.md](phase9.task.md)
- [PROJECT_VISION.md](PROJECT_VISION.md)
- [features/custom-functions-and-programming.md](features/custom-functions-and-programming.md)
- [features/formula-editor.md](features/formula-editor.md)
- [features/formulas.md](features/formulas.md)
- [features/table-object-model.md](features/table-object-model.md)
