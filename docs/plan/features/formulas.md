# Formulas

## Purpose

Formulas make sheets more than static tables. The formula engine should grow deliberately, with correctness and clear errors taking priority over broad compatibility.

## Feature Scope

- Treat cell content beginning with `=` as a formula.
- Store each cell as its raw string value, without a cell-content wrapper or persisted formula metadata.
- Match function names and boolean literals case-insensitively while preserving formula text outside translated reference tokens.
- Keep formula references stable as sheets and coordinates change, while showing readable names and addresses during editing.
- Parse formulas into an AST.
- Evaluate formulas against a workbook snapshot.
- Support explicit `@`-prefixed cell references, ranges, and cross-sheet references.
- Support `SUM` with a variable number of arguments, where each argument can be an individual cell reference or a 2D range.
- Track dependencies between cells and ranges.
- Recalculate affected cells instead of the whole workbook.
- Detect circular references.
- Compute formulas independently where possible.
- Treat formula errors as cell-level results: cells that cannot be computed should display an error while unrelated formulas continue computing where possible.
- Support typed errors such as `#PARSE!`, `#REF!`, `#NAME!`, `#VALUE!`, `#DIV/0!`, `#CYCLE!`, and `#N/A`.
- Keep the app and UI usable when formulas fail.
- Keep cells with formula errors selectable and editable.
- Keep missing reference targets broken rather than rebinding them to replacement names or positions.
- Expand formula support deliberately after the parser and evaluator are stable.

## Candidate Function Growth

- Aggregation: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`.
- Conditional: `IF`, `SUMIF`, `COUNTIF`.
- Lookup: `VLOOKUP`, `XLOOKUP`, or a simplified equivalent.
- Text basics: `CONCAT`, `LEFT`, `RIGHT`, `LEN`.
- Logical: `AND`, `OR`, `NOT`.
- Arithmetic and comparison operators.
