# Fixes mode

Rapid feedback: address requested fixes only, update this log and commit after each fixing turn. Automated tests and quality gates may be deferred until hardening and assurance are requested. Thoughtful UI design and rendered inspection still apply.

Hardening and assurance: preserve intended behavior, update meaningful automated tests, correct introduced bugs, review each area and the combined deliverable, and pass all authoritative tests and quality gates. Human acceptance remains separate. Remove this log before any eventual merge; merging requires user authorization.

## Column sort indicators

- Show down arrows for ascending and up arrows for descending on sorted column headers.

## Data model in sheet title

- Display a bound data model's name in code styling beside the sheet name.

## Sorting configuration

- Open a separate sort dialog from the sheet context menu, with ordered, editable sort levels.
- Refine the dialog layout and use familiar sort-by / then-by wording.

## Functions

- Refine the function manager and editor layout, hierarchy, and action styling.
- Let Save recover failed saves before applying current function edits, without a separate retry button.
- Use the shared formula editor in function authoring and require `@` on parameter references.

## UI design and evaluation guidance

- Add UI design standards to `constitution.md` covering task-oriented layout, visual hierarchy, familiar terminology, and accessibility.
- Add a rendered UI review loop to `AGENTS.md`: inspect screenshots and behavior, critique the design, correct problems within scope, and reinspect.
- Keep UI evaluation active during rapid fixes, distinguish it from human acceptance, and disclose when rendered inspection is unavailable.
- Squash-merge the permanent guidance into `main` and merge `main` into `fixes`; keep this temporary log on `fixes`.
