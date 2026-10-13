# Spatial Workspace

## Purpose

The workspace is the 2D plane where sheets live. It is the central product difference from a traditional tabbed spreadsheet.

Users should be able to navigate an infinite-feeling surface, place related sheets near each other, zoom out to understand the model, and zoom in to edit a specific sheet.

## Feature Scope

- Provide a 2D workspace that supports multiple sheets.
- Allow free placement of sheets on an infinite-feeling canvas.
- Make pan and zoom smooth and intuitive across scales, from an overview of the model to detailed work within a sheet.
- Keep canvas navigation and scrolling within sheets usable together without disrupting editing.
- Persist viewport state.
- Manage workspace-level selection and focus.
- Support search or command-palette navigation to sheets.
- Maintain navigation history for user movement through space.
- Show visual reference lines connecting formulas to source cells.
- Provide optional minimap or overview controls if the workspace becomes hard to navigate.

## Open Decisions

- What viewport state should be saved in history entries?
