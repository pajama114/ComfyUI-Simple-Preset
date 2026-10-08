# AGENTS.md

## Project

This repository contains a ComfyUI custom node named **Simple Preset**.
Keep the extension small, dependency-free where practical, and compatible with
current ComfyUI custom-node conventions.

## Product requirements

- Provide one node that outputs a ComfyUI `STRING`.
- Allow named presets to be created, edited, and deleted.
- Allow multiple presets to be selected.
- Join the selected preset prompts in their displayed order.
- Store all presets in one shared JSON file so they are available across workflows.
- Embed snapshots of selected presets and their separator in each workflow so
  it runs on another installation. Unselected presets remain only in the shared
  library. Embedded contents take priority until explicitly refreshed from the
  library; loading a workflow must not automatically import its presets.
- Support JSON export/import with preserved preset IDs, additive merging, and
  explicit keep/update choices for conflicting preset contents.

## Expected structure

- `__init__.py`: package exports and web-directory registration.
- Python node/server modules: node behavior, routes, and persistence.
- `web/`: ComfyUI frontend extension code.
- A package-local data directory or JSON file for shared presets.

The exact module names may evolve; prefer a few focused files over unnecessary
abstraction.

## Verification

Before finishing a change:

- Run available Python tests and frontend checks.
- Verify node import and registration without launching a full ComfyUI session
  when possible.
- Verify create, edit, delete, multi-select, ordering, joining, and JSON reload.
- Verify two workflows share presets while retaining independent selections.
- Report checks that could not be run and why.

## Other

- Since this is a pre-release version, you don't need to worry about destructive operations or maintaining compatibility.
