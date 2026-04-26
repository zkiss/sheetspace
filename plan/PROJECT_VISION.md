# Sheetspace Project Vision

## Product Summary

Sheetspace is a spatial spreadsheet workspace. It combines familiar spreadsheet editing with a zoomable 2D canvas, then adds IDE-like tools for understanding formulas, references, and data flow.

The core product idea is that a workbook should not be limited to a stack of hidden tabs. A user should be able to place multiple sheets freely in space, arrange source data, assumptions, calculations, reports, and experiments visually, then inspect how those sheets relate to each other.

The long-term goal is to make spreadsheet work feel like a visual system map: editable like Excel or Google Sheets, navigable like an IDE, and structured enough to evolve safely over time.

## Problem

Traditional spreadsheets are powerful, but large workbooks become hard to reason about:

- Related sheets are hidden behind tabs instead of visible together.
- Formulas can reference distant cells or other sheets without making those dependencies easy to inspect.
- Source data, intermediate calculations, assumptions, and outputs often become mixed together.
- Reorganizing a workbook is risky because moving ranges and preserving references is mostly manual.
- A single grid is a poor visual model for workflows made from many related tables.

Sheetspace addresses this by treating sheets as movable objects in a larger workspace and treating formula references as first-class navigable entities.

## Target Users

Primary users:

- Analysts building models with multiple source tables, calculations, and outputs.
- Operators tracking budgets, inventory, planning, pipelines, or workflows.
- Product, finance, and strategy teams using spreadsheets as lightweight tools.
- Technical users who like spreadsheet flexibility but want better navigation and structure.

Secondary users:

- Educators explaining data flows visually.
- Consultants building exploratory client models.
- Builders prototyping internal tools before committing to a database-backed app.

## Product Principles

1. Familiar spreadsheet editing comes first.
   The grid should feel recognizable: selecting cells, editing values, writing formulas, and moving through rows and columns should not require a new mental model.

2. Spatial layout should clarify relationships.
   The 2D workspace should help users place related sheets near each other and understand the shape of a model at a glance.

3. References should become inspectable and navigable.
   Formula references should eventually behave like code symbols: jumpable, hoverable, highlightable, and refactorable.

4. Build in useful slices.
   Each milestone should produce a usable product increment rather than a broad unfinished clone of an existing spreadsheet.

5. Correctness matters more than formula breadth.
   A small, well-tested formula engine is better than a wide but unreliable Excel compatibility layer.

6. User data should remain portable.
   The model should leave room for JSON, CSV, XLSX, and other import/export paths even if the first implementation is local and simple.

## Long-Term Product Shape

The full product is made from focused feature areas, each tracked in its own brief under [features/](features/README.md):

- A pan-and-zoom 2D workspace for arranging sheets.
- Movable sheet frames that hold tabular worksheets.
- Spreadsheet grid editing with selection, editing, headers, copy/paste, and structural operations.
- A formula engine with parsing, evaluation, errors, dependency tracking, and a deliberately grown function set.
- Reference inspection and IDE-style navigation across cells, ranges, and sheets.
- Formula editing tools such as token highlighting, hover information, multiline editing, and comments.
- Cell comments and annotations for explaining assumptions and review notes.
- Refactoring tools such as extracting selected regions into new sheets.
- Report sheets, charts, grouping, layers, sectors, table object patterns, and custom functions as later capabilities.

The feature briefs are the detailed source of scope. This document should stay high level and directional.

## MVP Direction

The MVP should prove the smallest useful version of the product:

- Basic tabular worksheets.
- Multiple sheets in one workspace.
- Free placement of sheets in 2D space.
- Pan and zoom.
- Basic cell editing.
- Simple formula editing with a very small formula set.

The MVP is intentionally narrow. It should not attempt resizing, jump-to-reference navigation, hover inspection, custom column names, broad formula compatibility, structural refactoring, or advanced spreadsheet behavior. The exact first iteration is specified in [mvp.task.md](mvp.task.md).

Technical stack decisions belong in the project skeleton and related technical notes, not in the MVP task. Current technical planning is in [tech-skeleton.md](tech-skeleton.md).

## Iterative Roadmap

1. Project skeleton.
   Establish the repository structure, build orchestration, test setup, and a runnable shell.

2. MVP.
   Implement the smallest spatial spreadsheet loop described in [mvp.task.md](mvp.task.md).

3. Spreadsheet depth.
   Add more grid behavior, persistence, formula coverage, error handling, and cross-sheet references.

4. Reference understanding.
   Add tokenized formula references, hover inspection, visual reference links, jump-to-definition, jump-to-sheet, and navigation history.

5. Structural editing.
   Add row/column operations, custom column names, extraction refactors, diff tools, and safer formula behavior during reorganization.

6. Higher-level modeling.
   Explore report sheets, charts, grouping, layers, sectors, custom functions, and table object patterns.

## Success Measures

Early success:

- A user can create or use several sheets, arrange them spatially, and edit values.
- A user can zoom out to understand the workspace and zoom in to work on a sheet.
- Simple formulas work reliably within the supported scope.

Medium-term success:

- A user can inspect where a formula gets its data from without manually searching.
- Cross-sheet references become understandable through hover, highlighting, and navigation.
- The app remains responsive on small-to-medium real workbooks.

Long-term success:

- A user can restructure a messy workbook into clearer spatial components with less manual risk.
- Sheetspace becomes a practical alternative for spreadsheet models where spatial organization and formula understanding matter.

## North Star

Sheetspace should feel like a spreadsheet workbook that can be laid out like a system diagram and understood like code.

The product is not just a canvas with tables on it. It is a spreadsheet environment where data relationships are visible, references are navigable, and structure can evolve safely over time.
