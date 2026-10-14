# Phase 4: IDE-Like Modeling And Navigation

## Goal

Make Sheetspace a responsive workspace for defining tables, editing calculations, and navigating their inputs and relationships.

Phase 3 establishes fluent spreadsheet editing. Phase 4 makes models understandable like code: tables have named properties and consistent calculations, formulas expose their structure and dependencies, and keyboard-first navigation lets users move without losing context.

## Included Scope

### Reusable data models

- Introduce a separate data model entity: properties correspond to named columns, and rows are instances of the model. Models are declarative data definitions, not programming-language classes.
- Allow multiple sheets to bind to the same data model, each with independent rows and input values. Bind at sheet level, not through formula-created table regions.
- Let the data model own property names, column order, and calculated-property formulas. Bound sheets follow that order and apply the model's calculations to their rows; layout and presentation remain sheet-specific.
- Define calculated properties once and apply their formulas consistently to every row, including newly added rows. Do not allow per-row calculation overrides.
- Keep calculated cells read-only; edit their formulas in the data model.
- Keep calculations within the spreadsheet formula model, without arbitrary executable code, filesystem access, or remote calls.
- Validate property name conflicts within a data model and persist models, sheet bindings, names, and calculations.

### Binding and unbinding

- When binding an existing sheet, map its columns to model properties by declaration order: the first column maps to the first property, the second to the second, and so on. Retain existing rows and manual data in those positions, overwriting contents where the model requires it, including calculated properties; do not clear the sheet wholesale.
- Allow a sheet to be unbound. Keep its rows, columns, and input data, and materialize calculated results as ordinary cell values rather than retaining model formulas. The sheet becomes independently editable and no longer follows model changes.

### Data model changes

- Update all bound sheets when their data model changes, reshaping columns to its current property order and recalculating its formulas.
- Match unchanged property names across order changes. Preserve their manual values and column identities so reordering does not lose data or redirect references.
- Treat a new or renamed property as a new column. New manual properties start empty and require data entry; removed properties lose their stored data. A rename may therefore behave as removal followed by addition.
- Keep this initial behavior simple: do not infer renames or add schema migration or elaborate change-reconciliation workflows.

### Named properties and reference identity

- Allow users to refer to a cell through its sheet name, property name, and row number. `Sheet!property[12]` illustrates the intended reference; the exact syntax remains open.
- Resolve sheet and property names and the current row position to stable sheet, column, and row identities. Names and row numbers describe a target; they do not define its identity.
- Display current names when references are edited or inspected. Sheet rename retains reference targets. Removed or replaced properties produce broken references, not silent rebinding to a new column at the same position.
- Preserve A1 references alongside named-property references.

### Rich formula editing

- Provide a comfortable formula-editing surface with syntax colours for functions, literals, operators, and references.
- Support multiline editing, indentation, and readable formatting without changing calculation meaning.
- Autocomplete supported functions, sheets, and named properties.
- Show inline parse and reference diagnostics while preserving unfinished or invalid formula text.
- Offer reference hover information, including current values and errors.
- Share token and reference information across highlighting, autocomplete, diagnostics, inspection, and navigation, including during incomplete edits.

### Keyboard-first navigation

- Search for and jump to a sheet by typing its name, and provide a browsable list of all sheets.
- Jump to a named column or a numbered row within the current sheet.
- Follow formula references through shortcuts and navigate from a named property to its data model definition.
- Find usages and dependents of cells and properties.
- Provide Back and Forward navigation that restores viewing context and selection independently of edit Undo and Redo.
- Make navigation commands and shortcuts discoverable through a command palette.

### Spatial calculation links

- Show coloured, faded links from a formula to its source cells or ranges on selection or on demand. Keep the display contextual rather than always showing every connection.
- Coordinate reference colours across formula tokens, source highlights, and links.
- Allow navigation to a source through its link.
- Keep links attached to the correct targets through sheet movement, resizing, overlap, visual-scale changes, viewport zoom, scrolling, and virtualization.

### Usability and responsiveness

- Preserve editing drafts, selection, and focus through navigation and rendering changes.
- Make typing, selection, scrolling, zooming, formula editing, and reference jumps feel immediate.
- Measure representative larger workbooks with repeatable fixtures to identify rendering, calculation, and interaction bottlenecks.
- Address demonstrated bottlenecks and keep expensive work away from routine interactions where practical. Optimize from evidence rather than speculative architectural changes.

## Completion Signal

- A user can bind multiple sheets to one data model and immediately see its ordered columns and consistent row calculations, with independent input data and no per-row formula drift.
- Binding preserves existing data except where the model requires replacement. Unbinding retains the materialized data as an ordinary editable sheet.
- Model changes update all bound sheets. Reordering unchanged names preserves manual values and reference targets; new or renamed manual properties start empty, and removed targets become broken references.
- Data models, sheet bindings, and calculations survive reload, and sheet rename preserves reference targets.
- A user can comfortably edit a complex supported formula, receive useful suggestions and diagnostics, and retain an unfinished draft while navigating.
- Sheet search, sheet listing, column and row jumps, reference shortcuts, and usage discovery make a substantial workbook navigable without repeated manual searching.
- Back and Forward restore navigation context without changing contents or edit history.
- Matching token colours, source highlights, and faded links make calculation inputs understandable and remain correct as the workspace changes.
- Representative larger workbooks remain responsive during ordinary editing and navigation, supported by repeatable measurements and regression checks.

## Decisions To Resolve

- Named-property reference syntax, including quoting and ambiguity with A1 references.
- Where formulas and data models are edited, and how formatted text preserves the user's raw input.
- Which movements navigation history records and how Forward behaves after navigation branches.
- Representative performance workloads and acceptable interaction-latency budgets.

Resolve these choices in the relevant Deliverables before implementing the affected behavior.

## Deferred Work

- Range extraction and structural comparison.
- General row and column insertion, deletion, and reordering beyond foundations required by this phase.
- Comments, reporting, interchange, and unrelated formula-function expansion.

## References

- [03-fluent-spreadsheet-editing.md](03-fluent-spreadsheet-editing.md)
- [features/table-object-model.md](../features/table-object-model.md)
- [features/columns-rows-structure.md](../features/columns-rows-structure.md)
- [features/formula-editor.md](../features/formula-editor.md)
- [features/references-and-navigation.md](../features/references-and-navigation.md)
- [features/interaction-polish.md](../features/interaction-polish.md)
