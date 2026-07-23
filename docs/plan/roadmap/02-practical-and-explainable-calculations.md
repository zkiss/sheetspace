# Phase 2 Task: Practical And Explainable Calculations

## Goal

Turn the MVP formula slice into a small but practical calculation environment and add the first workflow for following data through a spatial workbook.

The MVP proves that users can arrange sheets, edit cells, persist a workbook, and evaluate `SUM` across cells, ranges, and sheets. Phase 2 is the next product increment: users should be able to express ordinary numeric and conditional calculations, trust recalculation and error isolation, and jump from a formula to the cells it uses.

This phase deliberately deepens the core spreadsheet-and-navigation loop rather than adding a broad set of unrelated spreadsheet features.

## Prerequisites

- The behavior in [01-mvp.md](01-mvp.md) is complete.
- Formula cells are stored as canonical strings, and cross-sheet qualifiers use stable sheet ids as described in [features/formulas.md](../features/formulas.md).
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

## Formula Value And Evaluation Contract

Phase 2 uses predictable typed behavior rather than Excel-compatible coercion. These rules are the shared delivery contract for its parser, evaluator, UI, and tests.

### Values and cell classification

The evaluator has five value categories:

- **Number:** a finite numeric value.
- **Text:** a string, including the empty string produced by a formula literal.
- **Boolean:** `TRUE` or `FALSE`.
- **Blank:** an empty cell. Blank is distinct from number `0`, text `""`, and boolean `FALSE`.
- **Error:** one of the typed error values described below.

A non-formula cell with exactly zero characters is blank. For other non-formula cells, trim leading and trailing whitespace only while testing the whole content against the Phase 2 numeric grammar or `TRUE`/`FALSE`. A match becomes a number or boolean; otherwise the value is text and retains its complete raw content. A whitespace-only cell is therefore text, not blank.

Formula results keep their value category when referenced. No operator silently converts text, booleans, or blank to numbers, and no operator uses truthiness.

### Formula syntax and raw text

- Numeric literals use the decimal grammar below. It allows forms such as `01`, `12.`, `.5`, `1.e2`, `.5e2`, and `1e+2`. A leading sign is a unary operator, not part of the literal. Hexadecimal, `NaN`, `Infinity`, locale-specific separators, and bare `.` are invalid. A syntactically valid literal outside the finite numeric range produces `#VALUE!`; a non-formula cell becomes numeric only when the parsed value is finite.

  ```text
  digit    := "0" | "1" | ... | "9"
  digits   := digit+
  exponent := ("e" | "E") ("+" | "-")? digits
  number   := digits ("." digits?)? exponent?
            | "." digits exponent?
  ```

- Quoted text literals begin and end with `"`. Two consecutive quotes inside a literal represent one quote, so `"say ""hi"""` evaluates to `say "hi"`. Backslash has no escape meaning. Newlines are allowed inside quoted text.
- Boolean literals and function names are ASCII case-insensitive. `true`, `TRUE`, and `TrUe` all evaluate to the same boolean.
- Whitespace may appear between tokens and includes spaces, tabs, and line breaks. Whitespace inside quoted text is content.
- Cell content beginning with `=` is parsed as a formula. Invalid or trailing syntax produces `#PARSE!`.
- The user's raw formula text, including casing, whitespace, literal spelling, and line breaks, is preserved. Existing cross-sheet edit-to-storage translation may replace a visible sheet qualifier with its stable sheet id, but must not normalize unrelated text.

Operator precedence, from tightest to loosest, is parentheses, unary `+`/`-`, `*`/`/`, `+`/`-`, then comparisons. Binary operators of the same precedence associate left-to-right. Chained comparisons are invalid syntax in Phase 2.

### Scalar operators

Unary `+` and `-` require one number. Arithmetic `+`, `-`, `*`, and `/` require two numbers. Text, boolean, blank, or a range in any operand position produces `#VALUE!`. Division by positive or negative zero produces `#DIV/0!`. A non-finite arithmetic result produces `#VALUE!`.

Comparisons `=`, `<>`, `<`, `<=`, `>`, and `>=` require scalar operands of the same category. Numbers use numeric ordering, text uses case-sensitive Unicode code-point ordering, booleans order `FALSE` before `TRUE`, and blank may only be compared with blank. Cross-category comparisons and ranges produce `#VALUE!`.

