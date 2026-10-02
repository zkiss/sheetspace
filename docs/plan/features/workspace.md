# Spatial Workspace

## Purpose

The workspace is the 2D plane where sheets live. It is the central product difference from a traditional tabbed spreadsheet.

Users should be able to navigate an infinite-feeling surface, place related sheets near each other, zoom out to understand the model, and zoom in to edit a specific sheet.

## Feature Scope

- Provide a 2D workspace that supports multiple sheets.
- Allow sheets to have independent positions.
- Treat the workspace as an infinite-feeling plane where users can continue panning and placing sheets at any practical finite coordinate.
- Support smooth, pointer-centered, multiplicative zoom across a wide practical range.
- Keep ordinary wheel and two-finger scrolling sheet-local; navigate the canvas through explicit pan and zoom gestures.
- Pan by dragging the background, Space-dragging, or middle-dragging; zoom at the pointer with pinch or Ctrl/Cmd-wheel. See the [Phase 3 navigation contract](../roadmap/03-fluent-spreadsheet-editing.md#canvas-navigation-and-multi-scale-composition).
- Persist viewport state.
- Manage workspace-level selection and focus.
- Support search or command-palette navigation to sheets.
- Maintain navigation history for user movement through space.
- Show visual reference lines connecting formulas to source cells.
- Provide optional minimap or overview controls if the workspace becomes hard to navigate.

## Open Decisions

- What viewport state should be saved in history entries?
