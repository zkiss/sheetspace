# Sheetspace Product Roadmap

## Purpose

This roadmap sequences the current product vision into usable increments. Feature briefs describe the full direction of each capability; phase plans define when coherent slices come together.

The sequence is directional rather than date-based. Product learning may reshape later phases, but a change should keep the phase plans, feature briefs, and Bead graph aligned.

## Sequence

| Stage | Product increment |
| --- | --- |
| [Technical skeleton](tech-skeleton.task.md) | Establish the Makefile-driven frontend, backend, database, and test foundation. |
| [MVP](mvp.task.md) | Prove the spatial spreadsheet loop with movable sheets, cell editing, `SUM`, references, and persistence. |
| [Phase 2](phase2.task.md) | Make calculations practical and add the first reference-navigation workflow. |
| [Phase 3](phase3.task.md) | Make grid editing fluent and establish wide-range canvas navigation and multi-scale sheet composition. |
| [Phase 4](phase4.task.md) | Make structural changes and range extraction safe and understandable. |
| [Phase 5](phase5.task.md) | Make formulas and spatial data flow inspectable and navigable like code. |
| [Phase 6](phase6.task.md) | Let users organize large workspaces and explain their models in place. |
| [Phase 7](phase7.task.md) | Make workspaces durable and portable through explicit exchange formats. |
| [Phase 8](phase8.task.md) | Add presentation-oriented report sheets linked to calculation sources. |
| [Phase 9](phase9.task.md) | Add structured tables and formula tools for record-oriented models. |
| [Phase 10](phase10.task.md) | Add inspectable, portable reusable logic through custom functions. |

## Vision Coverage

| Feature area | Main delivery phases |
| --- | --- |
| Spatial workspace and sheet frames | MVP, 3, 5, 6 |
| Grid editing and interaction polish | MVP, 3, 4, 5 |
| Formulas | MVP, 2, 5, 9, 10 |
| References and navigation | MVP, 2, 4, 5 |
| Columns, rows, and structure | MVP, 3, 4, 9 |
| Persistence | MVP and every phase that adds durable state; exchange hardening in 7 |
| Formula editor | 2 and 5; formula comments in 6 |
| Comments and annotations | 6 |
| Structure refactoring and diff | 4 |
| Import and export | 7, with later formats extended by 8–10 |
| Reports and visualization | 8 |
| Groups, layers, and sectors | 6 |
| Table object model | 9 |
| Custom functions and programming | 10 |

Completing Phase 10 represents the current full-vision product shape, not an end to product development. Each phase should still be validated before later scope is converted into executable Beads.

## Sequencing Principles

- Spreadsheet fluency precedes advanced organization and presentation.
- Structural edits build on a trustworthy parser and dependency model.
- Rich navigation builds on stable reference identity and structural behavior.
- Every feature persists its own durable state when introduced; Phase 7 adds portable interchange rather than postponing durability.
- Advanced tables and custom functions arrive after ordinary formulas, navigation, and exchange behavior are reliable.

## References

- [PROJECT_VISION.md](PROJECT_VISION.md)
- [features/README.md](features/README.md)