Examples:

| Formula | Result |
| --- | --- |
| `=-(2 + 3) * 4 / 2` | `-10` |
| `=1 + "2"` | `#VALUE!` |
| `=A1 + 1` with empty `A1` | `#VALUE!` |
| `=1 / 0` | `#DIV/0!` |
| `="A" < "a"` | `TRUE` |
| `=1 = "1"` | `#VALUE!` |

### Function rules

A **scalar** is one non-range value. A **collection argument** may be a scalar, cell reference, or 2D range. Ranges are visited in row-major order: left-to-right within each row, then top-to-bottom. Unless a function below explicitly accepts collections, a range in a scalar position produces `#VALUE!`.

Numeric aggregates inspect all values in their collection arguments. They include numbers and ignore text, booleans, and blank regardless of whether those values came from a literal, direct reference, or range. Errors are not ignored.

| Function | Arity and accepted inputs | Result and empty behavior |
| --- | --- | --- |
| `SUM` | Zero or more collections | Sum of numbers; `0` when there are none. |
| `AVERAGE` | One or more collections | Mean of numbers; `#DIV/0!` when there are none. |
| `MIN`, `MAX` | One or more collections | Minimum or maximum number; `#VALUE!` when there are none. |
| `COUNT` | One or more collections | Count of numbers; `0` when there are none. |
| `COUNTA` | One or more collections | Count of number, text, and boolean values. Blank is not counted. |
| `ABS` | Exactly one numeric scalar | Absolute value. |
| `SQRT` | Exactly one numeric scalar | Non-negative square root; a negative input produces `#VALUE!`. |
| `IF` | Exactly three scalar arguments | Condition must be boolean. Evaluate and return only the selected branch. A selected blank remains blank; a selected range produces `#VALUE!`. |
| `AND`, `OR` | One or more collections | Accept booleans, ignore blank, reject numbers and text with `#VALUE!`; no boolean values produces `#VALUE!`. `AND` stops at the first `FALSE`; `OR` stops at the first `TRUE`. |
| `NOT` | Exactly one boolean scalar | Boolean negation. |
| `COUNTIF` | Exactly one cell/range and one scalar criterion | Count matching cells. |
| `SUMIF` | One cell/range and one scalar criterion, plus an optional same-shaped cell/range | Sum numeric values at matching positions. When the sum range is omitted, sum matching positions from the criteria range. Zero matches or no numeric matched values produce `0`. |

Wrong argument count produces `#VALUE!`. `ABS`, `SQRT`, and `NOT` do not accept blank. A missing `IF` branch is not treated as blank.

Examples:

| Formula and inputs | Result |
| --- | --- |
| `=SUM(1, "2", TRUE, A1)` with empty `A1` | `1` |
| `=AVERAGE(A1:A3)` with blank/text/boolean values | `#DIV/0!` |
| `=COUNT(1, "1", TRUE)` | `1` |
| `=COUNTA(A1:A3)` with blank, `""`, and `FALSE` | `2` |
| `=IF(FALSE, 1/0, "safe")` | `safe` |
| `=IF(FALSE, ABS(1, 2), 0)` | `0`; the invalid unselected call is not visited. |
| `=IF(FALSE, UNKNOWN(), 0)` | `0`; the unknown unselected call is not visited. |
| `=AND(TRUE, A1:A2)` with blank then `FALSE` | `FALSE` |
| `=SQRT(-1)` | `#VALUE!` |

### Conditional aggregate criteria

A criterion expression must evaluate to one non-error scalar. A blank criterion means equality with blank. A number or boolean criterion means same-category equality. A text criterion uses this grammar:

```text
[operator] operand
operator := = | <> | < | <= | > | >=
```

The longest leading operator is used. With no operator, the whole text is an equality operand. The operand is interpreted as a number when it matches the finite numeric grammar, as a boolean when it is `TRUE` or `FALSE` case-insensitively, and otherwise as case-sensitive text. Operand whitespace is content, not implicitly trimmed.

