# Formulas

MVP importance: Limited.

## Purpose

Formulas make sheets more than static tables. The formula engine should grow slowly, with correctness and clear errors taking priority over broad compatibility.

## MVP Slice

- Treat cell content beginning with `=` as a formula.
- Support `SUM` only.
- Support enough A1-style references and ranges for `SUM` to be useful.
- Recompute formulas after edits.
- It is acceptable to recompute the whole workspace after each edit if incremental recalculation would add complexity.
- Display basic formula errors without crashing the app.

## MVP Limitations

- No broad Excel formula compatibility.
- No arithmetic operators unless they are already trivial in the chosen formula parser.
- No `SUMIF`, lookup functions, text functions, logical functions, or custom functions.
- No formula optimization requirements.
- No dependency graph requirement for the MVP.
- No custom column names in formulas.
- Cross-sheet formulas are not required for the MVP unless they are already cheap to support.

## Long-Term Scope

- Parse formulas into an AST.
- Evaluate formulas against a workbook snapshot.
- Track dependencies between cells and ranges.
- Recalculate affected cells instead of the whole workbook.
- Detect circular references.
- Support typed errors such as `#PARSE!`, `#REF!`, `#NAME!`, `#VALUE!`, `#DIV/0!`, `#CYCLE!`, and `#N/A`.
- Expand formula support deliberately after the parser and evaluator are stable.

## Candidate Function Growth

- Aggregation: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`.
- Conditional: `IF`, `SUMIF`, `COUNTIF`.
- Lookup: `VLOOKUP`, `XLOOKUP`, or a simplified equivalent.
- Text basics: `CONCAT`, `LEFT`, `RIGHT`, `LEN`.
- Logical: `AND`, `OR`, `NOT`.
- Arithmetic and comparison operators.

## Open Decisions

- Should formulas be case-insensitive like Excel?
- Should formula evaluation coerce text and numbers like Excel, or use stricter rules?
- When should a dependency graph become necessary?
