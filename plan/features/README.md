# Sheetspace Feature Briefs

This directory splits the product vision into feature-level briefs. Each brief describes the long-term capability and how important it is to the first MVP.

## MVP Importance

- Required: the MVP needs this capability.
- Limited: the MVP needs a small slice, while most of the feature is deferred.
- Deferred: not part of the MVP, but important soon after the basic loop works.
- Later: useful long-term, but should not shape the first implementation.
- Research: promising idea, but needs design exploration before commitment.

## Feature Index

| Feature | MVP importance | Brief |
| --- | --- | --- |
| Spatial workspace | Required | [workspace.md](workspace.md) |
| Sheet frames | Limited | [sheet-frames.md](sheet-frames.md) |
| Grid editing | Required | [grid-editing.md](grid-editing.md) |
| Formulas | Limited | [formulas.md](formulas.md) |
| References and navigation | Deferred | [references-and-navigation.md](references-and-navigation.md) |
| Columns, rows, and structure | Limited | [columns-rows-structure.md](columns-rows-structure.md) |
| Persistence and portability | Deferred | [persistence-portability.md](persistence-portability.md) |
| Interaction polish | Later | [interaction-polish.md](interaction-polish.md) |
| Formula editor | Later | [formula-editor.md](formula-editor.md) |
| Comments and annotations | Later | [comments-and-annotations.md](comments-and-annotations.md) |
| Structure refactoring | Later | [structure-refactoring.md](structure-refactoring.md) |
| Report sheets and visualization | Later | [report-sheets.md](report-sheets.md) |
| Groups, layers, and sectors | Later | [grouping-and-organization.md](grouping-and-organization.md) |
| Custom functions and programming | Research | [custom-functions-and-programming.md](custom-functions-and-programming.md) |
| Table object model | Research | [table-object-model.md](table-object-model.md) |

## MVP Feature Set

The MVP should use only the Required and small Limited slices:

- Basic tabular worksheets.
- Multiple sheets.
- Free 2D placement of sheets.
- Pan and zoom.
- Basic cell editing.
- Formula entry with `SUM` only.
- Default column labels only.

See [../mvp.task.md](../mvp.task.md) for the first implementation task.