A criteria operand enclosed in `"` characters is forced to text and uses doubled quotes for escaping. It must consume the complete operand. For example, criteria text `="10"` matches text `10`, while criteria text `=10` matches number `10`. In a formula string literal the former is written `"=""10"""`. `=` with an empty operand matches blank; `<>` with an empty operand matches any non-blank value. Other operators with an empty operand, or malformed forced-text quoting, produce `#VALUE!`.

Equality criteria only match the operand's category; values of other categories are non-matches. Ordered criteria only compare numbers with numbers, text with text, or booleans with booleans; other categories are non-matches. This non-match rule is local to conditional aggregates and does not weaken the scalar comparison rules.

Examples:

| Formula and inputs | Result |
| --- | --- |
| `=COUNTIF(A1:A4, ">=10")` over `9`, `10`, `"10"`, `11` | `2` |
| `=COUNTIF(A1:A3, TRUE)` over `TRUE`, `"TRUE"`, `1` | `1` |
| `=COUNTIF(A1:A3, "=")` over blank, `""`, `0` | `1` |
| `=COUNTIF(A1:A2, "=""10""")` over `"10"`, `10` | `1` |
| `=COUNTIF(A1:A2, "==open")` over `"=open"`, `"open"` | `1` |
| `=COUNTIF(A1:A3, B1)` with `B1` containing `>=10` | Same as literal criterion `">=10"`. |
| `=COUNTIF(A1:A3, B1)` with blank `B1` | Count blank cells in `A1:A3`. |
| `=SUMIF(A1:A3, ">0", B1:B2)` | `#VALUE!` because shapes differ. |
| `=SUMIF(A1:A2, ">0", B1:B2)` with no matches | `0`. |

Criteria and sum inputs must be references to one cell or rectangular 2D ranges. Their dimensions must match; otherwise return `#VALUE!`. `COUNTIF` may match blank. `SUMIF` ignores blank, text, and boolean sum values at matched positions. An error in the criterion itself propagates. An error encountered in a criteria-range cell propagates; an error in a sum-range cell propagates only when its corresponding criterion matches.

### Errors, evaluation order, and display

Phase 2 errors are values:

| Error | Meaning |
| --- | --- |
| `#PARSE!` | Invalid formula syntax. |
| `#REF!` | Missing sheet/cell target or invalid reference bounds. |
| `#NAME!` | Unknown function or name. |
| `#VALUE!` | Wrong type, arity, shape, criterion, domain, or other invalid argument. |
| `#DIV/0!` | Division by zero or an average with no numeric values. |
| `#CYCLE!` | Cell belongs to, or depends on, a reference cycle. |
| `#N/A` | Reserved for later functions; no Phase 2 operation creates it. |

Invalid syntax produces `#PARSE!` before value evaluation. Other validation is node-local: only when evaluation visits a function-call node does it validate the function name, then its arity, required scalar/collection form, and conditional-range shape, before evaluating that node's argument values. An unknown visited function produces `#NAME!`; other structural failures produce `#VALUE!`. Thus `ABS(1/0, 2)` and a shape-invalid `SUMIF` return `#VALUE!` without evaluating their arguments, while an invalid or unknown function in an unselected `IF` branch produces no error.

After structural validation, AST nodes, including references and function calls, are resolved when evaluation visits them; dependency extraction may inspect reference nodes without evaluating them. Binary operands and function arguments are visited left-to-right, and range cells use row-major order. The first visited error propagates. `IF` does not visit its unselected branch; `AND` and `OR` do not visit values after a decisive result. Conditional aggregates use the additional matched-position rule above. Structural cycle detection still applies to every parsed reference, including one in a lazy branch, and yields `#CYCLE!` for every cell in or transitively dependent on that cycle without preventing independent cells from evaluating.

Display is derived and never persisted: numbers use ECMAScript `Number::toString(10)` formatting (or byte-for-byte equivalent output), with negative zero normalized to `0`; booleans display `TRUE` or `FALSE`; text displays its content; blank displays empty; errors display their exact token. Formula cells retain raw formula content for editing even when their displayed result is an error.

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

- [PROJECT_VISION.md](../PROJECT_VISION.md)
- [01-mvp.md](01-mvp.md)
- [features/formulas.md](../features/formulas.md)
- [features/references-and-navigation.md](../features/references-and-navigation.md)
- [features/formula-editor.md](../features/formula-editor.md)
