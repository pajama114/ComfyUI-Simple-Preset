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
- Store only the selected preset state in each workflow; do not duplicate the
  shared preset contents in workflow JSON.

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
