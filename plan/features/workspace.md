# Spatial Workspace

MVP importance: Required.

## Purpose

The workspace is the 2D plane where sheets live. It is the central product difference from a traditional tabbed spreadsheet.

Users should be able to navigate a larger surface, place related sheets near each other, zoom out to understand the model, and zoom in to edit a specific sheet.

## MVP Slice

- Provide a 2D workspace that contains multiple sheets.
- Allow sheets to have independent `x` and `y` positions.
- Allow panning.
- Allow zooming.
- Keep sheets editable when the viewport is at a readable zoom level.

## MVP Limitations

- No jump-to-sheet navigation.
- No reference jump navigation.
- No animated navigation history.
- No grouping, layers, sectors, or minimap.
- The workspace may be infinite or a large bounded plane, whichever is simpler for the first implementation.

## Long-Term Scope

- Smooth pan and zoom interactions.
- Viewport persistence.
- Workspace-level selection and focus handling.
- Search or command-palette navigation to sheets.
- Navigation history for user movement through space.
- Visual reference lines connecting formulas to source cells.
- Optional minimap or overview controls if the workspace becomes hard to navigate.

## Open Decisions

- Should the workspace be mathematically infinite or a large bounded area?
- Should zoom level affect whether cells can be edited?
- What viewport state should be saved in history entries?
