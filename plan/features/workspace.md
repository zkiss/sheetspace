# Spatial Workspace

## Purpose

The workspace is the 2D plane where sheets live. It is the central product difference from a traditional tabbed spreadsheet.

Users should be able to navigate a larger surface, place related sheets near each other, zoom out to understand the model, and zoom in to edit a specific sheet.

## Feature Scope

- Provide a 2D workspace that supports multiple sheets.
- Allow sheets to have independent positions.
- Support smooth pan and zoom interactions.
- Persist viewport state.
- Manage workspace-level selection and focus.
- Support search or command-palette navigation to sheets.
- Maintain navigation history for user movement through space.
- Show visual reference lines connecting formulas to source cells.
- Provide optional minimap or overview controls if the workspace becomes hard to navigate.

## Open Decisions

- Should the workspace be mathematically infinite or a large bounded area?
- Should zoom level affect whether cells can be edited?
- What viewport state should be saved in history entries?
