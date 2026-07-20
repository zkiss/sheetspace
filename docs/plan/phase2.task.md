# Phase 2 Task: Practical And Explainable Calculations

## Goal

Turn the MVP formula slice into a small but practical calculation environment and add the first workflow for following data through a spatial workbook.

The MVP proves that users can arrange sheets, edit cells, persist a workbook, and evaluate `SUM` across cells, ranges, and sheets. Phase 2 is the next product increment: users should be able to express ordinary numeric and conditional calculations, trust recalculation and error isolation, and jump from a formula to the cells it uses.

This phase deliberately deepens the core spreadsheet-and-navigation loop rather than adding a broad set of unrelated spreadsheet features.

## Prerequisites

- The behavior in [mvp.task.md](mvp.task.md) is complete.
- Formula cells are stored as canonical strings, and cross-sheet qualifiers use stable sheet ids as described in [features/formulas.md](features/formulas.md).
- Visible sheet names remain editor syntax; navigation and evaluation resolve canonical references without depending on the current name.

## Included Scope

### Formula values and expressions

- Support numeric, quoted text, and boolean literals in formulas.
- Treat `TRUE` and `FALSE` and function names case-insensitively while preserving the user's raw formula text.
- Support parentheses and conventional operator precedence.
- Support unary positive and negative expressions.
- Support arithmetic operators `+`, `-`, `*`, and `/`.
- Support comparison operators `=`, `<>`, `<`, `<=`, `>`, and `>=`, producing boolean results.
- Define one documented set of rules for empty cells, type mismatches, range arguments, and coercion. Prefer predictable typed behavior over attempting broad Excel compatibility.

### Function growth

- Add common numeric and aggregate functions: `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `ABS`, and `SQRT`.
- Add logical functions: `IF`, `AND`, `OR`, and `NOT`.
- Make `IF` evaluate only the selected branch so an error in an unused branch does not become the cell result.
- Define a small, explicit criteria syntax shared by conditional aggregate functions.
- Add `SUMIF` and `COUNTIF` for individual cells and 2D ranges, including cross-sheet ranges.
- Return typed cell-level errors for invalid arguments, invalid criteria, division by zero, and other evaluation failures.

### Dependency-aware calculation

- Track direct dependencies from parsed cell and range references.
- Recalculate cells affected by an edit without requiring an unrelated formula to recompute.
- Detect direct and indirect circular references and return `#CYCLE!` for affected cells while unrelated formulas continue computing.
- Keep dependency behavior correct across edits, sheet renames, sheet deletion, and persisted-workbook reloads.

### First reference-navigation workflow

- Preserve reference token spans from parsing so the UI can distinguish cell, range, and cross-sheet references in raw formula text.
- Expose reference tokens for the currently selected formula through a minimal inspection surface; a full rich formula editor is not required in this phase.
- Let a user invoke navigation from a reference token with `Ctrl`-click or `Cmd`-click.
- Bring the referenced sheet and cells into view, select the target cell or range, and briefly highlight the navigation target.
- Make same-sheet and cross-sheet navigation work without changing the formula or sheet z-order.
- Show broken references as non-navigable and keep the formula cell editable.

## Interaction And Semantic Decisions

- Arithmetic follows conventional precedence: parentheses, unary operators, multiplication/division, addition/subtraction, then comparisons.
- Type and empty-cell behavior must be shared by every operator and function rather than implemented independently per function.
- Conditional-aggregate criteria should support equality and the comparison operators in this phase; wildcard matching and Excel's wider criteria coercions are deferred.
- Formula errors remain values displayed by individual cells. They must not crash the application, block editing, or prevent independent calculations.
- Reference navigation changes workspace focus and selection only. It does not rewrite formulas or implicitly reorder overlapping sheets.

## Acceptance Criteria

- A user can evaluate grouped arithmetic with references and literals, including formulas such as `=-(A1 + 2) * B1 / 4`.
- Comparisons produce boolean values, and boolean literals can be used in logical functions.
- A user can build conditional results such as `=IF(A1 >= 10, "high", "low")`.
- The added numeric, aggregate, logical, and conditional aggregate functions work with their documented scalar and range inputs.
- Invalid operations produce the appropriate cell-level error, and unrelated cells remain usable and continue computing.
- Editing an input recomputes its transitive dependents, while formulas outside that dependency path remain unaffected.
- Direct and indirect cycles display `#CYCLE!` without blocking independent formula evaluation.
- A user can identify reference tokens for a selected formula and navigate to same-sheet and cross-sheet cell or range targets.
- Navigation brings an offscreen target into view, selects it, and provides a temporary visual highlight.
- Broken references remain visible but cannot navigate to an incorrect target.
- Formula values, errors, dependency behavior, and stable cross-sheet identity remain correct after persistence and reload.

## Out Of Scope

- Broad Excel formula compatibility, lookup functions, text functions beyond literals, date/time functions, array formulas, named ranges, and custom functions.
- Wildcards or full Excel-compatible coercion in `SUMIF` and `COUNTIF` criteria.
- Multiline formula editing, autocomplete, formatting, comments, and a full formula bar.
- Reference hover previews, dependency lines, clickable lines, and navigation history.
- Range copy/paste, fill handles, undo/redo, and cell presentation formatting.
- Row or column insertion, deletion, and reference rewriting for structural edits.
- Import/export, report sheets, charts, grouping, and structure refactoring.

## References

- [PROJECT_VISION.md](PROJECT_VISION.md)
- [mvp.task.md](mvp.task.md)
- [features/formulas.md](features/formulas.md)
- [features/references-and-navigation.md](features/references-and-navigation.md)
- [features/formula-editor.md](features/formula-editor.md)

