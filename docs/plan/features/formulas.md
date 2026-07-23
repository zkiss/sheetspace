# Formulas

## Purpose

Formulas make sheets more than static tables. The formula engine should grow deliberately, with correctness and clear errors taking priority over broad compatibility.

## Feature Scope

- Treat cell content beginning with `=` as a formula.
- Store each cell as its raw string value, without a cell-content wrapper or persisted formula metadata.
- Match function names and boolean literals case-insensitively while preserving raw formula text.
- Store cross-sheet qualifiers as stable sheet ids inside canonical formula strings; translate visible sheet names to ids when edits commit and ids back to current names while editing.
- Parse formulas into an AST.
- Evaluate formulas against a workbook snapshot.
- Support A1-style cell references, ranges, and cross-sheet references.
- Support `SUM` with a variable number of arguments, where each argument can be an individual cell reference or a 2D range, such as `=SUM(A1)`, `=SUM(A1,B2)`, and `=SUM(A1:C3,D4)`.
- Track dependencies between cells and ranges.
- Recalculate affected cells instead of the whole workbook.
- Detect circular references.
- Compute formulas independently where possible.
- Treat formula errors as cell-level results: cells that cannot be computed should display an error while unrelated formulas continue computing where possible.
- Support typed errors such as `#PARSE!`, `#REF!`, `#NAME!`, `#VALUE!`, `#DIV/0!`, `#CYCLE!`, and `#N/A`.
- Keep the app and UI usable when formulas fail.
- Keep cells with formula errors selectable and editable.
- Render missing cross-sheet ids as `#REF` qualifiers and evaluate them as `#REF!` without rebinding them by name.
- Expand formula support deliberately after the parser and evaluator are stable.

## Candidate Function Growth

- Aggregation: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`.
- Conditional: `IF`, `SUMIF`, `COUNTIF`.
- Lookup: `VLOOKUP`, `XLOOKUP`, or a simplified equivalent.
- Text basics: `CONCAT`, `LEFT`, `RIGHT`, `LEN`.
- Logical: `AND`, `OR`, `NOT`.
- Arithmetic and comparison operators.

## Phase 2 Value And Evaluation Contract

Phase 2 uses predictable typed behavior rather than Excel-compatible coercion. The rules in this section are the shared contract for the parser, evaluator, UI, and tests.

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

- Numeric literals use decimal syntax: `12`, `12.`, `.5`, `12.5`, `1e3`, and `1.5E-2` are valid. A leading sign is a unary operator, not part of the literal. Hexadecimal, `NaN`, `Infinity`, locale-specific separators, and bare `.` are invalid. A syntactically valid literal outside the finite numeric range produces `#VALUE!`; a non-formula cell becomes numeric only when the parsed value is finite.
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
| `SUMIF` | One cell/range and one scalar criterion, plus an optional same-shaped cell/range | Sum numeric values at matching positions. When the sum range is omitted, sum matching positions from the criteria range. |

Wrong argument count produces `#VALUE!`. `ABS`, `SQRT`, and `NOT` do not accept blank. A missing `IF` branch is not treated as blank.

Examples:

| Formula and inputs | Result |
| --- | --- |
| `=SUM(1, "2", TRUE, A1)` with empty `A1` | `1` |
| `=AVERAGE(A1:A3)` with blank/text/boolean values | `#DIV/0!` |
| `=COUNT(1, "1", TRUE)` | `1` |
| `=COUNTA(A1:A3)` with blank, `""`, and `FALSE` | `2` |
| `=IF(FALSE, 1/0, "safe")` | `safe` |
| `=AND(TRUE, A1:A2)` with blank then `FALSE` | `FALSE` |
| `=SQRT(-1)` | `#VALUE!` |

### Conditional aggregate criteria

A criterion expression must evaluate to one non-error scalar. A number or boolean criterion means same-category equality. A text criterion uses this grammar:

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
| `=SUMIF(A1:A3, ">0", B1:B2)` | `#VALUE!` because shapes differ. |

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

Invalid syntax produces `#PARSE!` before value evaluation. Valid AST nodes, including references and function calls, are resolved when evaluation visits them; dependency extraction may inspect reference nodes without evaluating them. Within evaluation, binary operands and function arguments are visited left-to-right, and range cells use row-major order. The first visited error propagates. `IF` does not visit its unselected branch; `AND` and `OR` do not visit values after a decisive result. Conditional aggregates use the additional matched-position rule above. Structural cycle detection still applies to every parsed reference, including one in a lazy branch, and yields `#CYCLE!` for every cell in or transitively dependent on that cycle without preventing independent cells from evaluating.

Display is derived and never persisted: numbers use a locale-independent shortest decimal form with no grouping and display negative zero as `0`; booleans display `TRUE` or `FALSE`; text displays its content; blank displays empty; errors display their exact token. Formula cells retain raw formula content for editing even when their displayed result is an error.
