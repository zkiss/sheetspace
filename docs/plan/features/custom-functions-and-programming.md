# Custom Functions And Programming

## Purpose

Custom functions could let users build reusable logic out of formulas. A more advanced version could support imperative programming, but this should be treated as a research area until the product needs it.

## Feature Scope

- Define reusable functions from spreadsheet formulas.
- Call custom functions from cells.
- Validate custom function inputs and outputs.
- Possibly support imperative programming for advanced users.
- Keep custom logic inspectable and portable.

## Open Decisions

- Should custom functions be defined in sheets, a separate editor, or both?
- What security model is needed if imperative code exists?
- How can custom functions stay understandable to spreadsheet users?
